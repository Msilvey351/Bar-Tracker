"use client";

import { useState } from "react";
import type { AppStage, Point, CalibrationPoints, LiftType, AnalysisResult } from "@/types";
import UploadStep      from "./UploadStep";
import SeedStep        from "./SeedStep";
import AnalysisStep    from "./AnalysisStep";
import ResultsStep     from "./ResultsStep";
import HowItWorksModal from "./HowItWorksModal";
import AuthModal       from "./AuthModal";
import HistoryPage     from "./HistoryPage";
import { useVideoAnalyser } from "@/hooks/useVideoAnalyser";
import { useAuth }          from "@/context/AuthContext";
import { LiveTracker }      from "@/components/LiveTracker";

export default function App() {
  const [stage,       setStage]       = useState<AppStage | "live">("upload");
  const [videoFile,   setVideoFile]   = useState<File | null>(null);
  const [calibration, setCalibration] = useState<CalibrationPoints | null>(null);
  const [liftType,    setLiftType]    = useState<LiftType>("squat");
  const [showHelp,    setShowHelp]    = useState(false);
  const [showAuth,    setShowAuth]    = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [liveResult, setLiveResult] = useState<AnalysisResult | null>(null);

  const { user, signOut } = useAuth();

  const {
    analyse,
    progress,
    isAnalysing,
    result: fileResult,
    error,
    liveFrames,
    liveFps,
  } = useVideoAnalyser();

  const handleFileAccepted = (file: File) => {
    setVideoFile(file);
    setStage("seed");
  };

  const handleSeedSet = async (
    point: Point,
    cal: CalibrationPoints,
    lift: LiftType
  ) => {
    if (!videoFile) return;
    setCalibration(cal);
    setLiftType(lift);
    setStage("analysing");
    await analyse(videoFile, point);
    setStage("results");
  };

  const handleReset = () => {
    setStage("upload");
    setVideoFile(null);
    setCalibration(null);
    setLiftType("squat");
    setLiveResult(null); 
  };

  const activeStepIndex = 
    stage === "upload" ? 0 : 
    (stage === "seed" || stage === "live") ? 1 : 
    stage === "analysing" ? 2 : 
    3;

  const activeResult = stage === "results" ? (fileResult || liveResult) : null;

  return (
    <main className="min-h-screen flex flex-col items-center bg-[#0f0f0f] text-white">

      {showHelp    && <HowItWorksModal onClose={() => setShowHelp(false)} />}
      {showAuth    && <AuthModal       onClose={() => setShowAuth(false)} />}
      {showHistory && <HistoryPage     onClose={() => setShowHistory(false)} />}

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

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-xs hidden sm:block truncate max-w-[8rem]">
                {user.email}
              </span>
              <button
                onClick={() => setShowHistory(true)}
                className="text-xs text-white/70 hover:text-white transition-colors border border-white/10 hover:border-white/20 rounded-lg px-2 py-1"
              >
                📋 History
              </button>
              <button
                onClick={signOut}
                className="text-xs text-white/40 hover:text-white/70 transition-colors border border-white/10 hover:border-white/20 rounded-lg px-2 py-1"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors border border-orange-500/30 hover:border-orange-500/60 rounded-lg px-3 py-1.5 font-semibold"
            >
              Sign in
            </button>
          )}

          <button
            onClick={() => setShowHelp(true)}
            className="w-7 h-7 rounded-full border border-white/20 hover:border-orange-500/60 hover:bg-orange-500/10 flex items-center justify-center text-white/40 hover:text-orange-400 transition-all text-sm font-bold"
            title="How it works"
          >
            ?
          </button>

          <span className="text-xs text-white/40 font-mono">
            {stage.toUpperCase()}
          </span>
        </div>
      </header>

      <div className="flex gap-2 mt-6 mb-8">
        {(["upload", "setup", "analysing", "results"]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`
                w-7 h-7 rounded-full flex items-center justify-center
                text-xs font-bold border-2 transition-all
                ${activeStepIndex === i
                  ? "border-orange-500 bg-orange-500 text-white"
                  : activeStepIndex > i
                  ? "border-orange-500 bg-orange-500/20 text-orange-400"
                  : "border-white/20 text-white/30"
                }
              `}
            >
              {i + 1}
            </div>
            {i < 3 && <div className="w-8 h-px bg-white/20" />}
          </div>
        ))}
      </div>

      <div className="w-full max-w-4xl px-4 pb-16">

        <div style={{ display: stage === "upload" ? "block" : "none" }}>
          <UploadStep 
            onFileAccepted={handleFileAccepted} 
            onStartLive={() => setStage("live")}
          />
        </div>

        {stage === "seed" && videoFile && (
          <SeedStep
            file={videoFile}
            onSeedSet={handleSeedSet}
          />
        )}

        {stage === "live" && (
          <div className="w-full flex flex-col items-center animate-in fade-in zoom-in-95">
            <div className="mb-6 w-full max-w-md bg-zinc-900 p-4 rounded-xl border border-zinc-800">
              <label className="block text-sm font-semibold text-white/80 mb-2">
                What are you lifting?
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

            <LiveTracker
              onCancel={() => setStage("upload")}
              onSetComplete={(frames, fps, width, height) => {
                const estimatedPxPerCm = (height / 5) / 45;
                const finalPxPerCm = estimatedPxPerCm > 0 ? estimatedPxPerCm : 5;

                setCalibration({
                  top: { x: 0, y: 0 },
                  bottom: { x: 0, y: finalPxPerCm * 45 },
                  diameterCm: 45,
                  pxPerCm: finalPxPerCm,
                  pxPerM: finalPxPerCm * 100,
                });

                setLiveResult({
                  frames,
                  fps,
                  videoWidth: width,
                  videoHeight: height,
                  durationSeconds: frames.length > 0 ? frames[frames.length - 1].timeSeconds : 0
                });

                setStage("results");
              }}
            />
          </div>
        )}

        {stage === "analysing" && (
          <AnalysisStep
            progress={progress}
            error={error}
            liveFrames={liveFrames}
            liveFps={liveFps}
          />
        )}

        {stage === "results" && activeResult && calibration && (
          <ResultsStep
            result={activeResult}
            file={videoFile || new File([], "live-set.mp4", { type: "video/mp4" })}
            calibration={calibration}
            liftType={liftType}
            onReset={handleReset}
          />
        )}

      </div>
    </main>
  );
}