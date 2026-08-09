"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameResult, Point } from "@/types";

const SCALED_WIDTH = 160;
const isMobile =
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function useLiveAnalyser() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Expose the live point so the UI can draw a dot over the video
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  
  // Expose the final recorded video so the Results step can play it
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const framesRef = useRef<FrameResult[]>([]);
  const loopRef = useRef<number | null>(null);
  
  // Refs for the background video recorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // 1. Initialize Worker
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

  // 2. Start Camera (Back camera preferred)
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
    } catch (e) {
      setError("Could not access camera. Please check permissions.");
    }
  };

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  // 3. Start Tracking (Triggered when user taps the plate)
  const startTracking = async (seedX: number, seedY: number) => {
    const video = videoRef.current;
    if (!video || !workerRef.current) return;

    // --- START VIDEO RECORDING ---
    if (stream) {
      recordedChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setRecordedVideoBlob(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      // Start recording, collecting a chunk every 100ms
      mediaRecorder.start(100); 
    }
    // -----------------------------

    framesRef.current = [];
    setIsTracking(true);

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

    // Grab first frame and seed
    ctx.drawImage(video, 0, 0, SCALED_WIDTH, scaledH);
    const firstImage = ctx.getImageData(0, 0, SCALED_WIDTH, scaledH);
    
    let trackerPoint = { x: seedX * scale, y: seedY * scale };
    await workerSend({ type: "seed", x: trackerPoint.x, y: trackerPoint.y, imageData: firstImage }, "ack", [firstImage.data.buffer]);

    const startTime = performance.now();
    let frameIndex = 0;

    // The tracking loop
    const trackLoop = async () => {
      // Allow exiting cleanly
      if (!isTracking && framesRef.current.length > 0) return; 
      
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

      frameIndex++;
      loopRef.current = requestAnimationFrame(trackLoop);
    };

    trackLoop();
  };

  // 4. End the set and return the frames
  const stopTracking = (): FrameResult[] => {
    setIsTracking(false);
    
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    
    // --- STOP VIDEO RECORDING ---
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // ----------------------------

    stopCamera();
    return framesRef.current;
  };

  return {
    stream,
    videoRef,
    isTracking,
    error,
    currentPoint,
    recordedVideoBlob,
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
  };
}