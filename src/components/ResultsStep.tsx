"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { AnalysisResult, CalibrationPoints, LiftType } from "@/types";
import { analyseReps } from "@/lib/repDetection";
import VideoPlayback from "./VideoPlayback";
import VelocityChart from "./VelocityChart";
import RepTable from "./RepTable";
import AuthModal from "./AuthModal";
import SaveSetModal from "./SaveSetModal";
import { useAuth } from "@/context/AuthContext";
import { saveLiftTelemetry } from "@/lib/telemetry";
import RepEditorModal, { ManualRep } from "@/components/RepEditorModal";

interface Props {
  result: AnalysisResult;
  file: File;
  calibration: CalibrationPoints | null;
  liftType: LiftType;
  onReset: () => void;
}

type ResultView = "table" | "chart" | "playback";

export default function ResultsStep({
  result,
  file,
  calibration,
  liftType,
  onReset,
}: Props) {
  const [view, setView] = useState<ResultView>("table");
  const [showAuth, setShowAuth] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [savedDone, setSavedDone] = useState(false);
  
  // ── Manual Rep Editor State ────────────────────────────────────────────────
  const [showEditor, setShowEditor] = useState(false);
  // Fixed TS Error: Initialize as undefined instead of null
  const [manualReps, setManualReps] = useState<ManualRep[] | undefined>(undefined); 

  const { user } = useAuth();
  const telemetrySent = useRef(false);

  // ── Core Math (Reruns automatically if manualReps changes) ────────────────
  const { vFrames, repStats } = useMemo(
    () => {
      return analyseReps(result.frames, result.fps, { calibration, liftType, manualReps });
    },
    [result, calibration, liftType, manualReps]
  );

  useEffect(() => {
    // Only send telemetry on the INITIAL heuristic guess, not on every edit
    if (!telemetrySent.current && vFrames.length > 0) {
      saveLiftTelemetry(liftType, vFrames, repStats.length);
      telemetrySent.current = true;
    }
  }, [vFrames, repStats.length, liftType]);

  const views: { id: ResultView; label: string; icon: string }[] = [
    { id: "table", label: "Rep Stats", icon: "📊" },
    { id: "chart", label: "Velocity Chart", icon: "📈" },
    { id: "playback", label: "Video Playback", icon: "🎬" },
  ];

  // ── CSV EXPORT ─────────────────────────────────────────────────────────────
  const downloadCSV = () => {
    if (repStats.length === 0) return;

    let csvContent = "Rep,Avg Concentric (m/s),Peak Concentric (m/s),Avg Eccentric (m/s),Concentric Time (s),Eccentric Time (s),Speed Drop (%)\n";

    repStats.forEach((rep) => {
      const drop = rep.percentSpeedDrop > 0 ? rep.percentSpeedDrop.toFixed(1) : "0.0";
      csvContent += `${rep.repNumber},${rep.avgConcentricVelocity.toFixed(2)},${rep.peakConcentricVelocity.toFixed(2)},${Math.abs(rep.avgEccentricVelocity).toFixed(2)},${rep.concentricDuration.toFixed(2)},${rep.eccentricDuration.toFixed(2)},${drop}%\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    link.setAttribute("download", `${liftType}_vbt_stats_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── EDITOR HANDLER ─────────────────────────────────────────────────────────
  const handleSaveEditor = (reps: ManualRep[]) => {
    setManualReps(reps);
    setShowEditor(false);
    setView("table"); // Ensure we are on the table to see the new stats immediately
  };

  return (
    <div className="flex flex-col items-center gap-6 pb-12 animate-in fade-in zoom-in-95 duration-300">
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
              ${
                view === v.id
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
          <div className="flex flex-col gap-4">
            <RepTable stats={repStats} calibration={calibration} />
            
            {/* ACTION BUTTONS (Edit + CSV) */}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowEditor(true)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold rounded-lg border border-zinc-700 transition-colors"
              >
                <span>✏️</span> Edit Reps
              </button>
              <button
                onClick={downloadCSV}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold rounded-lg border border-zinc-700 transition-colors"
              >
                <span>⬇️</span> Download CSV
              </button>
            </div>
          </div>
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
      <div className="flex flex-col items-center gap-2 w-full max-w-md mt-4">
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
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {showSave && repStats.length > 0 && (
        <SaveSetModal
          repStats={repStats}
          calibration={calibration}
          liftType={liftType}
          onClose={() => setShowSave(false)}
          onSaved={() => {
            setShowSave(false);
            setSavedDone(true);
          }}
        />
      )}

      {/* 💥 THE NEW REP EDITOR MODAL 💥 */}
      {showEditor && (
        <RepEditorModal
          file={file}
          vFrames={vFrames}
          repStats={repStats}
          onClose={() => setShowEditor(false)}
          onSave={handleSaveEditor}
        />
      )}
    </div>
  );
}