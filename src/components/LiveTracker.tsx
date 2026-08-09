"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveAnalyser } from "@/hooks/useLiveAnalyser";
import { loadModel, detectBarbell } from "@/lib/yolo";
import type { FrameResult } from "@/types";

interface LiveTrackerProps {
  onSetComplete: (frames: FrameResult[], fps: number, width: number, height: number, plateHeightPx: number, videoBlob: Blob) => void;
  onCancel: () => void;
}

export function LiveTracker({ onSetComplete, onCancel }: LiveTrackerProps) {
  const {
    stream,
    videoRef,
    isTracking,
    currentPoint,
    recordedVideoBlob,
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
  } = useLiveAnalyser();

  const [aiBox, setAiBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const scanLoopRef = useRef<number | null>(null);

  // Start camera and load AI model
  useEffect(() => {
    startCamera();
    loadModel().then(() => setModelLoading(false));
    return () => {
      stopCamera();
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  // AI Scanning Loop (runs before tracking starts)
  useEffect(() => {
    if (isTracking || modelLoading || !videoRef.current) return;

    const scan = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }
      
      // Run the frame through our custom YOLO model
      const box = await detectBarbell(videoRef.current);
      setAiBox(box);

      // Loop it
      if (!isTracking) {
        scanLoopRef.current = requestAnimationFrame(scan);
      }
    };

    scan();

    return () => {
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    };
  }, [isTracking, modelLoading, videoRef]);

  const handleVideoTap = () => {
    if (isTracking || !videoRef.current || !aiBox) return;

    // We pass the exact center of the AI's box to the Optical Flow tracker
    startTracking(aiBox.x, aiBox.y);
  };

  const handleStop = () => {
    const frames = stopTracking();
    
    // Give the MediaRecorder 150ms to compress the final chunks into the Blob
    setTimeout(() => {
      if (!videoRef.current || frames.length === 0 || !aiBox || !recordedVideoBlob) {
        return onCancel();
      }

      const duration = frames[frames.length - 1].timeSeconds;
      const estimatedFps = frames.length / duration;

      // We pass aiBox.height back to App.tsx for perfect auto-calibration!
      onSetComplete(
        frames,
        estimatedFps,
        videoRef.current.videoWidth,
        videoRef.current.videoHeight,
        aiBox.height,
        recordedVideoBlob // Send the completed video file!
      );
    }, 150);
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto space-y-4">
      <div className="text-center space-y-1 h-12 flex flex-col justify-center">
        {modelLoading ? (
          <p className="text-sm text-orange-400 animate-pulse">Loading AI Vision...</p>
        ) : isTracking ? (
          <h2 className="text-2xl font-bold text-green-400">Recording Set 🟢</h2>
        ) : aiBox ? (
          <p className="text-sm text-emerald-400 font-bold">Plate locked! Tap anywhere to start.</p>
        ) : (
          <p className="text-sm text-white/50">Stand back. Looking for weight plate...</p>
        )}
      </div>

      <div className="relative w-full aspect-[3/4] bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onClick={handleVideoTap}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* 1. Show the AI's Green Bounding Box before they tap */}
        {!isTracking && aiBox && videoRef.current && (
          <div
            className="absolute border-2 border-emerald-500 bg-emerald-500/10 transition-all duration-75 pointer-events-none"
            style={{
              left: `${((aiBox.x - aiBox.width / 2) / videoRef.current.videoWidth) * 100}%`,
              top: `${((aiBox.y - aiBox.height / 2) / videoRef.current.videoHeight) * 100}%`,
              width: `${(aiBox.width / videoRef.current.videoWidth) * 100}%`,
              height: `${(aiBox.height / videoRef.current.videoHeight) * 100}%`,
            }}
          />
        )}

        {/* 2. Show the Red Optical Flow crosshair while they are lifting */}
        {isTracking && currentPoint && videoRef.current && (
          <div
            className="absolute w-8 h-8 border-2 border-red-500 rounded-full flex items-center justify-center pointer-events-none transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
            style={{
              left: `${(currentPoint.x / videoRef.current.videoWidth) * 100}%`,
              top: `${(currentPoint.y / videoRef.current.videoHeight) * 100}%`,
            }}
          >
            <div className="w-2 h-2 bg-red-500 rounded-full" />
          </div>
        )}
      </div>

      <div className="w-full flex gap-4">
        {isTracking ? (
          <button
            onClick={handleStop}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl text-xl transition-all shadow-lg"
          >
            END SET
          </button>
        ) : (
          <button
            onClick={() => { stopCamera(); onCancel(); }}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-lg"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}