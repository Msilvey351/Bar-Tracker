"use client";

import { useEffect, useRef, useState } from "react";
import type { Point, CalibrationPoints, LiftType } from "@/types";
import { loadModel, detectBarbell } from "@/lib/yolo";

interface SeedStepProps {
  file: File;
  onSeedSet: (point: Point, cal: CalibrationPoints, lift: LiftType) => void;
}

type DragTarget = "crosshair" | "topLine" | "bottomLine" | null;

export default function SeedStep({ file, onSeedSet }: SeedStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [liftType, setLiftType] = useState<LiftType>("squat");
  const [modelLoading, setModelLoading] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  
  // AI States
  const [aiBox, setAiBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [aiFailed, setAiFailed] = useState(false);

  // Manual Mode States
  const [isManualMode, setIsManualMode] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragTarget>(null);
  
  // Use percentages (0-100) so it scales perfectly on any screen size
  const [crosshair, setCrosshair] = useState({ x: 50, y: 40 }); 
  const [topLine, setTopLine] = useState(25);
  const [bottomLine, setBottomLine] = useState(55);

  // 1. Load the video file
  useEffect(() => {
    setVideoReady(false);
    setAiBox(null);
    setAiFailed(false);
    setIsManualMode(false);

    if (!file || !videoRef.current) return;
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 2. Load the AI Model
  useEffect(() => {
    loadModel()
      .then(() => {
        console.log("✅ AI Model Loaded Successfully");
        setModelLoading(false);
      })
      .catch((err) => console.error("❌ Failed to load AI:", err));
  }, []);

  // 3. Scan the frame once ready
  useEffect(() => {
    if (modelLoading || !videoReady || !videoRef.current) return;

    const scanFirstFrame = async () => {
      try {
        console.log("📸 Scanning first frame...");
        const box = await detectBarbell(videoRef.current!);
        
        if (box) {
          console.log("🎯 Barbell Found!", box);
          setAiBox(box);
        } else {
          console.log("🤷‍♂️ AI couldn't find the plate. Switching to manual.");
          setAiFailed(true);
          setIsManualMode(true);
        }
      } catch (err) {
        console.error("❌ Inference error:", err);
        setAiFailed(true);
        setIsManualMode(true);
      }
    };

    videoRef.current.currentTime = 0.1;
    const timer = setTimeout(scanFirstFrame, 250);
    return () => clearTimeout(timer);
  }, [modelLoading, videoReady, file]);

  // 4. Drag Handlers for Manual Mode
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeDrag || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate percentage position bounded between 0 and 100
    const xPercent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    if (activeDrag === "crosshair") setCrosshair({ x: xPercent, y: yPercent });
    if (activeDrag === "topLine") setTopLine(yPercent);
    if (activeDrag === "bottomLine") setBottomLine(yPercent);
  };

  const handlePointerUp = () => {
    setActiveDrag(null);
  };

  // 5. Final Dispatch
  const startAnalysis = () => {
    if (!videoRef.current) return;

    if (isManualMode) {
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      
      // Convert percentages back to exact video pixels
      const cx = (crosshair.x / 100) * vw;
      const cy = (crosshair.y / 100) * vh;
      const ty = (topLine / 100) * vh;
      const by = (bottomLine / 100) * vh;
      
      const plateHeightPx = Math.abs(by - ty);
      const pxPerCm = plateHeightPx / 45.0;

      const manualCalibration: CalibrationPoints = {
        top: { x: 0, y: Math.min(ty, by) },
        bottom: { x: 0, y: Math.max(ty, by) },
        diameterCm: 45,
        pxPerCm: pxPerCm,
        pxPerM: pxPerCm * 100,
      };

      onSeedSet({ x: cx, y: cy }, manualCalibration, liftType);
    } else {
      // AI Mode payload
      if (!aiBox) return;
      const finalPxPerCm = aiBox.width / 45.0;
      const autoCalibration: CalibrationPoints = {
        top: { x: 0, y: 0 },
        bottom: { x: 0, y: aiBox.height }, 
        diameterCm: 45,
        pxPerCm: finalPxPerCm,
        pxPerM: finalPxPerCm * 100,
      };
      const offsetPixels = aiBox.height * 0.15;
      onSeedSet({ x: aiBox.x, y: aiBox.y - offsetPixels }, autoCalibration, liftType);
    }
  };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto w-full gap-6 animate-in fade-in slide-in-from-bottom-4 pb-8">
      
      {/* Lift Selector */}
      <div className="w-full bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg">
        <label className="block text-sm font-semibold text-white/80 mb-2">
          What lift is this?
        </label>
        <select
          value={liftType}
          onChange={(e) => setLiftType(e.target.value as LiftType)}
          className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none transition-colors"
        >
          <option value="squat">Squat</option>
          <option value="bench">Bench Press</option>
          <option value="deadlift">Deadlift</option>
        </select>
      </div>

      {/* Status Text */}
      <div className="text-center space-y-1 h-6 flex flex-col justify-center">
        {modelLoading ? (
          <p className="text-sm text-orange-400 animate-pulse">Loading AI Vision...</p>
        ) : isManualMode ? (
          <p className="text-sm text-blue-400 font-bold">
            Drag the crosshairs to the bar, and bracket the plate.
          </p>
        ) : aiBox ? (
          <p className="text-sm text-emerald-400 font-bold">
            Plate found! Ready when you are.
          </p>
        ) : null}
      </div>

      {/* Video Container (Also acts as the drag boundary) */}
      <div 
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="relative w-full aspect-[9/16] max-h-[60vh] bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-xl flex items-center justify-center touch-none select-none"
      >
        <video
          ref={videoRef}
          onCanPlay={() => setVideoReady(true)}
          className="max-w-full max-h-full object-contain pointer-events-none"
          playsInline
          muted
        /> 

        {/* AI BOUNDING BOX OVERLAY */}
        {!isManualMode && aiBox && videoRef.current && (
          <div
            className="absolute border-2 border-emerald-500 bg-emerald-500/10 transition-all pointer-events-none shadow-[0_0_15px_rgba(16,185,129,0.3)]"
            style={{
              left: `${((aiBox.x - aiBox.width / 2) / videoRef.current.videoWidth) * 100}%`,
              top: `${((aiBox.y - aiBox.height / 2) / videoRef.current.videoHeight) * 100}%`,
              width: `${(aiBox.width / videoRef.current.videoWidth) * 100}%`,
              height: `${(aiBox.height / videoRef.current.videoHeight) * 100}%`,
            }}
          >
            <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-emerald-500 rounded-full transform -translate-x-1/2 -translate-y-1/2" />
          </div>
        )}

        {/* MANUAL CALIBRATION OVERLAY */}
        {isManualMode && (
          <>
            {/* Top Line */}
            <div
              className="absolute left-0 right-0 h-12 -mt-6 cursor-row-resize flex items-center justify-center z-10 touch-none"
              style={{ top: `${topLine}%` }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActiveDrag("topLine"); }}
            >
              <div className="w-full border-t-[3px] border-dashed border-blue-500 shadow-sm opacity-80" />
              <span className="absolute bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full right-4">
                Top of Plate (45cm)
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
                Bottom of Plate (0cm)
              </span>
            </div>

            {/* Crosshair (highest z-index so it doesn't get blocked by lines) */}
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
      </div>

      {/* Actions */}
      <div className="w-full space-y-3">
        <button
          onClick={startAnalysis}
          disabled={!aiBox && !isManualMode}
          className={`
            w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all
            ${(aiBox || isManualMode) 
              ? "bg-orange-500 text-white hover:bg-orange-600 hover:shadow-orange-500/20 hover:-translate-y-0.5" 
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"}
          `}
        >
          {isManualMode ? "Confirm & Analyze 🚀" : aiBox ? "Start Analysis 🚀" : "Waiting for AI..."}
        </button>

        {/* Fallback button if AI got it wrong */}
        {!isManualMode && aiBox && (
          <button
            onClick={() => setIsManualMode(true)}
            className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
          >
            Not quite right? <span className="underline">Adjust Manually</span>
          </button>
        )}
      </div>

    </div>
  );
}