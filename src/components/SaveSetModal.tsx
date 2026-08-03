"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RepStats } from "@/types";

interface Props {
  repStats:  RepStats[];
  onClose:   () => void;
  onSaved:   () => void;
}

const EXERCISES = [
  "Squat",
  "Bench Press",
  "Deadlift",
  "Overhead Press",
  "Row",
  "Other",
];

export default function SaveSetModal({ repStats, onClose, onSaved }: Props) {
  const [exercise,  setExercise]  = useState("Squat");
  const [weightKg,  setWeightKg]  = useState<string>("");
  const [notes,     setNotes]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // 1. Create or get today's workout
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in"); setLoading(false); return; }

    // Find or create a workout for today
    let workoutId: string;

    const { data: existing } = await supabase
      .from("workouts")
      .select("id")
      .gte("date", today.toISOString())
      .limit(1)
      .single();

    if (existing) {
      workoutId = existing.id;
    } else {
      const { data: newWorkout, error: wErr } = await supabase
        .from("workouts")
        .insert({
          user_id: user.id,
          title:   `${today.toLocaleDateString("en-NZ", { weekday: "long" })} Workout`,
          date:    new Date().toISOString(),
        })
        .select("id")
        .single();

      if (wErr || !newWorkout) { setError(wErr?.message ?? "Failed to create workout"); setLoading(false); return; }
      workoutId = newWorkout.id;
    }

    // 2. Create the set
    const { data: newSet, error: sErr } = await supabase
      .from("sets")
      .insert({
        workout_id: workoutId,
        exercise:   exercise.toLowerCase().replace(" ", "_"),
        weight_kg:  weightKg ? parseFloat(weightKg) : null,
        notes:      notes || null,
      })
      .select("id")
      .single();

    if (sErr || !newSet) { setError(sErr?.message ?? "Failed to create set"); setLoading(false); return; }

    // 3. Insert all reps
    const repsToInsert = repStats.map((r) => ({
      set_id:                      newSet.id,
      rep_number:                  r.repNumber,
      avg_concentric_velocity:     r.avgConcentricVelocity,
      avg_eccentric_velocity:      r.avgEccentricVelocity,
      peak_concentric_velocity:    r.peakConcentricVelocity,
      concentric_duration:         r.concentricDuration,
      eccentric_duration:          r.eccentricDuration,
      percent_speed_drop:          r.percentSpeedDrop,
      pause_duration:              r.pauseDuration ?? 0,
    }));

    const { error: rErr } = await supabase.from("reps").insert(repsToInsert);
    if (rErr) { setError(rErr.message); setLoading(false); return; }

    setLoading(false);
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-white">Save Set</h2>
            <p className="text-white/40 text-xs mt-0.5">
              {repStats.length} reps · peak {repStats[0]?.peakConcentricVelocity.toFixed(2)} m/s
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Exercise */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Exercise
            </label>
            <select
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
            >
              {EXERCISES.map((ex) => (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>
          </div>

          {/* Weight */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Weight (kg) — optional
            </label>
            <input
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 100"
              min={0}
              step={0.5}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Notes — optional
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. felt good, paused reps"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
          >
            {loading ? "Saving…" : "Save Set 💾"}
          </button>
        </div>
      </div>
    </div>
  );
}