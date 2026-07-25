"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";
import { seekVideo, waitUntilReady } from "@/lib/seekVideo";

interface UseVideoAnalyserReturn {
  analyse:     (file: File, seed: Point) => Promise<void>;
  progress:    number;
  isAnalysing: boolean;
  result:      AnalysisResult | null;
  error:       string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Priority 2 fix: reduced tracking resolution.
 * 320px instead of 640px = 4x fewer pixels in patch operations.
 * The bar is large enough to track accurately at this resolution.
 */
const SCALED_WIDTH = 320;

/**
 * Max jump rejection.
 * Reject points that moved an implausibly large distance in one frame.
 */
const MAX_JUMP_HEIGHT_FRACTION = 0.18;
const MIN_MAX_JUMP_PX          = 20;

/** Light median smoothing window on final positions */
const SMOOTHING_WINDOW = 3;

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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVideoAnalyser(): UseVideoAnalyserReturn {
  const [progress,    setProgress]    = useState(0);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [result,      setResult]      = useState<AnalysisResult | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // ── Spin up worker once ──────────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/tracker.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Frame capture ────────────────────────────────────────────────────────
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

  // ── Send message to worker and await reply ───────────────────────────────
  const workerTrack = useCallback(
    (imageData: ImageData): Promise<{
      x: number;
      y: number;
      confidence: number;
      tracked: boolean;
    }> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) {
          resolve({ x: 0, y: 0, confidence: 0, tracked: false });
          return;
        }

        const handler = (event: MessageEvent) => {
          if (event.data?.type === "result") {
            worker.removeEventListener("message", handler);
            resolve(event.data);
          }
        };

        worker.addEventListener("message", handler);

        /**
         * Priority 3: transfer the buffer instead of copying it.
         * This avoids a full ArrayBuffer copy per frame.
         */
        const buffer = imageData.data.buffer;
        worker.postMessage(
          { type: "track", imageData },
          [buffer]
        );
      });
    },
    []
  );

  const workerSeed = useCallback(
    (imageData: ImageData, x: number, y: number): Promise<void> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) { resolve(); return; }

        const handler = (event: MessageEvent) => {
          if (event.data?.type === "ready") {
            worker.removeEventListener("message", handler);
            resolve();
          }
        };

        worker.addEventListener("message", handler);
        worker.postMessage({ type: "seed", imageData, x, y });
      });
    },
    []
  );

  // ── Main analysis ────────────────────────────────────────────────────────
  const analyse = useCallback(
    async (file: File, seed: Point) => {
      setIsAnalysing(true);
      setProgress(0);
      setResult(null);
      setError(null);

      const video = document.createElement("video");
      video.muted       = true;
      video.playsInline = true;
      video.preload     = "auto";
      video.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;";

      document.body.appendChild(video);

      const canvas  = document.createElement("canvas");
      videoRef.current  = video;
      canvasRef.current = canvas;

      let url: string | null = null;

      try {
        url       = URL.createObjectURL(file);
        video.src = url;

        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
          video.addEventListener(
            "error",
            () => reject(new Error("Video load error")),
            { once: true }
          );
          setTimeout(() => reject(new Error("Metadata timeout")), 10_000);
        });

        const duration    = video.duration;
        const fps         = chooseAnalysisFps(duration);
        const totalFrames = Math.floor(duration * fps);
        const videoWidth  = video.videoWidth;
        const videoHeight = video.videoHeight;
        const scale       = SCALED_WIDTH / videoWidth;

        let currentPoint: Point = {
          x: seed.x * scale,
          y: seed.y * scale,
        };

        let previousPoint: Point | null = null;

        await waitUntilReady(video);

        video.pause();
        await seekVideo(video, 0);

        // Extra paint time — prevents "Could not capture first frame" [1]
        await new Promise((r) => setTimeout(r, 100));

        const firstFrame = captureFrame();
        if (!firstFrame) throw new Error("Could not capture first frame");

        // Seed the worker with the first frame
        await workerSeed(firstFrame, currentPoint.x, currentPoint.y);

        const frames: FrameResult[] = [
          {
            frameIndex:  0,
            timeSeconds: 0,
            position:    { x: seed.x, y: seed.y },
          },
        ];

        for (let fi = 1; fi < totalFrames; fi++) {
          const t = fi / fps;
          if (t > duration) break;

          await seekVideo(video, t);

          const nextFrame = captureFrame();
          if (!nextFrame) {
            console.warn(`Frame ${fi} capture failed`);
            continue;
          }

          // Worker does the optical flow off the main thread
          const tracked = await workerTrack(nextFrame);

          const candidate: Point = { x: tracked.x, y: tracked.y };

          // Max-jump sanity check
          const recentStep = previousPoint
            ? distance(currentPoint, previousPoint)
            : 0;

          const maxJump = Math.max(
            MIN_MAX_JUMP_PX,
            recentStep * 3.5,
            nextFrame.height * MAX_JUMP_HEIGHT_FRACTION
          );

          const jump = distance(candidate, currentPoint);

          const confidenceOk = tracked.confidence >= 0.28;
          const jumpOk       = jump <= maxJump;

          if (confidenceOk || jumpOk) {
            previousPoint = currentPoint;
            currentPoint  = candidate;
          }
          // If rejected, currentPoint stays where it was

          frames.push({
            frameIndex:  fi,
            timeSeconds: t,
            position: {
              x: currentPoint.x / scale,
              y: currentPoint.y / scale,
            },
          });

          // Progress update every other frame to avoid excessive re-renders
          if (fi % 2 === 0) {
            setProgress(Math.round((fi / totalFrames) * 100));
          }
        }

        const smoothed = smoothPositions(frames);

        setResult({
          frames:          smoothed,
          fps,
          videoWidth,
          videoHeight,
          durationSeconds: duration,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (url) URL.revokeObjectURL(url);

        if (document.body.contains(video)) {
          document.body.removeChild(video);
        }

        // Reset worker state for next analysis
        workerRef.current?.postMessage({ type: "reset" });

        videoRef.current  = null;
        canvasRef.current = null;

        setIsAnalysing(false);
        setProgress(100);
      }
    },
    [captureFrame, workerTrack, workerSeed]
  );

  return { analyse, progress, isAnalysing, result, error };
}