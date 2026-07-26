"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";
import { seekVideo, waitUntilReady } from "@/lib/seekVideo";
import {
  isWebCodecsSupported,
  probeVideo,
  decodeVideoFrames,
} from "@/lib/webcodecs";

interface UseVideoAnalyserReturn {
  analyse:       (file: File, seed: Point) => Promise<void>;
  progress:      number;
  isAnalysing:   boolean;
  result:        AnalysisResult | null;
  error:         string | null;
  liveFrames:    FrameResult[];
  liveFps:       number;
  liveVideoDims: { width: number; height: number } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCALED_WIDTH             = 320;
const MAX_JUMP_HEIGHT_FRACTION = 0.18;
const MIN_MAX_JUMP_PX          = 20;
const SMOOTHING_WINDOW         = 3;

const isMobile = typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chooseAnalysisFps(durationSeconds: number): number {
  if (durationSeconds <= 25) return 60;
  if (durationSeconds <= 60) return 30;
  return 24;
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function smoothPositions(frames: FrameResult[]): FrameResult[] {
  if (frames.length < SMOOTHING_WINDOW) return frames;
  const half = Math.floor(SMOOTHING_WINDOW / 2);
  return frames.map((frame, i) => {
    const lo    = Math.max(0, i - half);
    const hi    = Math.min(frames.length - 1, i + half);
    const slice = frames.slice(lo, hi + 1);
    return {
      ...frame,
      position: {
        x: medianOf(slice.map((f) => f.position.x)),
        y: medianOf(slice.map((f) => f.position.y)),
      },
    };
  });
}

function sharedArrayBufferAvailable(): boolean {
  try {
    const test = new SharedArrayBuffer(1);
    return test.byteLength === 1;
  } catch {
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVideoAnalyser(): UseVideoAnalyserReturn {
  const [progress,      setProgress]      = useState(0);
  const [isAnalysing,   setIsAnalysing]   = useState(false);
  const [result,        setResult]        = useState<AnalysisResult | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [liveFrames,    setLiveFrames]    = useState<FrameResult[]>([]);
  const [liveFps,       setLiveFps]       = useState(0);
  const [liveVideoDims, setLiveVideoDims] = useState<{ width: number; height: number } | null>(null);

  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const canvasRef      = useRef<HTMLCanvasElement | null>(null);
  const workerRef      = useRef<Worker | null>(null);
  const sharedBufRef   = useRef<SharedArrayBuffer | null>(null);
  const sharedPixelRef = useRef<Uint8ClampedArray | null>(null);
  const canUseSAB      = useRef(false);
  const abortRef       = useRef<AbortController | null>(null);

  // ── Spin up worker ───────────────────────────────────────────────────────
  useEffect(() => {
    canUseSAB.current = sharedArrayBufferAvailable();

    const worker = new Worker(
      new URL("../workers/tracker.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current = worker;

    worker.addEventListener("message", (e) => {
      if (e.data?.type === "log") {
        if (e.data.level === "warn") {
          console.warn("[worker]", ...e.data.args);
        } else {
          console.log("[worker]", ...e.data.args);
        }
      }
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Init shared buffer ───────────────────────────────────────────────────
  const initSharedBuffer = useCallback(
    (width: number, height: number): Promise<void> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker || !canUseSAB.current) { resolve(); return; }

        const byteLength = width * height * 4;
        const sharedBuf  = new SharedArrayBuffer(byteLength);
        const signalBuf  = new SharedArrayBuffer(4);

        sharedBufRef.current   = sharedBuf;
        sharedPixelRef.current = new Uint8ClampedArray(sharedBuf);

        const handler = (event: MessageEvent) => {
          if (event.data?.type === "ack") {
            worker.removeEventListener("message", handler);
            resolve();
          }
        };

        worker.addEventListener("message", handler);
        worker.postMessage({
          type:         "init",
          sharedBuffer: sharedBuf,
          signalBuffer: signalBuf,
          width,
          height,
          isMobile,
        });
      });
    },
    []
  );

  // ── Frame capture from canvas ────────────────────────────────────────────
  const captureFromCanvas = useCallback((): ImageData | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const captureFrame = useCallback((): ImageData | null => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const scale = SCALED_WIDTH / video.videoWidth;
    const h     = Math.round(video.videoHeight * scale);

    canvas.width  = SCALED_WIDTH;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, SCALED_WIDTH, h);
    return ctx.getImageData(0, 0, SCALED_WIDTH, h);
  }, []);

  const writeFrameToShared = useCallback((frame: ImageData): boolean => {
    const shared = sharedPixelRef.current;
    if (!shared || !canUseSAB.current) return false;
    if (shared.byteLength !== frame.data.byteLength) return false;
    shared.set(frame.data);
    return true;
  }, []);

  // ── Worker communication ─────────────────────────────────────────────────
  const workerSend = useCallback(
    (
      message:     Record<string, unknown>,
      waitForType: string,
      transfer?:   Transferable[]
    ): Promise<Record<string, unknown>> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) { resolve({}); return; }

        const handler = (event: MessageEvent) => {
          if (event.data?.type === waitForType) {
            worker.removeEventListener("message", handler);
            resolve(event.data);
          }
        };

        worker.addEventListener("message", handler);

        if (transfer?.length) {
          worker.postMessage(message, transfer);
        } else {
          worker.postMessage(message);
        }
      });
    },
    []
  );

  const workerSeed = useCallback(
    async (x: number, y: number): Promise<void> => {
      await workerSend({ type: "seed", x, y }, "ack");
    },
    [workerSend]
  );

  const workerTrack = useCallback(
    async (frame: ImageData): Promise<{
      x: number; y: number; confidence: number; tracked: boolean;
    }> => {
      const wroteToShared = writeFrameToShared(frame);

      if (wroteToShared) {
        const result = await workerSend({ type: "track" }, "result");
        return result as { x: number; y: number; confidence: number; tracked: boolean };
      }

      const result = await workerSend(
        { type: "track", imageData: frame },
        "result",
        [frame.data.buffer]
      );
      return result as { x: number; y: number; confidence: number; tracked: boolean };
    },
    [workerSend, writeFrameToShared]
  );

  // ── Process one frame (shared between both code paths) ───────────────────
  const processFrame = useCallback(
    async (
      imageData:     ImageData,
      timeSeconds:   number,
      frameIndex:    number,
      scale:         number,
      currentPoint:  { x: number; y: number },
      previousPoint: { x: number; y: number } | null,
    ): Promise<{
      newPoint:      { x: number; y: number };
      newPrevious:   { x: number; y: number };
      frameResult:   FrameResult;
    }> => {
      const tracked   = await workerTrack(imageData);
      const candidate = { x: tracked.x, y: tracked.y };

      const recentStep = previousPoint
        ? distance(currentPoint, previousPoint)
        : 0;

      const maxJump = Math.max(
        MIN_MAX_JUMP_PX,
        recentStep * 3.5,
        imageData.height * MAX_JUMP_HEIGHT_FRACTION
      );

      const jump = distance(candidate, currentPoint);

      const accepted =
        tracked.confidence >= 0.28 || jump <= maxJump;

      const newPoint = accepted ? candidate : currentPoint;

      return {
        newPoint,
        newPrevious:  currentPoint,
        frameResult: {
          frameIndex,
          timeSeconds,
          position: {
            x: newPoint.x / scale,
            y: newPoint.y / scale,
          },
        },
      };
    },
    [workerTrack]
  );

  // ── WebCodecs analysis path ──────────────────────────────────────────────
  const analyseWithWebCodecs = useCallback(
    async (
      file:   File,
      seed:   Point,
      canvas: HTMLCanvasElement
    ): Promise<AnalysisResult> => {
      console.log("Using WebCodecs path");

      const info  = await probeVideo(file);
      const fps   = chooseAnalysisFps(info.durationSeconds);
      const scale = SCALED_WIDTH / info.width;
      const scaledH = Math.round(info.height * scale);

      canvas.width  = SCALED_WIDTH;
      canvas.height = scaledH;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get canvas context");

      await initSharedBuffer(SCALED_WIDTH, scaledH);

      let currentPoint:  { x: number; y: number } = {
        x: seed.x * scale,
        y: seed.y * scale,
      };
      let previousPoint: { x: number; y: number } | null = null;

      const allFrames: FrameResult[] = [];
      let   seeded = false;

      await decodeVideoFrames(
        file,
        fps,
        info,
        async (frame, frameIndex) => {
          if (abortRef.current?.signal.aborted) {
            frame.close();
            return;
          }

          // Draw decoded frame to canvas at tracking resolution
          frame.draw(ctx, SCALED_WIDTH, scaledH);
          frame.close();

          const imageData = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);

          // Seed tracker on first frame
          if (!seeded) {
            writeFrameToShared(imageData);
            await workerSeed(currentPoint.x, currentPoint.y);
            seeded = true;

            allFrames.push({
              frameIndex:  0,
              timeSeconds: 0,
              position:    { x: seed.x, y: seed.y },
            });
            return;
          }

          const timeSeconds = frame.timestampUs / 1_000_000;

          const { newPoint, newPrevious, frameResult } = await processFrame(
            imageData,
            timeSeconds,
            frameIndex,
            scale,
            currentPoint,
            previousPoint
          );

          currentPoint  = newPoint;
          previousPoint = newPrevious;
          allFrames.push(frameResult);
        },
        (pct) => setProgress(pct),
        abortRef.current?.signal
      );

      return {
        frames:          smoothPositions(allFrames),
        fps,
        videoWidth:      info.width,
        videoHeight:     info.height,
        durationSeconds: info.durationSeconds,
      };
    },
    [
      initSharedBuffer,
      writeFrameToShared,
      workerSeed,
      processFrame,
    ]
  );

  // ── Seek-based fallback path ─────────────────────────────────────────────
  const analyseWithSeek = useCallback(
    async (
      file:   File,
      seed:   Point,
      video:  HTMLVideoElement,
      canvas: HTMLCanvasElement
    ): Promise<AnalysisResult> => {
      console.log("Using seek-based fallback path");

      const url = URL.createObjectURL(file);
      video.src = url;

      try {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error("Video load error")), { once: true });
          setTimeout(() => reject(new Error("Metadata timeout")), 10_000);
        });

        const duration    = video.duration;
        const fps         = chooseAnalysisFps(duration);
        const totalFrames = Math.floor(duration * fps);
        const videoWidth  = video.videoWidth;
        const videoHeight = video.videoHeight;
        const scale       = SCALED_WIDTH / videoWidth;
        const scaledH     = Math.round(videoHeight * scale);

        canvas.width  = SCALED_WIDTH;
        canvas.height = scaledH;

        let currentPoint:  { x: number; y: number } = {
          x: seed.x * scale,
          y: seed.y * scale,
        };
        let previousPoint: { x: number; y: number } | null = null;

        await waitUntilReady(video);
        video.pause();
        await seekVideo(video, 0);
        await new Promise((r) => setTimeout(r, 100));

        const captureCurrentFrame = (): ImageData | null => {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
          return ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);
        };

        const firstFrame = captureCurrentFrame();
        if (!firstFrame) throw new Error("Could not capture first frame");

        await initSharedBuffer(SCALED_WIDTH, scaledH);
        writeFrameToShared(firstFrame);
        await workerSeed(currentPoint.x, currentPoint.y);

        const allFrames: FrameResult[] = [
          { frameIndex: 0, timeSeconds: 0, position: { x: seed.x, y: seed.y } },
        ];

        for (let fi = 1; fi < totalFrames; fi++) {
          if (abortRef.current?.signal.aborted) break;

          const t = fi / fps;
          if (t > duration) break;

          await seekVideo(video, t);

          const nextFrame = captureCurrentFrame();
          if (!nextFrame) continue;

          const { newPoint, newPrevious, frameResult } = await processFrame(
            nextFrame,
            t,
            fi,
            scale,
            currentPoint,
            previousPoint
          );

          currentPoint  = newPoint;
          previousPoint = newPrevious;
          allFrames.push(frameResult);

          if (fi % 15 === 0) {
            setProgress(Math.round((fi / totalFrames) * 100));
          }
        }

        return {
          frames:          smoothPositions(allFrames),
          fps,
          videoWidth,
          videoHeight,
          durationSeconds: duration,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [initSharedBuffer, writeFrameToShared, workerSeed, processFrame]
  );

  // ── Main analyse entry point ─────────────────────────────────────────────
  const analyse = useCallback(
    async (file: File, seed: Point) => {
      setIsAnalysing(true);
      setProgress(0);
      setResult(null);
      setError(null);
      setLiveFrames([]);
      setLiveVideoDims(null);

      abortRef.current = new AbortController();

      const video  = document.createElement("video");
      video.muted       = true;
      video.playsInline = true;
      video.preload     = "auto";
      video.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;";

      document.body.appendChild(video);

      const canvas      = document.createElement("canvas");
      videoRef.current  = video;
      canvasRef.current = canvas;

      try {
        // Probe metadata (cheap — uses video element)
        const info = await probeVideo(file);

        setLiveFps(chooseAnalysisFps(info.durationSeconds));
        setLiveVideoDims({ width: info.width, height: info.height });

        let analysisResult: AnalysisResult;

        /**
         * Try WebCodecs first — no seek overhead, much faster on mobile.
         * Fall back to seek-based if WebCodecs is not supported or fails.
         */
        if (isWebCodecsSupported()) {
          try {
            analysisResult = await analyseWithWebCodecs(file, seed, canvas);
          } catch (e) {
            console.warn("WebCodecs failed, falling back to seek:", String(e));
            analysisResult = await analyseWithSeek(file, seed, video, canvas);
          }
        } else {
          analysisResult = await analyseWithSeek(file, seed, video, canvas);
        }

        setLiveFrames(analysisResult.frames);
        setResult(analysisResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (document.body.contains(video)) document.body.removeChild(video);

        workerRef.current?.postMessage({ type: "reset" });

        videoRef.current       = null;
        canvasRef.current      = null;
        sharedBufRef.current   = null;
        sharedPixelRef.current = null;
        abortRef.current       = null;

        setIsAnalysing(false);
        setProgress(100);
      }
    },
    [analyseWithWebCodecs, analyseWithSeek]
  );

  return {
    analyse,
    progress,
    isAnalysing,
    result,
    error,
    liveFrames,
    liveFps,
    liveVideoDims,
  };
}