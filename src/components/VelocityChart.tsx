"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { VelocityFrame, RepStats } from "@/types";

interface Props {
  vFrames: VelocityFrame[];
  repStats: RepStats[];
}

const PHASE_COLOUR: Record<string, string> = {
  concentric: "#f97316",
  eccentric:  "#3b82f6",
  rest:       "#ffffff22",
};

interface ChartPoint {
  time: string;
  smoothed: number;
  concentric: number | null;
  eccentric:  number | null;
  phase: string;
  repIndex: number | null;
}

export default function VelocityChart({ vFrames, repStats }: Props) {
  const data: ChartPoint[] = vFrames.map((f) => ({
    time:        f.timeSeconds.toFixed(2),
    smoothed:    Math.round(f.velocitySmoothed),
    concentric:  f.phase === "concentric" ? Math.round(f.velocitySmoothed) : null,
    eccentric:   f.phase === "eccentric"  ? Math.round(f.velocitySmoothed) : null,
    phase:       f.phase,
    repIndex:    f.repIndex,
  }));

  const repBoundaries = repStats.map((s) => {
    const firstFrame = vFrames.find(
      (f) => f.repIndex === s.repNumber - 1 && f.phase !== "rest"
    );
    return {
      repNumber: s.repNumber,
      time: firstFrame?.timeSeconds.toFixed(2) ?? "0",
    };
  });

  const maxV = Math.max(...vFrames.map((f) => f.velocitySmoothed), 1);

  // ── Custom tooltip ──────────────────────────────────────────────────────────
  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number; dataKey: string }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const point = data.find((d) => d.time === label);
    const phase  = point?.phase ?? "rest";
    const repIdx = point?.repIndex ?? null;
    return (
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs">
        <p className="text-white/40 mb-1">{label}s</p>
        <p
          className="font-bold capitalize"
          style={{ color: PHASE_COLOUR[phase] ?? "#ffffff22" }}
        >
          {phase}
          {repIdx !== null ? ` · Rep ${repIdx + 1}` : ""}
        </p>
        <p className="text-white font-mono">{payload[0]?.value} px/s</p>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col gap-6">

      {/* Header */}
      <div>
        <h3 className="font-bold text-white/80">Velocity Trace</h3>
        <p className="text-white/30 text-xs mt-0.5">
          <span style={{ color: PHASE_COLOUR.concentric }}>■</span> Concentric
          &nbsp;
          <span style={{ color: PHASE_COLOUR.eccentric }}>■</span> Eccentric
          &nbsp;
          <span className="text-white/20">■</span> Rest
        </p>
      </div>

      {/* Main chart */}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 16, bottom: 16, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />

          <XAxis
            dataKey="time"
            stroke="rgba(255,255,255,0.2)"
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
            label={{
              value: "Time (s)",
              position: "insideBottom",
              offset: -8,
              fill: "rgba(255,255,255,0.3)",
              fontSize: 11,
            }}
          />

          <YAxis
            stroke="rgba(255,255,255,0.2)"
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
            domain={[0, Math.ceil(maxV * 1.2)]}
            label={{
              value: "px/s",
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.3)",
              fontSize: 11,
            }}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Rep boundary reference lines */}
          {repBoundaries.map((b) => (
            <ReferenceLine
              key={b.repNumber}
              x={b.time}
              stroke="rgba(255,255,255,0.15)"
              strokeDasharray="4 4"
              label={{
                value: `R${b.repNumber}`,
                position: "top",
                fill: "rgba(255,255,255,0.3)",
                fontSize: 10,
              }}
            />
          ))}

          {/* Faint background area — full smoothed velocity */}
          <Area
            type="monotone"
            dataKey="smoothed"
            stroke="rgba(255,255,255,0.08)"
            fill="rgba(255,255,255,0.03)"
            dot={false}
            strokeWidth={1}
            legendType="none"
          />

          {/* Concentric phase — orange */}
          <Line
            type="monotone"
            dataKey="concentric"
            stroke="#f97316"
            dot={false}
            strokeWidth={3}
            connectNulls={false}
            name="Concentric"
          />

          {/* Eccentric phase — blue */}
          <Line
            type="monotone"
            dataKey="eccentric"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={3}
            connectNulls={false}
            name="Eccentric"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Per-rep peak velocity bar chart */}
      {repStats.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <p className="text-white/50 text-xs font-semibold mb-3 uppercase tracking-wider">
            Peak Concentric Velocity per Rep
          </p>
          <div className="flex items-end gap-2 h-16">
            {repStats.map((s) => {
              const rep1Peak = repStats[0].peakConcentricVelocity;
              const ratio    = rep1Peak > 0 ? s.peakConcentricVelocity / rep1Peak : 1;
              const barH     = Math.max(ratio * 100, 4);
              const colour   =
                ratio >= 0.95 ? "#10b981" :
                ratio >= 0.85 ? "#f59e0b" : "#ef4444";
              return (
                <div
                  key={s.repNumber}
                  className="flex flex-col items-center gap-1 flex-1"
                >
                  <span className="text-xs font-mono" style={{ color: colour }}>
                    {Math.round(s.peakConcentricVelocity)}
                  </span>
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: `${barH}%`,
                      background: colour,
                      opacity: 0.8,
                    }}
                  />
                  <span className="text-white/30 text-xs">R{s.repNumber}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}