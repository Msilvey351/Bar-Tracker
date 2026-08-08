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
    loadModel().then(() => setModelLoading(false));
  }, []);

  // 3. Scan the first frame for the plate
  const handleVideoLoaded = async () => {
    if (!videoRef.current || modelLoading) return;
    
    // Ensure video is at the first frame
    videoRef.current.currentTime = 0;
    
    // Give the browser a split second to render the frame
    setTimeout(async () => {
      const box = await detectBarbell(videoRef.current!);
      
      if (box) {
        setAiBox(box);
        
        // Found it! Start a 2-second countdown before auto-analyzing
        setAutoStartCountdown(2);
      }
    }, 200);
  };

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

    // AI Box gives us the height of the 45cm plate in pixels
    const finalPxPerCm = aiBox.height / 45;

    const autoCalibration: CalibrationPoints = {
      top: { x: 0, y: 0 },
      bottom: { x: 0, y: aiBox.height },
      diameterCm: 45,
      pxPerCm: finalPxPerCm,
      pxPerM: finalPxPerCm * 100,
    };

    // We pass the exact center of the AI box as the starting seed point
    const seedPoint: Point = { x: aiBox.x, y: aiBox.y };

    onSeedSet(seedPoint, autoCalibration, liftType);
  };

  // Fallback: If AI fails, user can click it manually
  const handleManualClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!videoRef.current || aiBox) return; // Only allow manual if AI failed
    
    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoRef.current.videoWidth / rect.width;
    const scaleY = videoRef.current.videoHeight / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    // Fallback guess: The plate is roughly 1/5th of the video height
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
          onLoadedData={handleVideoLoaded}
          onClick={handleManualClick}
          className="max-w-full max-h-full object-contain"
          playsInline
          muted
        />

        {/* Draw the Green AI Box */}
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
            {/* Draw a target dot in the exact center */}
            <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-emerald-500 rounded-full transform -translate-x-1/2 -translate-y-1/2" />
          </div>
        )}
      </div>

    </div>
  );
}