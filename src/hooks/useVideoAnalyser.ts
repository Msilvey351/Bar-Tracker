"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";

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

const SCALED_WIDTH             = 320;
const MAX_JUMP_HEIGHT_FRACTION = 0.18;
const MIN_MAX_JUMP_PX          = 20;
const SMOOTHING_WINDOW         = 3;

const isMobile = typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

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

export function useVideoAnalyser(): UseVideoAnalyserReturn {
  const [progress,      setProgress]      = useState(0);
  const [isAnalysing,   setIsAnalysing]   = useState(false);
  const [result,        setResult]        = useState<AnalysisResult | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [liveFrames,    setLiveFrames]    = useState<FrameResult[]>([]);
  const [liveFps,       setLiveFps]       = useState(0);
  const [liveVideoDims, setLiveVideoDims] = useState<{ width: number; height: number } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // ── Spin up initial worker ───────────────────────────────────────────────
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

  const workerInit = useCallback(
    async (width: number, height: number): Promise<void> => {
      await workerSend({ type: "init", width, height, isMobile }, "ack");
    },
    [workerSend]
  );

  const workerSeed = useCallback(
    async (x: number, y: number, imageData: ImageData): Promise<void> => {
      await workerSend(
        { type: "seed", x, y, imageData },
        "ack",
        [imageData.data.buffer]
      );
    },
    [workerSend]
  );

  const workerTrack = useCallback(
    async (frame: ImageData): Promise<{ x: number; y: number; confidence: number; tracked: boolean; }> => {
      const result = await workerSend(
        { type: "track", imageData: frame },
        "result",
        [frame.data.buffer]
      );
      return result as { x: number; y: number; confidence: number; tracked: boolean; };
    },
    [workerSend]
  );

  const processFrame = useCallback(
    async (
      imageData:     ImageData,
      timeSeconds:   number,
      frameIndex:    number,
      scale:         number,
      currentPoint:  { x: number; y: number },
    ): Promise<{
      newPoint:    { x: number; y: number };
      frameResult: FrameResult;
    }> => {
      
      const tracked   = await workerTrack(imageData);
      const newPoint = tracked.tracked ? { x: tracked.x, y: tracked.y } : currentPoint;

      return {
        newPoint,
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

  // ── Main analysis entry point ─────────────────────────────────────────────
  const analyse = useCallback(
    async (file: File, seed: Point) => {
      setIsAnalysing(true);
      setProgress(0);
      setResult(null);
      setError(null);
      setLiveFrames([]);
      setLiveVideoDims(null);

      abortRef.current = new AbortController();

      // Ensure a fresh worker for every analysis
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      const freshWorker = new Worker(
        new URL("../workers/tracker.worker.ts", import.meta.url),
        { type: "module" }
      );

      workerRef.current = freshWorker;

      await new Promise<void>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === "ack") {
            freshWorker.removeEventListener("message", handler);
            resolve();
          }
        };
        freshWorker.addEventListener("message", handler);
        setTimeout(() => {
          freshWorker.removeEventListener("message", handler);
          resolve();
        }, 3000);
      });

      const video = document.createElement("video");
      video.muted       = true;
      video.playsInline = true;
      video.preload     = "auto";
      video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;";
      document.body.appendChild(video);

      const canvas = document.createElement("canvas");
      let url: string | null = null;

      try {
        url = URL.createObjectURL(file);
        video.src = url;

        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error("Video load error")), { once: true });
          setTimeout(() => reject(new Error("Metadata timeout")), 10_000);
        });

        await new Promise<void>((resolve) => {
           if (video.readyState >= 3) {
             resolve();
           } else {
             video.addEventListener("canplaythrough", () => resolve(), { once: true });
             setTimeout(resolve, 5000);
           }
        });

        const duration    = video.duration;
        const approximateFps = chooseAnalysisFps(duration); 
        
        const videoWidth  = video.videoWidth;
        const videoHeight = video.videoHeight;
        const scale       = SCALED_WIDTH / videoWidth;
        const scaledH     = Math.round(videoHeight * scale);

        canvas.width  = SCALED_WIDTH;
        canvas.height = scaledH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Could not get canvas context");

        setLiveFps(approximateFps);
        setLiveVideoDims({ width: videoWidth, height: videoHeight });

        let currentPoint: Point = { x: seed.x * scale, y: seed.y * scale };

        await workerInit(SCALED_WIDTH, scaledH);

        const allFrames: FrameResult[] = [];
        let seeded = false;
        let framesProcessed = 0;
        let lastProcessedTime = -1;

        if (typeof (video as any).requestVideoFrameCallback !== "function") {
           throw new Error("Browser does not support hardware video processing. Please use Chrome or Safari.");
        }
        
        // Fast hardware-synced playback loop
        await new Promise<void>((resolve, reject) => {
          
          let safetyTimeout: NodeJS.Timeout;
          let isFinished = false;

          const finish = () => {
             if (isFinished) return;
             isFinished = true;
             clearTimeout(safetyTimeout);
             video.pause();
             resolve();
          };

          video.addEventListener("ended", finish, { once: true });

          const processNextFrame = async (now: number, metadata: VideoFrameCallbackMetadata) => {
            if (abortRef.current?.signal.aborted || isFinished) {
              finish(); return;
            }
            clearTimeout(safetyTimeout);

            const currentTime = metadata.mediaTime;
            
            if (currentTime === lastProcessedTime) {
               if (!video.ended && !video.paused) {
                 video.requestVideoFrameCallback(processNextFrame);
               } else {
                 finish();
               }
               return;
            }
            lastProcessedTime = currentTime;

            ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
            const imageData = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);

            if (!seeded) {
              await workerSeed(currentPoint.x, currentPoint.y, imageData);
              seeded = true;
              allFrames.push({
                frameIndex: 0,
                timeSeconds: currentTime,
                position: { x: seed.x, y: seed.y },
              });
            } else {
              const { newPoint, frameResult } = await processFrame(
                imageData, currentTime, framesProcessed, scale, currentPoint
              );
              currentPoint = newPoint;
              allFrames.push(frameResult);
            }

            framesProcessed++;
            if (framesProcessed % 10 === 0) {
               setProgress(Math.round((currentTime / duration) * 100));
            }

            if (!video.ended && currentTime < duration - 0.05) {
               if (video.paused && !document.hidden) video.play().catch(reject);
               
               if (!document.hidden) {
                 safetyTimeout = setTimeout(() => {
                    finish();
                 }, 500);
               }
               video.requestVideoFrameCallback(processNextFrame);
            } else {
               finish();
            }
          };

          const handleVisibilityChange = () => {
             if (document.hidden) {
               clearTimeout(safetyTimeout);
               video.pause();
             } else {
               if (!isFinished && !video.ended && video.currentTime < duration - 0.05) {
                 video.play().catch(console.error);
               }
             }
          };
          
          document.addEventListener("visibilitychange", handleVisibilityChange);
          video.currentTime = 0;
          video.requestVideoFrameCallback(processNextFrame);
          video.play().catch(reject);
          
          const cleanup = () => { document.removeEventListener("visibilitychange", handleVisibilityChange); };
          const originalFinish = finish;
          const finishWithCleanup = () => { cleanup(); originalFinish(); }
          
          video.removeEventListener("ended", finish);
          video.addEventListener("ended", finishWithCleanup, { once: true });
        });

        // ── Smooth and emit final result ─────────────────────────────────────────
        const smoothed = smoothPositions(allFrames);
        setLiveFrames(smoothed);

        const trueFps = allFrames.length / duration;

        setResult({
          frames: smoothed,
          fps: trueFps,
          videoWidth,
          videoHeight,
          durationSeconds: duration,
        });

      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (url) URL.revokeObjectURL(url);
        if (document.body.contains(video)) document.body.removeChild(video);
        setIsAnalysing(false);
        setProgress(100);
      }
    },
    [workerInit, workerSeed, processFrame]
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