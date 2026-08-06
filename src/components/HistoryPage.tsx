"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Rep {
  rep_number: number;
  avg_concentric_velocity: number;
  avg_eccentric_velocity: number;
  peak_concentric_velocity: number;
  concentric_duration: number;
  eccentric_duration: number;
  percent_speed_drop: number;
  pause_duration: number;
  rpe: number | null;
}

interface Set {
  id: string;
  exercise: string;
  weight_kg: number | null;
  rpe: number | null;
  velocity_unit: string | null;
  notes: string | null;
  created_at: string;
  reps: Rep[];
}

interface Workout {
  id: string;
  title: string;
  date: string;
  sets: Set[];
}

interface Props {
  onClose: () => void;
}

const EXERCISE_LABELS: Record<string, string> = {
  squat: "Squat",
  bench_press: "Bench Press",
  deadlift: "Deadlift",
  overhead_press: "Overhead Press",
  row: "Row",
  other: "Other",
};

function exerciseLabel(ex: string) {
  return EXERCISE_LABELS[ex] ?? ex;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function dropColour(pct: number) {
  if (pct <= 0) return "text-white/40";
  if (pct < 5) return "text-emerald-400";
  if (pct < 10) return "text-amber-400";
  return "text-red-400";
}

function peakColour(val: number, rep1: number) {
  const ratio = rep1 > 0 ? val / rep1 : 1;
  if (ratio >= 0.95) return "text-emerald-400";
  if (ratio >= 0.85) return "text-amber-400";
  return "text-red-400";
}

function pauseColour(seconds: number) {
  if (seconds <= 0) return "";
  if (seconds < 0.5) return "text-purple-300";
  if (seconds < 1.0) return "text-purple-400";
  return "text-purple-300 font-bold";
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-center text-xs font-semibold text-white/50 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-center tabular-nums ${className}`}>
      {children}
    </td>
  );
}

export default function HistoryPage({ onClose }: Props) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      const { data, error } = await supabase
        .from("workouts")
        .select(`
          id,
          title,
          date,
          sets (
            id,
            exercise,
            weight_kg,
            rpe,
            velocity_unit,
            notes,
            created_at,
            reps (
              rep_number,
              avg_concentric_velocity,
              avg_eccentric_velocity,
              peak_concentric_velocity,
              concentric_duration,
              eccentric_duration,
              percent_speed_drop,
              pause_duration,
              rpe
            )
          )
        `)
        .order("date", { ascending: false })
        .order("created_at", { referencedTable: "sets", ascending: true });

      if (error) {
        setError(error.message);
      } else {
        setWorkouts((data as unknown as Workout[]) ?? []);
      }

      setLoading(false);
    };

    load();
  }, []);

  const toggleWorkout = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const deleteSet = async (setId: string, workoutId: string) => {
    const supabase = createClient();

    await supabase.from("sets").delete().eq("id", setId);

    setWorkouts((prev) =>
      prev
        .map((w) =>
          w.id === workoutId
            ? { ...w, sets: w.sets.filter((s) => s.id !== setId) }
            : w
        )
        .filter((w) => w.sets.length > 0)
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0f0f0f] overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between py-6 border-b border-white/10 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Workout History</h1>
            <p className="text-white/40 text-sm mt-0.5">
              Your saved sets and rep velocity data
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && workouts.length === 0 && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">📋</p>
            <p className="text-white/40">No workouts saved yet.</p>
            <p className="text-white/25 text-sm mt-1">
              Analyse a video and click "Save Set to History" to get started.
            </p>
          </div>
        )}

        {/* Workouts */}
        <div className="flex flex-col gap-4">
          {workouts.map((workout) => (
            <div
              key={workout.id}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
            >
              {/* Workout header */}
              <button
                onClick={() => toggleWorkout(workout.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
              >
                <div>
                  <p className="font-bold text-white">{workout.title}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {new Date(workout.date).toLocaleDateString("en-NZ", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    {" · "}
                    {workout.sets.length} set
                    {workout.sets.length !== 1 ? "s" : ""}
                  </p>
                </div>

                <span className="text-white/40 text-lg">
                  {expanded[workout.id] ? "▲" : "▼"}
                </span>
              </button>

              {/* Sets */}
              {expanded[workout.id] && (
                <div className="px-5 pb-5 flex flex-col gap-4">
                  {workout.sets.map((set) => {
                    const sortedReps = [...set.reps].sort(
                      (a, b) => a.rep_number - b.rep_number
                    );

                    const unit = set.velocity_unit || "m/s";
                    const rep1Peak =
                      sortedReps[0]?.peak_concentric_velocity ?? 1;
                    const lastRep = sortedReps[sortedReps.length - 1];
                    const anyPause = sortedReps.some(
                      (rep) => (rep.pause_duration ?? 0) >= 0.2
                    );

                    return (
                      <div
                        key={set.id}
                        className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
                      >
                        {/* Set header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-orange-400 font-bold text-sm">
                              {exerciseLabel(set.exercise)}
                            </span>

                            {set.weight_kg != null && (
                              <span className="text-white/50 text-sm font-mono">
                                {set.weight_kg}kg
                              </span>
                            )}

                            {set.rpe != null && (
                              <span className="text-purple-300 text-xs font-semibold bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5">
                                Final RPE {fmt(set.rpe, 1).replace(".0", "")}
                              </span>
                            )}

                            {set.notes && (
                              <span className="text-white/30 text-xs italic">
                                "{set.notes}"
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-white/30 text-xs">
                              {set.reps.length} rep
                              {set.reps.length !== 1 ? "s" : ""}
                            </span>

                            <button
                              onClick={() => deleteSet(set.id, workout.id)}
                              className="text-red-400/50 hover:text-red-400 text-xs transition-colors"
                              title="Delete set"
                            >
                              🗑
                            </button>
                          </div>
                        </div>

                        {/* Summary cards */}
                        {sortedReps.length > 0 && lastRep && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-white/10">
                            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-3">
                              <p className="text-white/40 text-xs">
                                Total Reps
                              </p>
                              <p className="text-xl font-bold text-white">
                                {sortedReps.length}
                              </p>
                            </div>

                            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-3">
                              <p className="text-white/40 text-xs">
                                Rep 1 Peak
                              </p>
                              <p className="text-xl font-bold text-white">
                                {fmt(rep1Peak)} {unit}
                              </p>
                            </div>

                            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-3">
                              <p className="text-white/40 text-xs">
                                Final Peak
                              </p>
                              <p className="text-xl font-bold text-white">
                                {fmt(lastRep.peak_concentric_velocity)} {unit}
                              </p>
                            </div>

                            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-3">
                              <p className="text-white/40 text-xs">
                                Total Drop
                              </p>
                              <p
                                className={`text-xl font-bold ${dropColour(
                                  lastRep.percent_speed_drop
                                )}`}
                              >
                                {fmt(Math.abs(lastRep.percent_speed_drop), 1)}%
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Rep table */}
                        {sortedReps.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-white/10 bg-white/5">
                                  <Th>Rep</Th>
                                  <Th>
                                    Avg Concentric
                                    <br />
                                    <span className="font-normal text-white/40">
                                      ({unit})
                                    </span>
                                  </Th>
                                  <Th>
                                    Avg Eccentric
                                    <br />
                                    <span className="font-normal text-white/40">
                                      ({unit})
                                    </span>
                                  </Th>
                                  <Th>
                                    Peak Concentric
                                    <br />
                                    <span className="font-normal text-white/40">
                                      smoothed ({unit})
                                    </span>
                                  </Th>
                                  <Th>
                                    Conc. Time
                                    <br />
                                    <span className="font-normal text-white/40">
                                      (s)
                                    </span>
                                  </Th>
                                  <Th>
                                    Ecc. Time
                                    <br />
                                    <span className="font-normal text-white/40">
                                      (s)
                                    </span>
                                  </Th>

                                  {anyPause && (
                                    <Th>
                                      Pause
                                      <br />
                                      <span className="font-normal text-white/40">
                                        (s)
                                      </span>
                                    </Th>
                                  )}

                                  <Th>
                                    Speed Drop
                                    <br />
                                    <span className="font-normal text-white/40">
                                      vs rep 1
                                    </span>
                                  </Th>

                                  <Th>RPE</Th>
                                </tr>
                              </thead>

                              <tbody>
                                {sortedReps.map((rep, i) => (
                                  <tr
                                    key={rep.rep_number}
                                    className={`border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors ${
                                      i === 0 ? "bg-orange-500/5" : ""
                                    }`}
                                  >
                                    <td className="px-4 py-3 text-center">
                                      <span
                                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                          i === 0
                                            ? "bg-orange-500 text-white"
                                            : "bg-white/10 text-white/70"
                                        }`}
                                      >
                                        {rep.rep_number}
                                      </span>
                                    </td>

                                    <Td>
                                      {fmt(rep.avg_concentric_velocity)}
                                    </Td>

                                    <Td>{fmt(rep.avg_eccentric_velocity)}</Td>

                                    <Td
                                      className={peakColour(
                                        rep.peak_concentric_velocity,
                                        rep1Peak
                                      )}
                                    >
                                      {fmt(rep.peak_concentric_velocity)}
                                    </Td>

                                    <Td>{fmt(rep.concentric_duration)}</Td>

                                    <Td>{fmt(rep.eccentric_duration)}</Td>

                                    {anyPause && (
                                      <Td
                                        className={pauseColour(
                                          rep.pause_duration ?? 0
                                        )}
                                      >
                                        {(rep.pause_duration ?? 0) >= 0.2 ? (
                                          <span className="flex items-center justify-center gap-1">
                                            <span>⏸</span>
                                            <span>
                                              {fmt(rep.pause_duration)}
                                            </span>
                                          </span>
                                        ) : (
                                          <span className="text-white/20">
                                            —
                                          </span>
                                        )}
                                      </Td>
                                    )}

                                    <Td
                                      className={`font-semibold ${dropColour(
                                        rep.percent_speed_drop
                                      )}`}
                                    >
                                      {i === 0 ? (
                                        <span className="text-white/30 font-normal text-xs">
                                          baseline
                                        </span>
                                      ) : (
                                        `${
                                          rep.percent_speed_drop > 0 ? "−" : "+"
                                        }${fmt(
                                          Math.abs(rep.percent_speed_drop),
                                          1
                                        )}%`
                                      )}
                                    </Td>

                                    <Td className="text-purple-300 font-semibold">
                                      {rep.rpe == null
                                        ? "—"
                                        : fmt(rep.rpe, 1).replace(".0", "")}
                                    </Td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}