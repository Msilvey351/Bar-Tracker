"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RepStats, LiftType, CalibrationPoints } from "@/types";

interface Props {
  repStats: RepStats[];
  calibration: CalibrationPoints | null;
  liftType: LiftType;
  onClose: () => void;
  onSaved: () => void;
}

const EXERCISES: { id: string; label: string; lift: LiftType | "all" }[] = [
  { id: "squat", label: "Squat", lift: "squat" },
  { id: "bench_press", label: "Bench Press", lift: "bench" },
  { id: "deadlift", label: "Deadlift", lift: "deadlift" },
  { id: "overhead_press", label: "Overhead Press", lift: "all" },
  { id: "row", label: "Row", lift: "all" },
  { id: "other", label: "Other", lift: "all" },
];

function defaultExercise(liftType: LiftType): string {
  switch (liftType) {
    case "squat":
      return "squat";
    case "bench":
      return "bench_press";
    case "deadlift":
      return "deadlift";
  }
}

const RPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— Not rated —" },
  { value: "10", label: "10" },
  { value: "9.5", label: "9.5" },
  { value: "9", label: "9" },
  { value: "8.5", label: "8.5" },
  { value: "8", label: "8" },
  { value: "7.5", label: "7.5" },
  { value: "7", label: "7" },
  { value: "6.5", label: "6.5" },
  { value: "6", label: "6" },
  { value: "5.5", label: "5.5" },
  { value: "5", label: "5" },
  { value: "4.5", label: "4.5" },
  { value: "4", label: "4" },
  { value: "3.5", label: "3.5" },
  { value: "3", label: "3" },
  { value: "2.5", label: "2.5" },
  { value: "2", label: "2" },
  { value: "1.5", label: "1.5" },
  { value: "1", label: "1" },
];

const selectClass = `
  w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3
  text-white focus:outline-none focus:border-orange-500 transition-colors
  appearance-none cursor-pointer
`;

function fmt(n: number, decimals = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export default function SaveSetModal({
  repStats,
  calibration,
  liftType,
  onClose,
  onSaved,
}: Props) {
  const [exercise, setExercise] = useState(defaultExercise(liftType));
  const [weightKg, setWeightKg] = useState<string>("");
  const [rpe, setRpe] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCalibrated = calibration !== null;
  const velocityUnit = isCalibrated ? "m/s" : "px/s";

  const convertVelocity = (pxPerSecond: number) => {
    if (!calibration) return pxPerSecond;
    return pxPerSecond / calibration.pxPerM;
  };

  const finalRepRpe = rpe ? parseFloat(rpe) : null;

  const getRepRpe = (repNumber: number) => {
    if (finalRepRpe == null || !Number.isFinite(finalRepRpe)) return null;

    const totalReps = repStats.length;

    /**
     * User rates final rep.
     *
     * Example:
     * 7 reps, final RPE 9:
     * rep 7 = 9
     * rep 6 = 8
     * rep 5 = 7
     * ...
     */
    const repsBeforeLast = totalReps - repNumber;
    return Math.max(1, finalRepRpe - repsBeforeLast);
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in");
      setLoading(false);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let workoutId: string;

    const { data: existing, error: existingErr } = await supabase
      .from("workouts")
      .select("id")
      .gte("date", today.toISOString())
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      setError(existingErr.message);
      setLoading(false);
      return;
    }

    if (existing) {
      workoutId = existing.id;
    } else {
      const { data: newWorkout, error: wErr } = await supabase
        .from("workouts")
        .insert({
          user_id: user.id,
          title: `${today.toLocaleDateString("en-NZ", {
            weekday: "long",
          })} Workout`,
          date: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (wErr || !newWorkout) {
        setError(wErr?.message ?? "Failed to create workout");
        setLoading(false);
        return;
      }

      workoutId = newWorkout.id;
    }

    const { data: newSet, error: sErr } = await supabase
      .from("sets")
      .insert({
        workout_id: workoutId,
        exercise,
        weight_kg: weightKg ? parseFloat(weightKg) : null,

        /**
         * This remains the user-rated RPE for the final rep / whole set.
         */
        rpe: finalRepRpe,

        /**
         * Helps history know whether saved velocities are m/s or px/s.
         */
        velocity_unit: velocityUnit,

        notes: notes || null,
      })
      .select("id")
      .single();

    if (sErr || !newSet) {
      setError(sErr?.message ?? "Failed to create set");
      setLoading(false);
      return;
    }

    /**
     * Important:
     * Save the same values the immediate RepTable shows.
     *
     * RepTable displays:
     * calibrated: px/s / pxPerM = m/s
     * uncalibrated: raw px/s
     *
     * So we store that same displayed unit here.
     */
    const repsToInsert = repStats.map((rep) => ({
      set_id: newSet.id,
      rep_number: rep.repNumber,

      avg_concentric_velocity: convertVelocity(rep.avgConcentricVelocity),
      avg_eccentric_velocity: convertVelocity(rep.avgEccentricVelocity),
      peak_concentric_velocity: convertVelocity(rep.peakConcentricVelocity),

      concentric_duration: rep.concentricDuration,
      eccentric_duration: rep.eccentricDuration,
      percent_speed_drop: rep.percentSpeedDrop,
      pause_duration: rep.pauseDuration ?? 0,

      /**
       * Per-rep RPE derived backwards from the final rep RPE.
       */
      rpe: getRepRpe(rep.repNumber),
    }));

    const { error: rErr } = await supabase.from("reps").insert(repsToInsert);

    if (rErr) {
      setError(rErr.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    onSaved();
  };

  const previewFinalRpe = finalRepRpe;
  const previewFirstRpe =
    previewFinalRpe == null
      ? null
      : Math.max(1, previewFinalRpe - (repStats.length - 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-white">Save Set</h2>
            <p className="text-white/40 text-xs mt-0.5">
              {repStats.length} rep{repStats.length !== 1 ? "s" : ""} · peak{" "}
              {fmt(convertVelocity(repStats[0]?.peakConcentricVelocity ?? 0))}{" "}
              {velocityUnit}
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

            <div className="relative">
              <select
                value={exercise}
                onChange={(e) => setExercise(e.target.value)}
                className={selectClass}
                style={{ backgroundColor: "#1a1a1a", color: "white" }}
              >
                {EXERCISES.map((ex) => (
                  <option
                    key={ex.id}
                    value={ex.id}
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    {ex.label}
                  </option>
                ))}
              </select>

              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                ▼
              </div>
            </div>
          </div>

          {/* Weight */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Weight (kg){" "}
              <span className="text-white/20 normal-case font-normal">
                — optional
              </span>
            </label>

            <input
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 100"
              min={0}
              step={0.5}
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* RPE */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Final Rep RPE{" "}
              <span className="text-white/20 normal-case font-normal">
                — optional
              </span>
            </label>

            <div className="relative">
              <select
                value={rpe}
                onChange={(e) => setRpe(e.target.value)}
                className={selectClass}
                style={{ backgroundColor: "#1a1a1a", color: "white" }}
              >
                {RPE_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                ▼
              </div>
            </div>

            {previewFinalRpe != null && (
              <p className="text-white/30 text-xs mt-1.5">
                Saved per rep as RPE {previewFirstRpe} → {previewFinalRpe}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Notes{" "}
              <span className="text-white/20 normal-case font-normal">
                — optional
              </span>
            </label>

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. felt good, paused reps"
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
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