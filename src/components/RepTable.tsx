"use client";

import type { RepStats } from "@/types";
import clsx from "clsx";

interface Props {
  stats: RepStats[];
}

/** Colour-code % speed drop: green < 5%, amber < 10%, red >= 10% */
function dropColour(pct: number) {
  if (pct <= 0)  return "text-white/40";   // rep 1 baseline
  if (pct < 5)   return "text-emerald-400";
  if (pct < 10)  return "text-amber-400";
  return "text-red-400";
}

/** Colour-code peak concentric relative to rep 1 */
function peakColour(val: number, rep1: number) {
  const ratio = rep1 > 0 ? val / rep1 : 1;
  if (ratio >= 0.95) return "text-emerald-400";
  if (ratio >= 0.85) return "text-amber-400";
  return "text-red-400";
}

function fmt(n: number, decimals = 0) {
  return isNaN(n) || !isFinite(n) ? "—" : n.toFixed(decimals);
}

export default function RepTable({ stats }: Props) {
  if (stats.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-white/40 text-sm">
        No reps detected. Try adjusting the seed point or check the video has
        clear vertical barbell movement.
      </div>
    );
  }

  const rep1Peak = stats[0]?.peakConcentricVelocity ?? 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Reps" value={String(stats.length)} />
        <StatCard
          label="Rep 1 Peak"
          value={`${fmt(rep1Peak)} px/s`}
          sub="concentric"
        />
        <StatCard
          label="Final Peak"
          value={`${fmt(stats[stats.length - 1].peakConcentricVelocity)} px/s`}
          sub="concentric"
        />
        <StatCard
          label="Total Drop"
          value={`${fmt(stats[stats.length - 1].percentSpeedDrop, 1)}%`}
          sub="vs rep 1"
          valueClass={dropColour(stats[stats.length - 1].percentSpeedDrop)}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <Th>Rep</Th>
              <Th>Avg Concentric<br /><span className="font-normal text-white/40">(px/s)</span></Th>
              <Th>Avg Eccentric<br /><span className="font-normal text-white/40">(px/s)</span></Th>
              <Th>Peak Concentric<br /><span className="font-normal text-white/40">smoothed (px/s)</span></Th>
              <Th>Conc. Time<br /><span className="font-normal text-white/40">(s)</span></Th>
              <Th>Ecc. Time<br /><span className="font-normal text-white/40">(s)</span></Th>
              <Th>Speed Drop<br /><span className="font-normal text-white/40">vs rep 1</span></Th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr
                key={s.repNumber}
                className={clsx(
                  "border-b border-white/5 transition-colors hover:bg-white/5",
                  i === 0 && "bg-orange-500/5"
                )}
              >
                {/* Rep number */}
                <td className="px-4 py-3 font-bold text-center">
                  <span className={clsx(
                    "inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold",
                    i === 0 ? "bg-orange-500 text-white" : "bg-white/10 text-white/70"
                  )}>
                    {s.repNumber}
                  </span>
                </td>

                {/* Avg concentric */}
                <Td>{fmt(s.avgConcentricVelocity)}</Td>

                {/* Avg eccentric */}
                <Td>{fmt(s.avgEccentricVelocity)}</Td>

                {/* Peak concentric */}
                <Td className={peakColour(s.peakConcentricVelocity, rep1Peak)}>
                  {fmt(s.peakConcentricVelocity)}
                </Td>

                {/* Concentric duration */}
                <Td>{fmt(s.concentricDuration, 2)}</Td>

                {/* Eccentric duration */}
                <Td>{fmt(s.eccentricDuration, 2)}</Td>

                {/* % speed drop */}
                <Td className={clsx("font-semibold", dropColour(s.percentSpeedDrop))}>
                  {i === 0 ? (
                    <span className="text-white/30 font-normal text-xs">baseline</span>
                  ) : (
                    `${s.percentSpeedDrop > 0 ? "−" : ""}${fmt(Math.abs(s.percentSpeedDrop), 1)}%`
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-white/20 text-xs text-center">
        Velocities in pixels/second · calibrate with a known distance for m/s
      </p>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-center text-xs font-semibold text-white/50 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={clsx("px-4 py-3 text-center tabular-nums", className)}>
      {children}
    </td>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-1">
      <span className="text-white/40 text-xs">{label}</span>
      <span className={clsx("text-xl font-bold tabular-nums", valueClass ?? "text-white")}>
        {value}
      </span>
      {sub && <span className="text-white/30 text-xs">{sub}</span>}
    </div>
  );
}