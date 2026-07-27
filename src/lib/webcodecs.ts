/**
 * WebCodecs video decoder wrapper.
 */

export interface DecodedVideoFrame {
  timestampUs: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  close: () => void;
}

export interface VideoInfo {
  durationSeconds: number;
  width:           number;
  height:          number;
  codec:           string;
}

export interface DecodeResult {
  framesProcessed: number;
  /** Actual fps detected from video frame timestamps */
  effectiveFps:    number;
}

// ─── Feature detection ────────────────────────────────────────────────────────

export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoDecoder !== "undefined" &&
    typeof VideoDecoder.isConfigSupported === "function" &&
    typeof EncodedVideoChunk !== "undefined"
  );
}

// ─── Probe video metadata ─────────────────────────────────────────────────────

export async function probeVideo(file: File): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url   = URL.createObjectURL(file);

    video.src     = url;
    video.preload = "metadata";
    video.muted   = true;

    video.addEventListener(
      "loadedmetadata",
      () => {
        URL.revokeObjectURL(url);

        const mime = file.type.toLowerCase();
        let codec  = "avc1.42E01E";

        if (mime.includes("webm"))                                    codec = "vp8";
        else if (mime.includes("mp4") || mime.includes("quicktime"))  codec = "avc1.42E01E";

        resolve({
          durationSeconds: video.duration,
          width:           video.videoWidth,
          height:          video.videoHeight,
          codec,
        });
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not probe video metadata"));
      },
      { once: true }
    );
  });
}

// ─── MP4Box loader ────────────────────────────────────────────────────────────

async function loadMp4Box(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((globalThis as any).MP4Box) return (globalThis as any).MP4Box;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src*="mp4box"]');

    if (existing) {
      existing.addEventListener("load",  () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("mp4box script failed")), { once: true });
      return;
    }

    const script   = document.createElement("script");
    script.src     = "https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js";
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error("Failed to load mp4box from CDN"));
    document.head.appendChild(script);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mp4box = (globalThis as any).MP4Box;
  if (!mp4box) throw new Error("MP4Box not available after script load");
  return mp4box;
}

// ─── AVC description extractor ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAvcDescription(mp4boxFile: any, trackId: number): Uint8Array | null {
  try {
    const trak        = mp4boxFile.getTrackById(trackId);
    const sampleEntry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (!sampleEntry) return null;

    const configBox = sampleEntry.avcC ?? sampleEntry.hvcC ?? null;
    if (!configBox) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DataStream = (globalThis as any).DataStream;
    if (!DataStream) return null;

    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    configBox.write(stream);

    return new Uint8Array(stream.buffer, 8);
  } catch (e) {
    console.warn("Could not extract AVC description:", String(e));
    return null;
  }
}

// ─── MP4Box demuxer ───────────────────────────────────────────────────────────

async function feedWithMp4Box(
  buffer:  ArrayBuffer,
  decoder: VideoDecoder,
  signal?: AbortSignal
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MP4Box: any = await loadMp4Box();

  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp4boxFile: any = MP4Box.createFile();
    let   resolved        = false;

    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      if (err) reject(err);
      else resolve();
    };

    const timeout = setTimeout(() => {
      console.warn("MP4Box onFlush timeout — resolving anyway");
      done();
    }, 30_000);

    mp4boxFile.onError = (e: unknown) => {
      clearTimeout(timeout);
      done(new Error(`MP4Box error: ${String(e)}`));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mp4boxFile.onReady = (info: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoTrack = info.tracks?.find((t: any) => t.type === "video");

      if (!videoTrack) {
        done(new Error("No video track found in file"));
        return;
      }

      const description = getAvcDescription(mp4boxFile, videoTrack.id);

      if (description) {
        try {
          decoder.configure({
            codec:       videoTrack.codec ?? "avc1.42E01E",
            width:       videoTrack.track_width  ?? videoTrack.video?.width  ?? 0,
            height:      videoTrack.track_height ?? videoTrack.video?.height ?? 0,
            description,
          });
          console.log("VideoDecoder reconfigured with AVC description");
        } catch (e) {
          console.warn("Failed to reconfigure with AVC description:", String(e));
        }
      } else {
        console.warn("No AVC description found — decoder may reject frames");
      }

      mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: 100 });

      let seenKeyFrame = false;

      mp4boxFile.onSamples = (
        _id:     number,
        _user:   unknown,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        samples: any[]
      ) => {
        if (signal?.aborted) { done(); return; }

        for (const sample of samples) {
          if (signal?.aborted) break;

          if (!seenKeyFrame) {
            if (!sample.is_sync) continue;
            seenKeyFrame = true;
          }

          try {
            const chunk = new EncodedVideoChunk({
              type:      sample.is_sync ? "key" : "delta",
              timestamp: (sample.dts      / sample.timescale) * 1_000_000,
              duration:  (sample.duration / sample.timescale) * 1_000_000,
              data:      sample.data,
            });

            decoder.decode(chunk);
          } catch (e) {
            console.warn("Skipping undecodable chunk:", String(e));
          }
        }
      };

      mp4boxFile.start();
    };

    mp4boxFile.onFlush = () => {
      clearTimeout(timeout);
      done();
    };

    const ab = buffer.slice(0) as ArrayBuffer & { fileStart: number };
    ab.fileStart = 0;
    mp4boxFile.appendBuffer(ab);
    mp4boxFile.flush();
  });
}

// ─── Main decode function ─────────────────────────────────────────────────────

export async function decodeVideoFrames(
  file:       File,
  targetFps:  number,
  info:       VideoInfo,
  onFrame:    (frame: DecodedVideoFrame, frameIndex: number, actualTimestampUs: number) => Promise<void>,
  onProgress: (pct: number) => void,
  signal?:    AbortSignal
): Promise<DecodeResult> {
  const totalDurationUs   = info.durationSeconds * 1_000_000;
  const totalTargetFrames = Math.floor(info.durationSeconds * targetFps);

  /**
   * We detect the actual video fps from the first two decoded frames.
   * If the video is 30fps but we request 60fps, we adjust frameIntervalUs
   * to match the actual video so we don't skip or duplicate frames.
   */
  let frameIntervalUs     = 1_000_000 / targetFps;
  let effectiveFps        = targetFps;
  let firstFrameTs: number | null = null;
  let fpsDetected         = false;

  let frameIndex      = 0;
  let nextTargetUs    = 0;
  let framesProcessed = 0;

  const frameQueue: VideoFrame[]   = [];
  let   decoderDone                = false;
  let   decoderError: Error | null = null;
  let   notifyNewFrame: (() => void) | null = null;

  const wakeConsumer = () => notifyNewFrame?.();

  const decoder = new VideoDecoder({
    output: (frame) => {
      /**
       * Auto-detect actual video fps from first two frames.
       * Adjusts frameIntervalUs so we select one frame per actual video frame,
       * not one per target interval (which may not match).
       */
      if (!fpsDetected) {
        if (firstFrameTs === null) {
          firstFrameTs = frame.timestamp;
        } else {
          const actualIntervalUs = frame.timestamp - firstFrameTs;
          if (actualIntervalUs > 0) {
            const actualFps = 1_000_000 / actualIntervalUs;
            console.log(
              `Video fps detected: ${actualFps.toFixed(1)}fps ` +
              `(target was ${targetFps}fps)`
            );

            /**
             * Use the actual video frame interval.
             * This ensures we select exactly one decoded frame per
             * video frame regardless of target fps.
             */
            effectiveFps    = actualFps;
            frameIntervalUs = actualIntervalUs;
          }
          fpsDetected = true;
        }
      }

      frameQueue.push(frame);
      wakeConsumer();
    },
    error: (e) => {
      decoderError = new Error(`VideoDecoder error: ${e.message}`);
      wakeConsumer();
    },
  });

  let support: VideoDecoderSupport;

  try {
    support = await VideoDecoder.isConfigSupported({
      codec:  info.codec,
      width:  info.width,
      height: info.height,
    });
  } catch {
    decoder.close();
    throw new Error(`Could not check codec support for ${info.codec}`);
  }

  if (!support.supported) {
    decoder.close();
    throw new Error(
      `Codec ${info.codec} not supported by WebCodecs on this device`
    );
  }

  decoder.configure({
    codec:  info.codec,
    width:  info.width,
    height: info.height,
  });

  const waitForFrame = (): Promise<void> =>
    new Promise((resolve) => {
      if (frameQueue.length > 0 || decoderDone || decoderError) {
        resolve();
        return;
      }
      notifyNewFrame = () => {
        notifyNewFrame = null;
        resolve();
      };
    });

  const feedPromise = (async () => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (signal?.aborted) return;
      await feedWithMp4Box(arrayBuffer, decoder, signal);
    } catch (e) {
      decoderError = e instanceof Error ? e : new Error(String(e));
      wakeConsumer();
    } finally {
      try {
        if (decoder.state === "configured") {
          await decoder.flush();
        }
      } catch {
        // Ignore
      }
      decoderDone = true;
      wakeConsumer();
    }
  })();

  while (framesProcessed < totalTargetFrames) {
    if (signal?.aborted) break;
    if (decoderError) throw decoderError;

    if (frameQueue.length === 0) {
      if (decoderDone) break;
      await waitForFrame();
      continue;
    }

    const frame = frameQueue.shift()!;
    const tsUs  = frame.timestamp;

    if (tsUs >= nextTargetUs - frameIntervalUs / 2) {
      const capturedFrame = frame;

      await onFrame(
        {
          timestampUs: tsUs,
          draw: (ctx, w, h) => {
            ctx.drawImage(
              capturedFrame as unknown as CanvasImageSource,
              0, 0, w, h
            );
          },
          close: () => capturedFrame.close(),
        },
        frameIndex,
        tsUs  // ← pass actual timestamp through
      );

      frameIndex++;
      nextTargetUs    = frameIndex * frameIntervalUs;
      framesProcessed++;

      onProgress(Math.min(99, Math.round((tsUs / totalDurationUs) * 100)));
    } else {
      frame.close();
    }
  }

  for (const f of frameQueue) f.close();
  frameQueue.length = 0;

  await feedPromise;

  try {
    if (decoder.state !== "closed") decoder.close();
  } catch {
    // Ignore
  }

  return { framesProcessed, effectiveFps };
}