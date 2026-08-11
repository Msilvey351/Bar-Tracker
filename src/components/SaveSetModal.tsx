"use client";

import { useState, useEffect } from "react";
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
  const [setNumber, setSetNumber] = useState<number>(1); // <-- NEW STATE
  const [weightKg, setWeightKg] = useState<string>("");
  const [rpe, setRpe] = useState<string>("");
  const [notes, setNotes] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [isFetchingSet, setIsFetchingSet] = useState(true); // Loading state for auto-set-number
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
    const repsBeforeLast = totalReps - repNumber;
    return finalRepRpe - repsBeforeLast;
  };

  const getRepRir = (repRpe: number | null) => {
    if (repRpe == null) return null;
    return 10 - repRpe; 
  };

  // 🔥 NEW: Auto-detect what set number they are on for today's workout
  // 🔥 NEW: Auto-detect what set number they are on for today's workout
  useEffect(() => {
    async function fetchNextSetNumber() {
      setIsFetchingSet(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsFetchingSet(false);
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 1. Find today's workout
      const { data: workout } = await supabase
        .from("workouts")
        .select("id")
        .gte("date", today.toISOString())
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (workout) {
        // 2. Safely count sets by just grabbing the IDs and checking the length
        const { data: existingSets } = await supabase
          .from("sets")
          .select("id")
          .eq("workout_id", workout.id)
          .eq("exercise", exercise);

        if (existingSets) {
          setSetNumber(existingSets.length + 1);
        }
      }
      setIsFetchingSet(false);
    }

    fetchNextSetNumber();
  }, [exercise]); // Re-run if they change the exercise dropdown!

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();

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
          title: `${today.toLocaleDateString("en-NZ", { weekday: "long" })} Workout`,
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
        set_number: setNumber, // <-- 🔥 NEW: Save the set number!
        weight_kg: weightKg ? parseFloat(weightKg) : null,
        rpe: finalRepRpe,
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

    const repsToInsert = repStats.map((rep) => {
      const repRpe = getRepRpe(rep.repNumber);
      const repRir = getRepRir(repRpe);

      return {
        set_id: newSet.id,
        rep_number: rep.repNumber,
        avg_concentric_velocity: convertVelocity(rep.avgConcentricVelocity),
        avg_eccentric_velocity: convertVelocity(rep.avgEccentricVelocity),
        peak_concentric_velocity: convertVelocity(rep.peakConcentricVelocity),
        concentric_duration: rep.concentricDuration,
        eccentric_duration: rep.eccentricDuration,
        percent_speed_drop: rep.percentSpeedDrop,
        pause_duration: rep.pauseDuration ?? 0,
        rpe: repRpe,
        rir: repRir,
      };
    });

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
  const previewFirstRpe = previewFinalRpe == null ? null : previewFinalRpe - (repStats.length - 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-hide"
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
                  <option key={ex.id} value={ex.id} style={{ backgroundColor: "#1a1a1a", color: "white" }}>
                    {ex.label}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                ▼
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Set Number */}
            <div>
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 flex justify-between items-center">
                <span>Set Number</span>
                {isFetchingSet && <span className="text-orange-400 text-[10px] animate-pulse">Auto...</span>}
              </label>
              <div className="flex bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden">
                <button 
                  onClick={() => setSetNumber(Math.max(1, setNumber - 1))}
                  className="px-3 bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
                >
                  -
                </button>
                <input
                  type="number"
                  value={setNumber}
                  onChange={(e) => setSetNumber(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-transparent px-2 py-3 text-center text-white focus:outline-none focus:bg-white/5 transition-colors"
                  min={1}
                />
                <button 
                  onClick={() => setSetNumber(setNumber + 1)}
                  className="px-3 bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Weight */}
            <div>
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Weight (kg)
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
          </div>

          {/* RPE */}
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Final Rep RPE <span className="text-white/20 normal-case font-normal">— optional</span>
            </label>
            <div className="relative">
              <select
                value={rpe}
                onChange={(e) => setRpe(e.target.value)}
                className={selectClass}
                style={{ backgroundColor: "#1a1a1a", color: "white" }}
              >
                {RPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} style={{ backgroundColor: "#1a1a1a", color: "white" }}>
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
              Notes <span className="text-white/20 normal-case font-normal">— optional</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. felt good, paused reps"
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-3 mt-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
          >
            {loading ? "Saving…" : "Save Set 💾"}
          </button>
        </div>
      </div>
    </div>
  );
}