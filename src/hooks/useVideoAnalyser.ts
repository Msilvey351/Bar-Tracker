"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, FrameResult, Point } from "@/types";
import { seekVideo } from "@/lib/seekVideo";

interface UseVideoAnalyserReturn {
  analyse:       (file: File, seed: Point) => Promise<void>;
  progress:      number;
  isAnalysing:   boolean;
  result:        AnalysisResult | null;
  error:         string | null;
  liveFrames:    FrameResult[];
  liveFps:       number;
  liveVideoDims: { width: number; height: number } | null;
  debugMsg:      string;
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
  const [debugMsg,      setDebugMsg]      = useState<string>("");

  const workerRef = useRef<Worker | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // ── Spin up initial worker ───────────────────────────────────────────────
  useEffect(() => {
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
      setDebugMsg("");

      abortRef.current = new AbortController();

      if (workerRef.current) {
        workerRef.current.terminate();
      }

      const freshWorker = new Worker(
        new URL("../workers/tracker.worker.ts", import.meta.url),
        { type: "module" }
      );

      freshWorker.addEventListener("message", (e) => {
        if (e.data?.type === "log") {
          if (e.data.level === "warn") console.warn("[worker]", ...e.data.args);
          else console.log("[worker]", ...e.data.args);
        }
      });

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
      
      // FIREFOX FIX: Force the video to be technically visible
      video.style.cssText = "position:fixed; bottom:10px; right:10px; width:100px; height:100px; opacity:1; z-index:9999; pointer-events:none;"
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
        const targetFps   = chooseAnalysisFps(duration); 
        
        const videoWidth  = video.videoWidth;
        const videoHeight = video.videoHeight;
        const scale       = SCALED_WIDTH / videoWidth;
        const scaledH     = Math.round(videoHeight * scale);

        canvas.width  = SCALED_WIDTH;
        canvas.height = scaledH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Could not get canvas context");

        setLiveVideoDims({ width: videoWidth, height: videoHeight });

        let currentPoint: Point = { x: seed.x * scale, y: seed.y * scale };

        await workerInit(SCALED_WIDTH, scaledH);

        const allFrames: FrameResult[] = [];
        let seeded = false;

        // Use an explicit type cast to bypass TypeScript's control flow narrowing issues
        const supportsRVFC = typeof (video as any).requestVideoFrameCallback === "function";
        let finalFps = targetFps;

        if (supportsRVFC) {
          console.log("Using fast requestVideoFrameCallback loop");
          
          let framesProcessed = 0;
          let lastProcessedTime = -1;
          
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

              // DEBUG DISPLAY
              if (framesProcessed % 5 === 0) {
                const cx = Math.floor(SCALED_WIDTH / 2);
                const cy = Math.floor(scaledH / 2);
                const idx = (cy * SCALED_WIDTH + cx) * 4;
                setDebugMsg(`RVFC Frame ${framesProcessed}: RGB(${imageData.data[idx]}, ${imageData.data[idx+1]}, ${imageData.data[idx+2]})`);
              }

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
                      console.log("Safety timeout hit - ending loop early.");
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

          finalFps = allFrames.length / duration;

        } else {
          console.log("Browser does not support RVFC (Firefox/Old Safari). Using manual seek loop.");
          
          const totalTargetFrames = Math.floor(duration * targetFps);
          
          video.pause();
          await seekVideo(video, 0);
          await new Promise((r) => setTimeout(r, 100)); 

          ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
          const firstImageData = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);
          
          await workerSeed(currentPoint.x, currentPoint.y, firstImageData);
          seeded = true;
          
          allFrames.push({
            frameIndex: 0,
            timeSeconds: 0,
            position: { x: seed.x, y: seed.y },
          });

          for (let fi = 1; fi < totalTargetFrames; fi++) {
            if (abortRef.current?.signal.aborted) break;

            const t = fi / targetFps;
            if (t > duration) break;

            await seekVideo(video, t);
            
            await new Promise((r) => setTimeout(r, 30)); 
            
            ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
            const imageData = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);

            // DEBUG DISPLAY
            if (fi % 5 === 0) {
              const cx = Math.floor(SCALED_WIDTH / 2);
              const cy = Math.floor(scaledH / 2);
              const idx = (cy * SCALED_WIDTH + cx) * 4;
              setDebugMsg(`Seek Frame ${fi}: RGB(${imageData.data[idx]}, ${imageData.data[idx+1]}, ${imageData.data[idx+2]})`);
            }

            const { newPoint, frameResult } = await processFrame(
                imageData, t, fi, scale, currentPoint
            );

            currentPoint = newPoint;
            allFrames.push(frameResult);

            if (fi % 5 === 0) {
               setProgress(Math.round((fi / totalTargetFrames) * 100));
            }
          }
          finalFps = targetFps; 
        }

        // ── Smooth and emit final result ─────────────────────────────────────────
        const smoothed = smoothPositions(allFrames);
        setLiveFrames(smoothed);
        setLiveFps(finalFps);

        setResult({
          frames: smoothed,
          fps: finalFps,
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
    debugMsg,
  };
}