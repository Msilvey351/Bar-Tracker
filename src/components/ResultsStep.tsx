"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/types";
import VideoPlayback from "./VideoPlayback";
import VelocityChart from "./VelocityChart";

interface Props {
  result: AnalysisResult;
  file: File;
  onReset: () => void;
}

type ResultView = "playback" | "velocity";

export default function ResultsStep({ result, file, onReset }: Props) {
  const [view, setView] = useState<ResultView>("playback");

  return (
    <div className="flex flex-col items-center gap-6">
      <div>
        <h2 className="text-2xl font-bold text-center">Analysis Complete 🎉</h2>
        <p className="text-white/40 text-center mt-1 text-sm">
          {result.frames.length} frames tracked · {result.durationSeconds.toFixed(1)}s duration
        </p>
      </div>

      {/* View switcher */}
      <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
        <button
          onClick={() => setView("playback")}
          className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all
            ${view === "playback"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-white/50 hover:text-white"
            }`}
        >
          🎬 Video Playback
        </button>
        <button
          onClick={() => setView("velocity")}
          className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all
            ${view === "velocity"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-white/50 hover:text-white"
            }`}
        >
          📈 Velocity Chart
        </button>
      </div>

      {/* View content */}
      <div className="w-full max-w-3xl">
        {view === "playback" && <VideoPlayback file={file} result={result} />}
        {view === "velocity" && <VelocityChart result={result} />}
      </div>

      <button
        onClick={onReset}
        className="mt-4 px-6 py-2 rounded-xl border border-white/20 text-white/50 hover:border-white/40 hover:text-white transition-all text-sm"
      >
        ↩ Analyse Another Video
      </button>
    </div>
  );
}