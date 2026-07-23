"use client";

import { useMemo, useState } from "react";
import type { AnalysisResult } from "@/types";
import { analyseReps } from "@/lib/repDetection";
import VideoPlayback from "./VideoPlayback";
import VelocityChart from "./VelocityChart";
import RepTable from "./RepTable";

interface Props {
  result: AnalysisResult;
  file: File;
  onReset: () => void;
}

type ResultView = "table" | "chart" | "playback";

export default function ResultsStep({ result, file, onReset }: Props) {
  const [view, setView] = useState<ResultView>("table");

  // Run rep detection once — memoised so it doesn't re-run on every render
  const { vFrames, repStats } = useMemo(
    () => analyseReps(result.frames, result.fps),
    [result]
  );

  const views: { id: ResultView; label: string; icon: string }[] = [
    { id: "table",    label: "Rep Stats",     icon: "📊" },
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
          <span className="text-orange-400 font-semibold">{repStats.length} rep{repStats.length !== 1 ? "s" : ""} detected</span>
        </p>
      </div>

      {/* View switcher */}
      <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2
              ${view === v.id
                ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                : "text-white/50 hover:text-white"
              }`}
          >
            <span>{v.icon}</span>
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="w-full max-w-4xl">
        {view === "table" && <RepTable stats={repStats} />}
        {view === "chart" && <VelocityChart vFrames={vFrames} repStats={repStats} />}
        {view === "playback" && <VideoPlayback file={file} result={result} />}
      </div>

      <button
        onClick={onReset}
        className="mt-2 px-6 py-2 rounded-xl border border-white/20 text-white/50 hover:border-white/40 hover:text-white transition-all text-sm"
      >
        ↩ Analyse Another Video
      </button>
    </div>
  );
}