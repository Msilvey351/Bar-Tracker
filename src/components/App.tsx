"use client";

import { useState } from "react";
import type { AppStage, AnalysisResult, Point, CalibrationPoints } from "@/types";
import UploadStep    from "./UploadStep";
import SeedStep      from "./SeedStep";
import AnalysisStep  from "./AnalysisStep";
import ResultsStep   from "./ResultsStep";
import { useVideoAnalyser } from "@/hooks/useVideoAnalyser";

export default function App() {
  const [stage,       setStage]       = useState<AppStage>("upload");
  const [videoFile,   setVideoFile]   = useState<File | null>(null);
  const [calibration, setCalibration] = useState<CalibrationPoints | null>(null);

  const { analyse, progress, isAnalysing, result, error } = useVideoAnalyser();

  const handleFileAccepted = (file: File) => {
    setVideoFile(file);
    setStage("seed");
  };

  const handleSeedSet = async (point: Point, cal: CalibrationPoints) => {
    if (!videoFile) return;
    setCalibration(cal);
    setStage("analysing");
    await analyse(videoFile, point);
    setStage("results");
  };

  const handleReset = () => {
    setStage("upload");
    setVideoFile(null);
    setCalibration(null);
  };

  return (
    <main className="min-h-screen flex flex-col items-center bg-[#0f0f0f] text-white">
      {/* Header */}
      <header className="w-full py-4 px-6 border-b border-white/10 flex items-center gap-3">
        <span className="text-2xl">🏋️</span>
        <h1 className="text-xl font-bold tracking-tight text-orange-400">
          Barbell Tracker
        </h1>
        {calibration && (
          <span className="ml-2 text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            {calibration.pxPerCm.toFixed(1)} px/cm · {calibration.diameterCm}cm plate
          </span>
        )}
        <span className="ml-auto text-xs text-white/40 font-mono">
          {stage.toUpperCase()}
        </span>
      </header>

      {/* Step indicator */}
      <div className="flex gap-2 mt-6 mb-8">
        {(["upload", "seed", "analysing", "results"] as AppStage[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`
              w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
              ${stage === s
                ? "border-orange-500 bg-orange-500 text-white"
                : ["upload","seed","analysing","results"].indexOf(stage) > i
                ? "border-orange-500 bg-orange-500/20 text-orange-400"
                : "border-white/20 text-white/30"}
            `}>
              {i + 1}
            </div>
            {i < 3 && <div className="w-8 h-px bg-white/20" />}
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="w-full max-w-4xl px-4 pb-16">
        {stage === "upload"    && <UploadStep onFileAccepted={handleFileAccepted} />}
        {stage === "seed"      && videoFile && (
          <SeedStep file={videoFile} onSeedSet={handleSeedSet} />
        )}
        {stage === "analysing" && <AnalysisStep progress={progress} error={error} />}
        {stage === "results"   && result && videoFile && (
          <ResultsStep
            result={result}
            file={videoFile}
            calibration={calibration}
            onReset={handleReset}
          />
        )}
      </div>
    </main>
  );
}