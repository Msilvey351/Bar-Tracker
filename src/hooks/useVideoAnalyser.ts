"use client";

import { useCallback, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";
import { seekVideo, waitUntilReady } from "@/lib/seekVideo";
import { trackPoint } from "@/lib/tracker";

interface UseVideoAnalyserReturn {
  analyse: (file: File, seed: Point) => Promise<void>;
  progress: number;           // 0–100
  isAnalysing: boolean;
  result: AnalysisResult | null;
  error: string | null;
}

/** Off-screen canvas used for frame capture */
const SCALED_WIDTH = 640;

export function useVideoAnalyser(): UseVideoAnalyserReturn {
  const [progress, setProgress] = useState(0);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Capture current video frame into an ImageData at SCALED_WIDTH.
   * Returns null if video isn't ready.
   */
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

      // Create off-screen video + canvas
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // Keep it off-screen but still in DOM so browsers can decode
      video.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;";
      document.body.appendChild(video);

      const canvas = document.createElement("canvas");
      videoRef.current = video;
      canvasRef.current = canvas;

      try {
        const url = URL.createObjectURL(file);
        video.src = url;

        // ── Wait for metadata ──────────────────────────────────────────────
        await new Promise<void>((res, rej) => {
          video.addEventListener("loadedmetadata", () => res(), { once: true });
          video.addEventListener("error", () => rej(new Error("Video load error")), { once: true });
          setTimeout(() => rej(new Error("Metadata timeout")), 10_000);
        });

        const fps = 30; // Browsers don't expose exact fps; assume 30
        const duration = video.duration;
        const totalFrames = Math.floor(duration * fps);
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        // ── Scale the seed to the canvas resolution ────────────────────────
        const scale = SCALED_WIDTH / videoWidth;
        let currentPoint: Point = {
          x: seed.x * scale,
          y: seed.y * scale,
        };

        // ── Wait until fully buffered ──────────────────────────────────────
        await waitUntilReady(video);

        // ── Seek to frame 0 and capture first frame ────────────────────────
        video.pause();
        await seekVideo(video, 0);
        // Extra paint time (key fix from referenced debugging session) [1]
        await new Promise((r) => setTimeout(r, 100));

        let prevFrame = captureFrame();
        if (!prevFrame) throw new Error("Could not capture first frame");

        const frames: FrameResult[] = [
          {
            frameIndex: 0,
            timeSeconds: 0,
            position: { x: seed.x, y: seed.y },
          },
        ];

        // ── Frame-by-frame loop ────────────────────────────────────────────
        for (let fi = 1; fi < totalFrames; fi++) {
          const t = fi / fps;
          if (t > duration) break;

          await seekVideo(video, t);

          const nextFrame = captureFrame();
          if (!nextFrame) {
            console.warn(`Frame ${fi} capture failed, skipping`);
            continue;
          }

          const newPoint = trackPoint(prevFrame, nextFrame, currentPoint);
          currentPoint = newPoint;

          // Convert back to original video coords
          frames.push({
            frameIndex: fi,
            timeSeconds: t,
            position: {
              x: newPoint.x / scale,
              y: newPoint.y / scale,
            },
          });

          prevFrame = nextFrame;
          setProgress(Math.round((fi / totalFrames) * 100));
        }

        setResult({ frames, fps, videoWidth, videoHeight, durationSeconds: duration });
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown analysis error");
      } finally {
        document.body.removeChild(video);
        videoRef.current = null;
        canvasRef.current = null;
        setIsAnalysing(false);
        setProgress(100);
      }
    },
    [captureFrame]
  );

  return { analyse, progress, isAnalysing, result, error };
}