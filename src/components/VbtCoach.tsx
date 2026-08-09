"use client";

import { useState } from "react";
import { useVelocityProfile } from "@/hooks/useVelocityProfile";
import { calculateDaily1RM, prescribeWeight } from "@/lib/vbtMath";

export default function VbtCoach({ onClose }: { onClose: () => void }) {
  const [exercise, setExercise] = useState<string>("bench_press");
  const { profile, loading } = useVelocityProfile(exercise);

  // Warmup Inputs
  const [warmupWeight, setWarmupWeight] = useState<string>("");
  const [warmupReps, setWarmupReps] = useState<string>("1");
  const [warmupVelocity, setWarmupVelocity] = useState<string>("");

  // Target Inputs
  const [targetReps, setTargetReps] = useState<string>("5");
  const [targetRpe, setTargetRpe] = useState<string>("8");

  const e1RM = (!loading && warmupWeight && warmupReps && warmupVelocity) 
    ? calculateDaily1RM(parseFloat(warmupWeight), parseInt(warmupReps), parseFloat(warmupVelocity), profile) 
    : null;

  const prescribed = e1RM && targetReps && targetRpe
    ? prescribeWeight(e1RM, parseInt(targetReps), parseFloat(targetRpe))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-2xl p-6 shadow-2xl">
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-orange-400">AI VBT Coach</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">✕</button>
        </div>

        <select
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 mb-6 text-white outline-none"
        >
          <option value="bench_press">Bench Press</option>
          <option value="squat">Squat</option>
          <option value="deadlift">Deadlift</option>
        </select>

        {loading ? (
          <p className="text-white/40 text-center py-4">Loading your profile...</p>
        ) : profile.length < 2 ? (
          <p className="text-orange-400/80 bg-orange-500/10 p-4 rounded-xl text-sm">
            Not enough data! Log at least 2 different RIR speeds for this lift to unlock the Coach.
          </p>
        ) : (
          <div className="space-y-6">
            
            {/* 1. WARMUP INPUT */}
            <div className="bg-white/5 p-4 rounded-xl border border-white/10">
              <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-4">1. Today's Warmup</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Weight (kg)</label>
                  <input type="number" value={warmupWeight} onChange={e => setWarmupWeight(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-2 text-white text-center" placeholder="100"/>
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Reps</label>
                  <input type="number" value={warmupReps} onChange={e => setWarmupReps(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-2 text-white text-center" placeholder="1"/>
                </div>
                <div>
                  <label className="text-xs text-emerald-400 mb-1 block">Speed (m/s)</label>
                  <input type="number" step="0.01" value={warmupVelocity} onChange={e => setWarmupVelocity(e.target.value)} className="w-full bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-emerald-400 text-center" placeholder="0.40"/>
                </div>
              </div>

              {/* READINESS DISPLAY */}
              {e1RM && (
                <div className="mt-4 pt-4 border-t border-white/10 text-center">
                  <p className="text-xs text-white/50 mb-1">Today's Estimated 1RM</p>
                  <p className="text-3xl font-bold text-white">{e1RM.toFixed(1)} <span className="text-lg text-white/40 font-normal">kg</span></p>
                </div>
              )}
            </div>

            {/* 2. TARGET PRESCRIPTION */}
            <div className={`bg-white/5 p-4 rounded-xl border border-white/10 transition-opacity ${!e1RM ? 'opacity-30 pointer-events-none' : ''}`}>
              <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-4">2. Working Set Targets</h3>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Target Reps</label>
                  <input type="number" value={targetReps} onChange={e => setTargetReps(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-2 text-white text-center" placeholder="5"/>
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Target RPE</label>
                  <input type="number" step="0.5" value={targetRpe} onChange={e => setTargetRpe(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-2 text-white text-center" placeholder="8"/>
                </div>
              </div>

              {prescribed && (
                <div className="mt-4 bg-orange-500/20 border border-orange-500/30 p-4 rounded-lg text-center">
                  <p className="text-xs text-orange-400/80 uppercase font-bold tracking-wider mb-1">Put this on the bar:</p>
                  <p className="text-3xl font-bold text-orange-400">{prescribed} <span className="text-lg text-orange-400/60 font-normal">kg</span></p>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}