"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveAnalyser } from "@/hooks/useLiveAnalyser";
import { loadModel, detectBarbell } from "@/lib/yolo";
import type { FrameResult } from "@/types";
import { track } from '@vercel/analytics';

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
    permissionDenied, // ✨ NEW: Extract the new state
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
    toggleCamera, 
    liveVelocity,
    audioEnabled,    
    setAudioEnabled,
    thresholdMet, 
  } = useLiveAnalyser();

  const containerRef = useRef<HTMLDivElement>(null);

  const [modelLoading, setModelLoading] = useState(true);
  const [aiBox, setAiBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  const [scanFailed, setScanFailed] = useState(false);
  const scanStartTimeRef = useRef<number | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  const [isManualMode, setIsManualMode] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragTarget>(null);
  const [crosshair, setCrosshair] = useState({ x: 50, y: 50 });
  const [topLine, setTopLine] = useState(30);
  const [bottomLine, setBottomLine] = useState(70);

  const [finalPlateHeight, setFinalPlateHeight] = useState<number | null>(null);
  const [velocityThreshold, setVelocityThreshold] = useState<number | null>(20);

  useEffect(() => {
    startCamera();
    loadModel().then(() => setModelLoading(false));
    
    return () => {
      stopCamera();
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
      
      if (videoRef.current && videoRef.current.srcObject) {
        const currentStream = videoRef.current.srcObject as MediaStream;
        const tracks = currentStream.getTracks();
        tracks.forEach(track => {
          track.stop();
        });
        videoRef.current.srcObject = null;
      }
      
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); 

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  const startScanning = () => {
    setScanFailed(false);
    setAiBox(null);
    scanStartTimeRef.current = Date.now();

    const scan = async () => {
      if (isTracking || isManualMode) return; 
      
      if (!videoRef.current || videoRef.current.readyState < 2) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }

      if (scanStartTimeRef.current && Date.now() - scanStartTimeRef.current > 5000) {
        setScanFailed(true);
        track('Live_Scan_Timeout_Failed');
        return; 
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

  useEffect(() => {
    if (modelLoading || isManualMode || isTracking || aiBox) return;
    startScanning();
    return () => {
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    };
  }, [modelLoading, isManualMode, isTracking, aiBox]);

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
      
      startTracking(cx, cy, manualPlateHeightPx, velocityThreshold);
    } else if (aiBox) {
      startTracking(aiBox.x, aiBox.y, aiBox.height, velocityThreshold);
    }
  };

  const handleStop = async () => {
    const { frames, blob } = await stopTracking();
    if (!videoRef.current || frames.length === 0 || !finalPlateHeight || !blob || blob.size === 0) {
      track('Live_Set_Cancelled');
      return onCancel();
    }
    track('Live_Set_Completed', { 
      threshold_used: velocityThreshold !== null ? 'yes' : 'no',
      hit_threshold: thresholdMet ? 'yes' : 'no'
    });
    
    const duration = frames[frames.length - 1].timeSeconds;
    const estimatedFps = frames.length / duration;
    onSetComplete(frames, estimatedFps, videoRef.current.videoWidth, videoRef.current.videoHeight, finalPlateHeight, blob);
  };

  const getThresholdLabel = () => {
    if (velocityThreshold === null) return "Disabled";
    if (velocityThreshold <= 10) return "Peak Power / Speed";
    if (velocityThreshold <= 20) return "Strength";
    return "Hypertrophy / Failure";
  };

  // ✨ NEW: Early Return UI if Camera is blocked
  if (permissionDenied) {
    return (
      <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto p-6 space-y-6 text-center bg-zinc-900/50 rounded-2xl border border-zinc-800 animate-in fade-in zoom-in duration-300">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-2">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        
        <h2 className="text-xl font-bold text-white">Camera Access Blocked</h2>
        
        <p className="text-sm text-zinc-400">
          Velocity Data needs camera access to track the barbell. Video processing runs completely on your device.
        </p>

        <div className="text-left bg-black/40 p-4 rounded-lg border border-white/5 text-sm text-zinc-300 w-full space-y-2">
          <p className="font-semibold text-white">How to fix it:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Tap the <strong>AA</strong> or <strong>Lock icon</strong> in your browser's address bar.</li>
            <li>Tap <strong>Website Settings</strong> or <strong>Permissions</strong>.</li>
            <li>Allow <strong>Camera</strong> access.</li>
            <li>Refresh this page.</li>
          </ol>
        </div>

        <button 
          onClick={() => window.location.reload()} 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg"
        >
          Refresh Page
        </button>
        
        <button 
          onClick={onCancel} 
          className="text-zinc-500 text-sm hover:text-white transition-colors"
        >
          Cancel and go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto space-y-4">
      <div className="text-center space-y-1 h-12 flex flex-col justify-center">
        {modelLoading ? (
          <p className="text-sm text-orange-400 animate-pulse">Loading AI Vision...</p>
        ) : isTracking ? (
          <h2 className={`text-2xl font-bold ${thresholdMet ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
            {thresholdMet ? "🛑 STOP SET 🛑" : "Recording Set 🟢"}
          </h2>
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

      <div className="w-full flex justify-center">
        <div 
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="relative bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-xl touch-none select-none max-w-full"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="block max-w-full max-h-[70vh] w-auto h-auto min-h-[300px] pointer-events-none"
          />

          {isTracking && thresholdMet && (
            <>
              <div className="absolute inset-0 border-8 border-red-600/80 rounded-lg pointer-events-none z-30 animate-pulse" />
              <div className="absolute top-1/3 left-0 right-0 flex justify-center z-50 pointer-events-none animate-in zoom-in duration-300">
                <div className="bg-red-600 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border-2 border-white/20">
                  <span className="text-4xl">🛑</span>
                  <span className="text-white font-black text-3xl uppercase tracking-wider">Stop Set</span>
                </div>
              </div>
            </>
          )}

          {isTracking && liveVelocity !== null && (
            <div key={liveVelocity} className="absolute top-4 left-4 z-40 animate-in slide-in-from-top-2 fade-in duration-300">
              <div className={`backdrop-blur-md px-4 py-2 rounded-2xl border shadow-xl flex flex-col items-center ${thresholdMet ? 'bg-red-900/80 border-red-500/50' : 'bg-black/60 border-white/20'}`}>
                <span className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${thresholdMet ? 'text-red-200' : 'text-white/60'}`}>Rep Speed</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white tabular-nums drop-shadow-md">{liveVelocity.toFixed(2)}</span>
                  <span className={`text-sm font-bold ${thresholdMet ? 'text-red-300' : 'text-white/50'}`}>m/s</span>
                </div>
              </div>
            </div>
          )}

          <div className="absolute top-4 right-4 z-30 flex flex-col gap-3">
            {!isTracking && (
              <button onClick={(e) => { e.stopPropagation(); toggleCamera(); }} className="w-10 h-10 bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-white shadow-lg transition-all">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setAudioEnabled(!audioEnabled); }} className={`w-10 h-10 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center shadow-lg transition-all ${audioEnabled ? "bg-orange-500/80 text-white" : "bg-black/50 text-white/40"}`}>
              {audioEnabled ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
              )}
            </button>
          </div>

          {!isTracking && !isManualMode && aiBox && videoRef.current && (
            <div className="absolute border-2 border-emerald-500 bg-emerald-500/10 transition-all duration-75 pointer-events-none" style={{ left: `${((aiBox.x - aiBox.width / 2) / videoRef.current.videoWidth) * 100}%`, top: `${((aiBox.y - aiBox.height / 2) / videoRef.current.videoHeight) * 100}%`, width: `${(aiBox.width / videoRef.current.videoWidth) * 100}%`, height: `${(aiBox.height / videoRef.current.videoHeight) * 100}%` }} />
          )}
          {!isTracking && isManualMode && (
            <>
              <div className="absolute left-0 right-0 h-12 -mt-6 cursor-row-resize flex items-center justify-center z-10 touch-none" style={{ top: `${topLine}%` }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("topLine"); }}><div className="w-full border-t-[3px] border-dashed border-blue-500 shadow-sm opacity-80" /><span className="absolute bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full right-4">Top of Plate</span></div>
              <div className="absolute left-0 right-0 h-12 -mt-6 cursor-row-resize flex items-center justify-center z-10 touch-none" style={{ top: `${bottomLine}%` }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("bottomLine"); }}><div className="w-full border-t-[3px] border-dashed border-blue-500 shadow-sm opacity-80" /><span className="absolute bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full right-4">Bottom of Plate</span></div>
              <div className="absolute w-16 h-16 -ml-8 -mt-8 cursor-move flex items-center justify-center z-20 touch-none" style={{ left: `${crosshair.x}%`, top: `${crosshair.y}%` }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("crosshair"); }}><div className="w-10 h-10 rounded-full border-[3px] border-orange-500 bg-orange-500/30 flex items-center justify-center shadow-lg"><div className="w-1.5 h-1.5 bg-white rounded-full shadow-md" /></div></div>
            </>
          )}
          {isTracking && currentPoint && videoRef.current && (
            <div className="absolute w-8 h-8 border-2 border-red-500 rounded-full flex items-center justify-center pointer-events-none transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(239,68,68,0.5)]" style={{ left: `${(currentPoint.x / videoRef.current.videoWidth) * 100}%`, top: `${(currentPoint.y / videoRef.current.videoHeight) * 100}%` }}><div className="w-2 h-2 bg-red-500 rounded-full" /></div>
          )}
        </div>
      </div>

      <div className="w-full flex flex-col gap-3">
        {!isTracking && (
          <div className="w-full bg-zinc-900/60 p-3 rounded-xl border border-zinc-800 shadow-inner">
            <div className="flex justify-between items-center mb-2 px-1">
              <span className="text-xs font-bold text-white/70 uppercase tracking-wider">Velocity Loss Threshold</span>
              <span className="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded">{getThresholdLabel()}</span>
            </div>
            <div className="flex gap-1.5">
              {[null, 10, 15, 20, 30].map(val => (
                <button key={val === null ? 'off' : val} onClick={() => setVelocityThreshold(val)} className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all ${velocityThreshold === val ? "bg-blue-600 text-white shadow-md shadow-blue-900/50" : "bg-black/40 text-white/40 hover:bg-white/10 hover:text-white/80"}`}>
                  {val === null ? "Off" : `${val}%`}
                </button>
              ))}
            </div>
          </div>
        )}

        {isTracking ? (
          <button onClick={handleStop} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl text-xl transition-all shadow-lg border border-red-500/50">END SET</button>
        ) : scanFailed && !isManualMode ? (
          <div className="flex gap-3 w-full">
            <button onClick={startScanning} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-4 rounded-xl font-semibold transition-all">Try Again 🔄</button>
            <button onClick={() => setIsManualMode(true)} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-4 rounded-xl font-bold transition-all">Select Manually 🎯</button>
          </div>
        ) : (
          <button onClick={beginTracking} disabled={!aiBox && !isManualMode} className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all ${(aiBox || isManualMode) ? "bg-emerald-500 text-white hover:bg-emerald-600 hover:shadow-emerald-500/20 border border-emerald-400/50" : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"}`}>
            {isManualMode ? "Start Tracking 🚀" : aiBox ? "Start Tracking 🚀" : "Waiting..."}
          </button>
        )}

        {!isTracking && aiBox && !isManualMode && (
          <button onClick={() => { setAiBox(null); setIsManualMode(true); }} className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors">Not quite right? <span className="underline">Adjust Manually</span></button>
        )}
        {!isTracking && (
          <button onClick={() => { stopCamera(); onCancel(); }} className="w-full bg-transparent hover:bg-white/5 text-white/50 py-3 rounded-lg mt-2">Cancel</button>
        )}
      </div>
    </div>
  );
}