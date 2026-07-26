/**
 * WebCodecs video decoder wrapper.
 *
 * Decodes a video file into frames without using HTMLVideoElement seeking.
 * This eliminates the seek overhead that makes analysis slow on mobile.
 *
 * Falls back gracefully to seek-based analysis if WebCodecs is not available
 * or if the codec is not supported.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DecodedVideoFrame {
  /** Video timestamp in microseconds */
  timestampUs: number;
  /** Draw this frame to a canvas context at the given dimensions */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Must be called after use to free GPU/memory resources */
  close: () => void;
}

export interface VideoInfo {
  durationSeconds: number;
  width:           number;
  height:          number;
  codec:           string;
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

/**
 * Extract video metadata using a temporary video element.
 * This is fast — no frame decode needed.
 */
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

        /**
         * Guess codec from MIME type.
         * avc1.42E01E = H.264 baseline — the safest default.
         * Most phone cameras produce H.264 MP4.
         */
        const mime = file.type.toLowerCase();
        let codec  = "avc1.42E01E";

        if (mime.includes("webm")) {
          codec = "vp8";
        } else if (mime.includes("mp4") || mime.includes("quicktime")) {
          codec = "avc1.42E01E";
        } else if (mime.includes("avi")) {
          codec = "avc1.42E01E";
        }

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

/**
 * Load mp4box.js from CDN as a script tag.
 * Only downloaded when WebCodecs path is taken.
 * Cached on globalThis after first load.
 */
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

/**
 * Extract the AVC (H.264) or HEVC (H.265) decoder configuration record
 * from the MP4 container using mp4box's internal box tree.
 *
 * This is required for H.264 video in MP4 containers — without the
 * description (SPS + PPS NAL units), the VideoDecoder rejects all frames.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAvcDescription(mp4boxFile: any, trackId: number): Uint8Array | null {
  try {
    const trak        = mp4boxFile.getTrackById(trackId);
    const sampleEntry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (!sampleEntry) return null;

    // avcC = H.264, hvcC = H.265
    const configBox = sampleEntry.avcC ?? sampleEntry.hvcC ?? null;
    if (!configBox) return null;

    /**
     * Serialise the config box using mp4box's DataStream.
     * mp4box attaches DataStream to its own namespace.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DataStream = (globalThis as any).DataStream;
    if (!DataStream) return null;

    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    configBox.write(stream);

    /**
     * The written buffer includes an 8-byte box header (4 bytes size + 4 bytes type).
     * We skip those to get just the configuration record payload.
     */
    return new Uint8Array(stream.buffer, 8);
  } catch (e) {
    console.warn("Could not extract AVC description:", String(e));
    return null;
  }
}

// ─── MP4Box demuxer ───────────────────────────────────────────────────────────

/**
 * Demux an MP4/MOV ArrayBuffer using mp4box.js and feed encoded chunks
 * to a VideoDecoder.
 */
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

    // Safety timeout — resolve if onFlush never fires
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

      /**
       * For H.264 in MP4, the decoder must be reconfigured with the
       * AVC description (SPS + PPS) from the container.
       * Without this, every chunk fails with:
       * "A key frame is required after configure() or flush()"
       */
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

      /**
       * Skip delta frames until the first keyframe arrives.
       * A VideoDecoder must receive a key frame first after configure().
       */
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

          // Wait for the first keyframe
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

    // Feed the full buffer — fileStart must be 0
    const ab = buffer.slice(0) as ArrayBuffer & { fileStart: number };
    ab.fileStart = 0;
    mp4boxFile.appendBuffer(ab);
    mp4boxFile.flush();
  });
}

// ─── Main decode function ─────────────────────────────────────────────────────

/**
 * Decode video frames using the WebCodecs API.
 *
 * Calls `onFrame` for each frame that falls on a target timestamp.
 * Calls `onProgress` with 0–100 as decoding progresses.
 * Returns the number of frames processed.
 */
export async function decodeVideoFrames(
  file:       File,
  targetFps:  number,
  info:       VideoInfo,
  onFrame:    (frame: DecodedVideoFrame, frameIndex: number) => Promise<void>,
  onProgress: (pct: number) => void,
  signal?:    AbortSignal
): Promise<number> {
  const frameIntervalUs   = 1_000_000 / targetFps;
  const totalDurationUs   = info.durationSeconds * 1_000_000;
  const totalTargetFrames = Math.floor(info.durationSeconds * targetFps);

  let frameIndex      = 0;
  let nextTargetUs    = 0;
  let framesProcessed = 0;

  const frameQueue: VideoFrame[]  = [];
  let   decoderDone               = false;
  let   decoderError: Error | null = null;
  let   notifyNewFrame: (() => void) | null = null;

  const wakeConsumer = () => notifyNewFrame?.();

  // ── Create decoder ──────────────────────────────────────────────────────
  const decoder = new VideoDecoder({
    output: (frame) => {
      frameQueue.push(frame);
      wakeConsumer();
    },
    error: (e) => {
      decoderError = new Error(`VideoDecoder error: ${e.message}`);
      wakeConsumer();
    },
  });

  // ── Check codec support ─────────────────────────────────────────────────
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

  /**
   * Initial configure — may be overridden by feedWithMp4Box once it
   * extracts the AVC description from the container.
   */
  decoder.configure({
    codec:  info.codec,
    width:  info.width,
    height: info.height,
  });

  // ── Wait helper ─────────────────────────────────────────────────────────
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

  // ── Feed encoded data concurrently ──────────────────────────────────────
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
        // Ignore flush errors
      }
      decoderDone = true;
      wakeConsumer();
    }
  })();

  // ── Consume decoded frames ──────────────────────────────────────────────
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
        frameIndex
      );

      frameIndex++;
      nextTargetUs    = frameIndex * frameIntervalUs;
      framesProcessed++;

      onProgress(Math.min(99, Math.round((tsUs / totalDurationUs) * 100)));
    } else {
      // Not a target frame — discard
      frame.close();
    }
  }

  // ── Drain remaining frames ──────────────────────────────────────────────
  for (const f of frameQueue) f.close();
  frameQueue.length = 0;

  await feedPromise;

  try {
    if (decoder.state !== "closed") decoder.close();
  } catch {
    // Ignore
  }

  return framesProcessed;
}