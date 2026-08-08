"use client";

import { useEffect, useRef } from "react";
import { useLiveAnalyser } from "@/hooks/useLiveAnalyser";
import type { FrameResult } from "@/types";

interface LiveTrackerProps {
  onSetComplete: (frames: FrameResult[], fps: number, width: number, height: number) => void;
  onCancel: () => void;
}

export function LiveTracker({ onSetComplete, onCancel }: LiveTrackerProps) {
  const {
    stream,
    videoRef,
    isTracking,
    currentPoint,
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
  } = useLiveAnalyser();

  const containerRef = useRef<HTMLDivElement>(null);

  // Start camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Connect stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  const handleVideoTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (isTracking || !videoRef.current) return;

    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoRef.current.videoWidth / rect.width;
    const scaleY = videoRef.current.videoHeight / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    startTracking(x, y);
  };

  const handleStop = () => {
    const frames = stopTracking();
    if (!videoRef.current || frames.length === 0) return onCancel();

    // Approximate FPS based on total frames and total time
    const duration = frames[frames.length - 1].timeSeconds;
    const estimatedFps = frames.length / duration;

    onSetComplete(
      frames,
      estimatedFps,
      videoRef.current.videoWidth,
      videoRef.current.videoHeight
    );
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold">{isTracking ? "Tracking Live" : "Live Camera"}</h2>
        <p className="text-sm text-gray-500">
          {isTracking 
            ? "Lift! Tap Stop when finished." 
            : "Stand the bar in frame. Tap the plate to start."}
        </p>
      </div>

      <div 
        ref={containerRef} 
        className="relative w-full aspect-[3/4] bg-black rounded-lg overflow-hidden border border-zinc-800"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onClick={handleVideoTap}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Draw a red crosshair on the tracked point */}
        {isTracking && currentPoint && videoRef.current && (
          <div
            className="absolute w-6 h-6 border-2 border-red-500 rounded-full flex items-center justify-center pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${(currentPoint.x / videoRef.current.videoWidth) * 100}%`,
              top: `${(currentPoint.y / videoRef.current.videoHeight) * 100}%`,
            }}
          >
            <div className="w-1 h-1 bg-red-500 rounded-full" />
          </div>
        )}
      </div>

      <div className="w-full flex gap-4">
        {isTracking ? (
          <button
            onClick={handleStop}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl text-xl transition-all"
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