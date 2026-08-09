"use client";

import { useState } from "react";
import { useVelocityProfile } from "@/hooks/useVelocityProfile";
import type { LiftType } from "@/types";

export default function VelocityProfile({ onClose }: { onClose: () => void }) {
  const [exercise, setExercise] = useState<string>("bench_press");
  const { profile, loading } = useVelocityProfile(exercise);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-2xl p-6 shadow-2xl">
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-orange-400">Velocity Profile</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            ✕
          </button>
        </div>

        <select
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 mb-6 text-white focus:border-orange-500 outline-none appearance-none"
        >
          <option value="bench_press">Bench Press</option>
          <option value="squat">Squat</option>
          <option value="deadlift">Deadlift</option>
        </select>

        <div className="bg-black/50 rounded-xl border border-white/5 overflow-hidden">
          <div className="grid grid-cols-3 p-3 border-b border-white/5 bg-white/5 text-xs font-bold text-white/50 uppercase tracking-wider">
            <div>RIR (RPE)</div>
            <div className="text-center">Avg Speed</div>
            <div className="text-right">Sample Size</div>
          </div>
          
          {loading ? (
            <div className="p-8 text-center text-white/40 animate-pulse">Calculating profile...</div>
          ) : profile.length === 0 ? (
            <div className="p-8 text-center text-white/40">No calibrated sets saved for this lift yet.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {profile.map((p) => (
                <div key={p.rir} className="grid grid-cols-3 p-3 border-b border-white/5 text-sm hover:bg-white/5 transition-colors">
                  <div className="font-semibold text-white">
                    {p.rir} <span className="text-white/30 font-normal ml-1">({10 - p.rir})</span>
                  </div>
                  <div className="text-center font-mono text-emerald-400">
                    {p.avgVelocity.toFixed(2)} m/s
                  </div>
                  <div className="text-right text-white/40">
                    {p.sampleSize} rep{p.sampleSize !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-white/40 text-center mt-6">
          This curve learns your personal minimum velocity thresholds over time to calculate your daily readiness.
        </p>
      </div>
    </div>
  );
}