"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveAnalyser } from "@/hooks/useLiveAnalyser";
import { loadModel, detectBarbell } from "@/lib/yolo";
import type { FrameResult } from "@/types";

interface LiveTrackerProps {
  onSetComplete: (
    frames: FrameResult[],
    fps: number,
    width: number,
    height: number,
    plateHeightPx: number,
    videoBlob: Blob
  ) => void;
  onCancel: () => void;
}

type DragTarget = "crosshair" | "topLine" | "bottomLine" | null;

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
    toggleCamera, // ✨ NEW: pull this from the hook
  } = useLiveAnalyser();

  const containerRef = useRef<HTMLDivElement>(null);

  // AI & Scanning States
  const [modelLoading, setModelLoading] = useState(true);
  const [aiBox, setAiBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Timeout States
  const [scanFailed, setScanFailed] = useState(false);
  const scanStartTimeRef = useRef<number | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  // Manual Mode States
  const [isManualMode, setIsManualMode] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragTarget>(null);
  const [crosshair, setCrosshair] = useState({ x: 50, y: 50 });
  const [topLine, setTopLine] = useState(30);
  const [bottomLine, setBottomLine] = useState(70);

  // State to hold the final plate height (either from AI or Manual) to pass to Results
  const [finalPlateHeight, setFinalPlateHeight] = useState<number | null>(null);

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

  // AI Scanning Loop
  const startScanning = () => {
    setScanFailed(false);
    setAiBox(null);
    scanStartTimeRef.current = Date.now();

    const scan = async () => {
      if (isTracking || isManualMode) return; // Stop scanning if tracking or manual
      
      if (!videoRef.current || videoRef.current.readyState < 2) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }

      // Check timeout (e.g., 5 seconds)
      if (scanStartTimeRef.current && Date.now() - scanStartTimeRef.current > 5000) {
        setScanFailed(true);
        return; // Break the loop
      }

      const box = await detectBarbell(videoRef.current);
      
      if (box) {
        setAiBox(box);
        setFinalPlateHeight(box.height);
      } else {
        scanLoopRef.current = requestAnimationFrame(scan);
      }
    };

    scanLoopRef.current = requestAnimationFrame(scan);
  };

  // Start scanning when model is loaded and not in manual mode
  useEffect(() => {
    if (modelLoading || isManualMode || isTracking || aiBox) return;
    startScanning();

    return () => {
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    };
  }, [modelLoading, isManualMode, isTracking, aiBox]);

  // Handle Dragging for Manual Mode
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeDrag || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const xPercent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    if (activeDrag === "crosshair") setCrosshair({ x: xPercent, y: yPercent });
    if (activeDrag === "topLine") setTopLine(yPercent);
    if (activeDrag === "bottomLine") setBottomLine(yPercent);
  };

  const handlePointerUp = () => setActiveDrag(null);

  // Start the actual tracking process
  const beginTracking = () => {
    if (!videoRef.current) return;

    if (isManualMode) {
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      
      const cx = (crosshair.x / 100) * vw;
      const cy = (crosshair.y / 100) * vh;
      const ty = (topLine / 100) * vh;
      const by = (bottomLine / 100) * vh;
      
      const manualPlateHeightPx = Math.abs(by - ty);
      setFinalPlateHeight(manualPlateHeightPx);
      startTracking(cx, cy);
    } else if (aiBox) {
      // AI Mode Start
      startTracking(aiBox.x, aiBox.y);
    }
  };

  const handleStop = async () => {
    const { frames, blob } = await stopTracking();
    
    if (!videoRef.current || frames.length === 0 || !finalPlateHeight || !blob || blob.size === 0) {
      console.error("Missing data to complete set");
      return onCancel();
    }

    const duration = frames[frames.length - 1].timeSeconds;
    const estimatedFps = frames.length / duration;

    onSetComplete(
      frames,
      estimatedFps,
      videoRef.current.videoWidth,
      videoRef.current.videoHeight,
      finalPlateHeight,
      blob 
    );
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto space-y-4">
      {/* Header Text Area */}
      <div className="text-center space-y-1 h-12 flex flex-col justify-center">
        {modelLoading ? (
          <p className="text-sm text-orange-400 animate-pulse">Loading AI Vision...</p>
        ) : isTracking ? (
          <h2 className="text-2xl font-bold text-green-400">Recording Set 🟢</h2>
        ) : isManualMode ? (
          <p className="text-sm text-blue-400 font-bold">Align the crosshair and bracket the plate.</p>
        ) : scanFailed ? (
          <p className="text-sm text-red-400 font-bold">Could not find a plate.</p>
        ) : aiBox ? (
          <p className="text-sm text-emerald-400 font-bold">Plate locked! Ready to start.</p>
        ) : (
          <p className="text-sm text-white/50">Stand back. Looking for weight plate...</p>
        )}
      </div>

      {/* Video Container */}
      <div 
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="relative w-full aspect-[3/4] bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-xl touch-none select-none"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* ✨ NEW: Flip Camera Button */}
        {!isTracking && (
          <button
            onClick={(e) => {
              e.stopPropagation(); // Prevents dragging lines by mistake
              toggleCamera();
            }}
            className="absolute top-4 right-4 z-30 w-10 h-10 bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-white shadow-lg transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}

        {/* AI Bounding Box Overlay */}
        {!isTracking && !isManualMode && aiBox && videoRef.current && (
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

        {/* Manual Calibration Overlay */}
        {!isTracking && isManualMode && (
          <>
            {/* Top Line */}
            <div
              className="absolute left-0 right-0 h-12 -mt-6 cursor-row-resize flex items-center justify-center z-10 touch-none"
              style={{ top: `${topLine}%` }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("topLine"); }}
            >
              <div className="w-full border-t-[3px] border-dashed border-blue-500 shadow-sm opacity-80" />
              <span className="absolute bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full right-4">
                Top of Plate
              </span>
            </div>

            {/* Bottom Line */}
            <div
              className="absolute left-0 right-0 h-12 -mt-6 cursor-row-resize flex items-center justify-center z-10 touch-none"
              style={{ top: `${bottomLine}%` }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("bottomLine"); }}
            >
              <div className="w-full border-t-[3px] border-dashed border-blue-500 shadow-sm opacity-80" />
              <span className="absolute bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full right-4">
                Bottom of Plate
              </span>
            </div>

            {/* Crosshair */}
            <div
              className="absolute w-16 h-16 -ml-8 -mt-8 cursor-move flex items-center justify-center z-20 touch-none"
              style={{ left: `${crosshair.x}%`, top: `${crosshair.y}%` }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("crosshair"); }}
            >
              <div className="w-10 h-10 rounded-full border-[3px] border-orange-500 bg-orange-500/30 flex items-center justify-center shadow-lg">
                <div className="w-1.5 h-1.5 bg-white rounded-full shadow-md" />
              </div>
            </div>
          </>
        )}

        {/* Live Tracking Red Dot */}
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

      {/* Buttons Area */}
      <div className="w-full flex flex-col gap-3">
        {isTracking ? (
          <button
            onClick={handleStop}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl text-xl transition-all shadow-lg"
          >
            END SET
          </button>
        ) : scanFailed && !isManualMode ? (
          // Timeout State Buttons
          <div className="flex gap-3 w-full">
            <button
              onClick={startScanning}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-4 rounded-xl font-semibold transition-all"
            >
              Try Again 🔄
            </button>
            <button
              onClick={() => setIsManualMode(true)}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-4 rounded-xl font-bold transition-all"
            >
              Select Manually 🎯
            </button>
          </div>
        ) : (
          // Normal State Button (AI Ready or Manual Ready)
          <button
            onClick={beginTracking}
            disabled={!aiBox && !isManualMode}
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all ${
              (aiBox || isManualMode)
                ? "bg-emerald-500 text-white hover:bg-emerald-600 hover:shadow-emerald-500/20"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
            }`}
          >
            {isManualMode ? "Start Tracking 🚀" : aiBox ? "Start Tracking 🚀" : "Waiting..."}
          </button>
        )}

        {/* Fallback "Switch to Manual" button if AI locked onto the wrong thing */}
        {!isTracking && aiBox && !isManualMode && (
          <button
            onClick={() => {
              setAiBox(null);
              setIsManualMode(true);
            }}
            className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
          >
            Not quite right? <span className="underline">Adjust Manually</span>
          </button>
        )}

        {/* Cancel Button */}
        {!isTracking && (
          <button
            onClick={() => { stopCamera(); onCancel(); }}
            className="w-full bg-transparent hover:bg-white/5 text-white/50 py-3 rounded-lg mt-2"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}