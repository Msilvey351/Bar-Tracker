"use client";

import { useMemo, useState } from "react";
import type { AnalysisResult, CalibrationPoints, LiftType } from "@/types";
import { analyseReps } from "@/lib/repDetection";
import VideoPlayback from "./VideoPlayback";
import VelocityChart from "./VelocityChart";
import RepTable      from "./RepTable";
import AuthModal     from "./AuthModal";
import SaveSetModal  from "./SaveSetModal";
import { useAuth }   from "@/context/AuthContext";

interface Props {
  result:      AnalysisResult;
  file:        File;
  calibration: CalibrationPoints | null;
  liftType:    LiftType;
  onReset:     () => void;
}

type ResultView = "table" | "chart" | "playback";

export default function ResultsStep({
  result,
  file,
  calibration,
  liftType,
  onReset,
}: Props) {
  const [view,      setView]      = useState<ResultView>("table");
  const [showAuth,  setShowAuth]  = useState(false);
  const [showSave,  setShowSave]  = useState(false);
  const [savedDone, setSavedDone] = useState(false);

  const { user } = useAuth();

  const { vFrames, repStats } = useMemo(
    () => analyseReps(result.frames, result.fps, { calibration, liftType }),
    [result, calibration, liftType]
  );

  const views: { id: ResultView; label: string; icon: string }[] = [
    { id: "table",    label: "Rep Stats",      icon: "📊" },
    { id: "chart",    label: "Velocity Chart", icon: "📈" },
    { id: "playback", label: "Video Playback", icon: "🎬" },
  ];

  return (
    <div className="flex flex-col items-center gap-6">

      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">Analysis Complete 🎉</h2>
        <p className="text-white/40 mt-1 text-sm">
          {result.frames.length} frames tracked ·{" "}
          {result.durationSeconds.toFixed(1)}s ·{" "}
          <span className="text-orange-400 font-semibold">
            {repStats.length} rep{repStats.length !== 1 ? "s" : ""} detected
          </span>
          {calibration && (
            <span className="text-emerald-400 ml-2">
              · calibrated ({calibration.diameterCm}cm plate)
            </span>
          )}
        </p>
      </div>

      {/* View switcher */}
      <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`
              px-4 py-2 rounded-lg font-semibold text-sm transition-all
              flex items-center gap-2
              ${view === v.id
                ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                : "text-white/50 hover:text-white"
              }
            `}
          >
            <span>{v.icon}</span>
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="w-full max-w-4xl">
        {view === "table" && (
          <RepTable stats={repStats} calibration={calibration} />
        )}
        {view === "chart" && (
          <VelocityChart
            vFrames={vFrames}
            repStats={repStats}
            calibration={calibration}
          />
        )}
        {view === "playback" && (
          <VideoPlayback file={file} result={result} vFrames={vFrames} />
        )}
      </div>

      {/* Save Set */}
      <div className="flex flex-col items-center gap-2 w-full max-w-md">
        {savedDone ? (
          <div className="w-full py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-semibold rounded-xl text-center text-sm">
            ✅ Set saved to your history!
          </div>
        ) : user ? (
          <button
            onClick={() => setShowSave(true)}
            disabled={repStats.length === 0}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/30 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors"
          >
            💾 Save Set to History
          </button>
        ) : (
          <button
            onClick={() => setShowAuth(true)}
            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-xl transition-colors text-sm"
          >
            Sign in to save this set →
          </button>
        )}
      </div>

      {/* Reset */}
      <button
        onClick={onReset}
        className="px-6 py-2 rounded-xl border border-white/20 text-white/50 hover:border-white/40 hover:text-white transition-all text-sm"
      >
        ↩ Analyse Another Video
      </button>

      {/* Modals */}
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} />
      )}
      {showSave && repStats.length > 0 && (
        <SaveSetModal
          repStats={repStats}
          liftType={liftType}
          onClose={() => setShowSave(false)}
          onSaved={() => {
            setShowSave(false);
            setSavedDone(true);
          }}
        />
      )}

    </div>
  );
}