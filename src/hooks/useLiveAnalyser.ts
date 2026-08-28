"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameResult, Point } from "@/types";

const SCALED_WIDTH = 360;
const SMOOTHING_WINDOW = 3;

// Keeps your existing smoothing for the final export
function medianOf(values: number[]): number {
  if (!values.length) return 0;
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
        x: medianOf(slice.map((f) => f.position.x)),
        y: medianOf(slice.map((f) => f.position.y)),
      },
    };
  });
}

const isMobile =
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function useLiveAnalyser() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false); 
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [liveVelocity, setLiveVelocity] = useState<number | null>(null);
  const [thresholdMet, setThresholdMet] = useState(false);
  
  const [audioEnabled, setAudioEnabled] = useState(true);
  const audioEnabledRef = useRef(true); 
  
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const framesRef = useRef<FrameResult[]>([]);
  const loopRef = useRef<number | null>(null);
  const isTrackingRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/tracker.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    };
  }, []);

  const workerSend = useCallback(
    (message: any, waitForType: string, transfer?: Transferable[]): Promise<any> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) return resolve({});
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

  const startCamera = async (mode: "environment" | "user" = "environment") => {
    try {
      setPermissionDenied(false); 
      
      setStream((prev) => {
        if (prev) prev.getTracks().forEach((t) => t.stop());
        return null;
      });

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      setFacingMode(mode);
    } catch (e: any) { 
      setError("Could not access camera. Please check permissions.");
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      }
    }
  };

  const toggleCamera = () => {
    startCamera(facingMode === "environment" ? "user" : "environment");
  };

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startTracking = async (seedX: number, seedY: number, plateHeightPx?: number, lossThresholdPct?: number | null) => {
    const video = videoRef.current;
    if (!video || !workerRef.current) return;

    if (audioEnabledRef.current && 'speechSynthesis' in window) {
      const silent = new SpeechSynthesisUtterance("");
      window.speechSynthesis.speak(silent);
    }

    if (stream) {
      recordedChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); 
    }

    framesRef.current = [];
    setIsTracking(true);
    isTrackingRef.current = true;
    setLiveVelocity(null);
    setThresholdMet(false); 

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const scale = SCALED_WIDTH / videoWidth;
    const scaledH = Math.round(videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = SCALED_WIDTH;
    canvas.height = scaledH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    await workerSend({ type: "init", width: SCALED_WIDTH, height: scaledH, isMobile }, "ack");

    ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
    const firstImage = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);
    
    let trackerPoint = { x: seedX * scale, y: seedY * scale };
    
    await workerSend({ type: "seed", x: trackerPoint.x, y: trackerPoint.y, imageData: firstImage }, "ack", [firstImage.data.buffer]);

    const startTime = performance.now();
    let frameIndex = 0;

    let currentPhase = 'idle'; // 'idle' or 'concentric'
    let bottomY = 0;
    let bottomTime = 0;
    let topY = 0;
    let topTime = 0;
    
    // ✨ INCREASED THE WINDOW SIZE to match the post-analysis smoothing
    const RECENT_BUFFER_SIZE = 9; 
    const rawYs: number[] = [];
    const recentTimes: number[] = [];
    const pxPerM = plateHeightPx ? plateHeightPx / 0.45 : null;

    let maxRepVelocity = 0;

    const trackLoop = async () => {
      if (!isTrackingRef.current && framesRef.current.length > 0) return; 
      
      ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
      const frameData = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);
      
      const result = await workerSend({ type: "track", imageData: frameData }, "result", [frameData.data.buffer]);
      
      if (result.tracked) {
        trackerPoint = { x: result.x, y: result.y };
      }

      const timeSeconds = (performance.now() - startTime) / 1000;
      const realPoint = { x: trackerPoint.x / scale, y: trackerPoint.y / scale };
      setCurrentPoint(realPoint);

      framesRef.current.push({
        frameIndex,
        timeSeconds,
        position: realPoint,
      });

      if (pxPerM) {
        rawYs.push(realPoint.y);
        recentTimes.push(timeSeconds);
        
        if (rawYs.length > RECENT_BUFFER_SIZE) {
          rawYs.shift();
          recentTimes.shift();
        }

        // ✨ We wait until we have enough frames to apply smoothing
        if (rawYs.length === RECENT_BUFFER_SIZE) {
          
          // ✨ NEW: We calculate the smoothed Y position of the middle frame in our buffer
          // using the same median logic as your post-analysis.
          const midIndex = Math.floor(RECENT_BUFFER_SIZE / 2);
          const smoothedY = medianOf(rawYs); 
          const smoothedTime = recentTimes[midIndex];

          // We also need the smoothed Y from a few frames ago to calculate velocity direction
          const prevSmoothedY = medianOf(rawYs.slice(0, midIndex));
          const prevTime = recentTimes[0];

          const dt = smoothedTime - prevTime;
          const dy = prevSmoothedY - smoothedY; // Positive = Moving UP
          const velM = (dy / pxPerM) / dt;

          if (currentPhase === 'idle') {
            if (velM > 0.08) { 
              currentPhase = 'concentric';
              bottomY = smoothedY; // Use the smoothed turning point
              bottomTime = smoothedTime;
              topY = smoothedY;
              topTime = smoothedTime;
            }
          } else if (currentPhase === 'concentric') {
            if (smoothedY < topY) {
              topY = smoothedY;
              topTime = smoothedTime;
            }

            if (velM < -0.05) { 
              currentPhase = 'idle';
              
              const distM = (bottomY - topY) / pxPerM;
              const durS = topTime - bottomTime;
              
              if (distM > 0.15 && durS > 0.1) {
                const avgVel = distM / durS;
                setLiveVelocity(avgVel);

                let isStopSet = false;

                if (maxRepVelocity === 0) {
                  maxRepVelocity = avgVel;
                } else {
                  if (avgVel > maxRepVelocity) maxRepVelocity = avgVel; 
                  
                  if (lossThresholdPct) {
                    const velocityLoss = ((maxRepVelocity - avgVel) / maxRepVelocity) * 100;
                    if (velocityLoss >= lossThresholdPct) {
                      isStopSet = true;
                      setThresholdMet(true);
                    }
                  }
                }

                if (audioEnabledRef.current && 'speechSynthesis' in window) {
                  window.speechSynthesis.cancel(); 
                  const text = isStopSet ? `${avgVel.toFixed(2)}. Stop set!` : avgVel.toFixed(2);
                  const utterance = new SpeechSynthesisUtterance(text);
                  utterance.rate = 1.1; 
                  window.speechSynthesis.speak(utterance);
                }
              }
            }
          }
        }
      }

      frameIndex++;
      loopRef.current = requestAnimationFrame(trackLoop);
    };

    trackLoop();
  };

  const stopTracking = (): Promise<{ frames: FrameResult[], blob: Blob | null }> => {
    return new Promise((resolve) => {
      setIsTracking(false);
      isTrackingRef.current = false;
      
      if (loopRef.current) cancelAnimationFrame(loopRef.current);

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = () => {
          const finalBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          setRecordedVideoBlob(finalBlob);
          stopCamera();
          const smoothedFrames = smoothPositions(framesRef.current);
          resolve({ frames: smoothedFrames, blob: finalBlob });
        };
        mediaRecorderRef.current.stop(); 
      } else {
        stopCamera();
        const smoothedFrames = smoothPositions(framesRef.current);
        resolve({ frames: smoothedFrames, blob: null });
      }
    });
  };

  return {
    stream,
    videoRef,
    isTracking,
    error,
    permissionDenied,
    currentPoint,
    recordedVideoBlob,
    liveVelocity,
    audioEnabled,    
    setAudioEnabled,
    thresholdMet, 
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
    toggleCamera, 
  };
}