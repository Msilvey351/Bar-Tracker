"use client";

import { useCallback, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";
import { seekVideo, waitUntilReady } from "@/lib/seekVideo";
import { trackPointWithQuality } from "@/lib/tracker";

interface UseVideoAnalyserReturn {
  analyse: (file: File, seed: Point) => Promise<void>;
  progress: number;
  isAnalysing: boolean;
  result: AnalysisResult | null;
  error: string | null;
}

/**
 * Lower = faster.
 * Higher = better tracking.
 */
const SCALED_WIDTH = 640;

/**
 * Confidence below this is suspicious.
 * Do not set too high, because blurry fast movement can reduce confidence.
 */
const MIN_TRACK_CONFIDENCE = 0.28;

/**
 * Reject absurd jumps.
 * This is measured in scaled tracking-canvas pixels.
 */
const MIN_MAX_JUMP_PX = 18;

/**
 * Do not allow one-frame jumps bigger than this fraction of image height,
 * unless the tracker confidence is strong.
 */
const MAX_JUMP_HEIGHT_FRACTION = 0.16;

/**
 * Light post-analysis smoothing.
 * Keeps actual rep shape but reduces jitter/wobble.
 */
const SMOOTHING_WINDOW = 3;

function chooseAnalysisFps(durationSeconds: number): number {
  /**
   * Short clips can afford 60fps.
   * Long clips stay lower to avoid slowing the tracker too much.
   */
  if (durationSeconds <= 25) return 60;
  if (durationSeconds <= 60) return 30;
  return 24;
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function smoothPositions(frames: FrameResult[]): FrameResult[] {
  if (frames.length < SMOOTHING_WINDOW) return frames;

  const half = Math.floor(SMOOTHING_WINDOW / 2);

  return frames.map((frame, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames.length - 1, i + half);
    const slice = frames.slice(lo, hi + 1);

    return {
      ...frame,
      position: {
        x: median(slice.map((f) => f.position.x)),
        y: median(slice.map((f) => f.position.y)),
      },
    };
  });
}

export function useVideoAnalyser(): UseVideoAnalyserReturn {
  const [progress, setProgress] = useState(0);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const captureFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const scale = SCALED_WIDTH / video.videoWidth;
    const h = Math.round(video.videoHeight * scale);

    canvas.width = SCALED_WIDTH;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, SCALED_WIDTH, h);

    return ctx.getImageData(0, 0, SCALED_WIDTH, h);
  }, []);

  const analyse = useCallback(
    async (file: File, seed: Point) => {
      setIsAnalysing(true);
      setProgress(0);
      setResult(null);
      setError(null);

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      /**
       * Keep off-screen but still in DOM.
       * Some browsers won't reliably decode/capture hidden videos.
       */
      video.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;";

      document.body.appendChild(video);

      const canvas = document.createElement("canvas");
      videoRef.current = video;
      canvasRef.current = canvas;

      let url: string | null = null;

      try {
        url = URL.createObjectURL(file);
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

        const duration = video.duration;
        const fps = chooseAnalysisFps(duration);
        const totalFrames = Math.floor(duration * fps);

        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        const scale = SCALED_WIDTH / videoWidth;

        let currentPoint: Point = {
          x: seed.x * scale,
          y: seed.y * scale,
        };

        let previousAcceptedPoint: Point | null = null;
        let rejectedFrames = 0;

        await waitUntilReady(video);

        video.pause();
        await seekVideo(video, 0);

        /**
         * Extra paint time after seek.
         * This avoids "Could not capture first frame" problems in browsers [1].
         */
        await new Promise((resolve) => setTimeout(resolve, 100));

        let prevFrame = captureFrame();

        if (!prevFrame) {
          throw new Error("Could not capture first frame");
        }

        const frames: FrameResult[] = [
          {
            frameIndex: 0,
            timeSeconds: 0,
            position: { x: seed.x, y: seed.y },
          },
        ];

        for (let fi = 1; fi < totalFrames; fi++) {
          const t = fi / fps;

          if (t > duration) break;

          await seekVideo(video, t);

          const nextFrame = captureFrame();

          if (!nextFrame) {
            console.warn(`Frame ${fi} capture failed, skipping`);
            continue;
          }

          const tracked = trackPointWithQuality(
            prevFrame,
            nextFrame,
            currentPoint
          );

          const candidate = tracked.point;

          const recentStep =
            previousAcceptedPoint !== null
              ? distance(currentPoint, previousAcceptedPoint)
              : 0;

          const maxJump = Math.max(
            MIN_MAX_JUMP_PX,
            recentStep * 3.5,
            nextFrame.height * MAX_JUMP_HEIGHT_FRACTION
          );

          const jump = distance(candidate, currentPoint);

          /**
           * Accept rules:
           * - confidence good enough, OR
           * - jump is plausible
           *
           * This avoids rejecting real fast drops purely because confidence drops.
           */
          const confidenceOk = tracked.confidence >= MIN_TRACK_CONFIDENCE;
          const jumpOk = jump <= maxJump;

          let acceptedPoint = currentPoint;

          if (confidenceOk || jumpOk) {
            previousAcceptedPoint = currentPoint;
            acceptedPoint = candidate;
            currentPoint = acceptedPoint;
            rejectedFrames = 0;
          } else {
            /**
             * Bad frame.
             * Do not follow the bad point.
             * Keep current point, but still advance frame reference
             * so we don't compare against stale old frames forever.
             */
            rejectedFrames++;

            console.warn("Rejected tracking point", {
              frame: fi,
              time: t.toFixed(2),
              confidence: tracked.confidence.toFixed(2),
              jump: jump.toFixed(1),
              maxJump: maxJump.toFixed(1),
              rejectedFrames,
            });
          }

          frames.push({
            frameIndex: fi,
            timeSeconds: t,
            position: {
              x: currentPoint.x / scale,
              y: currentPoint.y / scale,
            },
          });

          /**
           * Always advance the image frame.
           * This prevents one rejected frame from making the next optical-flow
           * step compare against an old stale image.
           */
          prevFrame = nextFrame;

          if (fi % 2 === 0) {
            setProgress(Math.round((fi / totalFrames) * 100));
          }
        }

        const smoothedFrames = smoothPositions(frames);

        setResult({
          frames: smoothedFrames,
          fps,
          videoWidth,
          videoHeight,
          durationSeconds: duration,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown analysis error");
      } finally {
        if (url) URL.revokeObjectURL(url);

        if (document.body.contains(video)) {
          document.body.removeChild(video);
        }

        videoRef.current = null;
        canvasRef.current = null;

        setIsAnalysing(false);
        setProgress(100);
      }
    },
    [captureFrame]
  );

  return {
    analyse,
    progress,
    isAnalysing,
    result,
    error,
  };
}