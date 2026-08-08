"use client";

import { useEffect, useRef, useState } from "react";
import type { Point, CalibrationPoints, LiftType } from "@/types";
import { loadModel, detectBarbell } from "@/lib/yolo";

interface SeedStepProps {
  file: File;
  onSeedSet: (point: Point, cal: CalibrationPoints, lift: LiftType) => void;
}

export default function SeedStep({ file, onSeedSet }: SeedStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [liftType, setLiftType] = useState<LiftType>("squat");
  const [modelLoading, setModelLoading] = useState(true);
  const [aiBox, setAiBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [autoStartCountdown, setAutoStartCountdown] = useState<number | null>(null);

  // 1. Load the video file
  useEffect(() => {
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

  // 3. ✨ NEW: Scan the frame only when BOTH the model and video are ready!
  useEffect(() => {
    if (modelLoading || !videoRef.current) return;

    const scanFirstFrame = async () => {
      try {
        console.log("📸 Scanning first frame...");
        const box = await detectBarbell(videoRef.current!);
        
        if (box) {
          console.log("🎯 Barbell Found!", box);
          setAiBox(box);
          setAutoStartCountdown(2);
        } else {
          console.log("🤷‍♂️ AI scanned but couldn't confidently find a plate.");
        }
      } catch (err) {
        console.error("❌ Inference error:", err);
      }
    };

    // If video is already loaded, scan immediately. Otherwise, wait for it.
    if (videoRef.current.readyState >= 2) {
      scanFirstFrame();
    } else {
      videoRef.current.addEventListener('loadeddata', scanFirstFrame);
      return () => videoRef.current?.removeEventListener('loadeddata', scanFirstFrame);
    }
  }, [modelLoading]); // This runs the moment modelLoading becomes false

  // 4. Handle the Countdown Timer
  useEffect(() => {
    if (autoStartCountdown === null) return;
    
    if (autoStartCountdown > 0) {
      const timer = setTimeout(() => setAutoStartCountdown(autoStartCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } 
    
    if (autoStartCountdown === 0 && aiBox) {
      startAnalysis();
    }
  }, [autoStartCountdown, aiBox]);

  const startAnalysis = () => {
    if (!aiBox) return;

    const finalPxPerCm = aiBox.height / 45;

    const autoCalibration: CalibrationPoints = {
      top: { x: 0, y: 0 },
      bottom: { x: 0, y: aiBox.height },
      diameterCm: 45,
      pxPerCm: finalPxPerCm,
      pxPerM: finalPxPerCm * 100,
    };

    const seedPoint: Point = { x: aiBox.x, y: aiBox.y };
    onSeedSet(seedPoint, autoCalibration, liftType);
  };

  const handleManualClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!videoRef.current || aiBox) return; 
    
    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoRef.current.videoWidth / rect.width;
    const scaleY = videoRef.current.videoHeight / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const guessedPlateHeight = videoRef.current.videoHeight / 5;
    const finalPxPerCm = guessedPlateHeight / 45;

    const fallbackCalibration: CalibrationPoints = {
      top: { x: 0, y: 0 },
      bottom: { x: 0, y: guessedPlateHeight },
      diameterCm: 45,
      pxPerCm: finalPxPerCm,
      pxPerM: finalPxPerCm * 100,
    };

    onSeedSet({ x, y }, fallbackCalibration, liftType);
  };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto w-full gap-6 animate-in fade-in slide-in-from-bottom-4">
      
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

      <div className="text-center space-y-1 h-12 flex flex-col justify-center">
        {modelLoading ? (
          <p className="text-sm text-orange-400 animate-pulse">Loading AI Vision...</p>
        ) : aiBox ? (
          <p className="text-sm text-emerald-400 font-bold">
            Plate found! Starting in {autoStartCountdown}...
          </p>
        ) : (
          <p className="text-sm text-white/50">
            If AI can't find the plate, tap the barbell to start.
          </p>
        )}
      </div>

      <div className="relative w-full aspect-[9/16] max-h-[60vh] bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-xl flex items-center justify-center">
        <video
          ref={videoRef}
          onClick={handleManualClick}
          className="max-w-full max-h-full object-contain"
          playsInline
          muted
        />

        {aiBox && videoRef.current && (
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
      </div>

    </div>
  );
}