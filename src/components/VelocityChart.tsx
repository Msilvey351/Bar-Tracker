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
import type { VelocityFrame, RepStats, CalibrationPoints } from "@/types";

interface Props {
  vFrames:     VelocityFrame[];
  repStats:    RepStats[];
  calibration: CalibrationPoints | null;
}

const PHASE_COLOUR: Record<string, string> = {
  concentric: "#f97316",
  eccentric:  "#3b82f6",
  rest:       "#ffffff22",
};

interface ChartPoint {
  time:       string;
  smoothed:   number;
  concentric: number | null;
  eccentric:  number | null;
  phase:      string;
  repIndex:   number | null;
}

export default function VelocityChart({ vFrames, repStats, calibration }: Props) {

  // ── Unit helpers ────────────────────────────────────────────────────────────
  const isCalib  = calibration !== null;
  const unit     = isCalib ? "m/s" : "px/s";

  /** Convert px/s to display unit, rounded appropriately */
  const toDisplay = (pxPerS: number): number => {
    if (!isCalib) return Math.round(pxPerS);
    return Math.round((pxPerS / calibration!.pxPerM) * 1000) / 1000;
  };

  // ── Build chart data ────────────────────────────────────────────────────────
  const data: ChartPoint[] = vFrames.map((f) => {
    const v = toDisplay(f.velocitySmoothed);
    const signed =
      f.phase === "rest"        ?  0
      : f.phase === "eccentric" ? -v
      :                            v;
    return {
      time:       f.timeSeconds.toFixed(2),
      smoothed:   signed,
      concentric: f.phase === "concentric" ?  v : null,
      eccentric:  f.phase === "eccentric"  ? -v : null,
      phase:      f.phase,
      repIndex:   f.repIndex,
    };
  });

  // ── Rep boundary lines ──────────────────────────────────────────────────────
  const repBoundaries = repStats.map((s) => {
    const firstFrame = vFrames.find(
      (f) => f.repIndex === s.repNumber - 1 && f.phase !== "rest"
    );
    return {
      repNumber: s.repNumber,
      time:      firstFrame?.timeSeconds.toFixed(2) ?? "0",
    };
  });

  const maxV    = Math.max(...vFrames.map((f) => toDisplay(f.velocitySmoothed)), 1);
  const axisMax = isCalib
    ? Math.ceil(maxV * 1.2 * 100) / 100   // round to 2dp for m/s
    : Math.ceil(maxV * 1.2);

  // ── Tick formatter ──────────────────────────────────────────────────────────
  const tickFmt = (v: number) => {
    const abs = Math.abs(v);
    const str = isCalib ? abs.toFixed(2) : String(abs);
    return v > 0 ? `+${str}` : v < 0 ? `−${str}` : "0";
  };

  // ── Custom tooltip ──────────────────────────────────────────────────────────
  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?:  boolean;
    payload?: Array<{ value: number; dataKey: string }>;
    label?:   string;
  }) => {
    if (!active || !payload?.length) return null;
    const point  = data.find((d) => d.time === label);
    const phase  = point?.phase   ?? "rest";
    const repIdx = point?.repIndex ?? null;
    const val    = Math.abs(payload[0]?.value ?? 0);
    const sign   = phase === "eccentric" ? "−" : phase === "concentric" ? "+" : "";

    return (
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
        <p className="text-white/40 mb-1">{label}s</p>
        <p
          className="font-bold capitalize mb-0.5"
          style={{ color: PHASE_COLOUR[phase] ?? "#ffffff22" }}
        >
          {phase}
          {repIdx !== null ? ` · Rep ${repIdx + 1}` : ""}
        </p>
        <p className="text-white font-mono">
          {sign}{isCalib ? val.toFixed(3) : Math.round(val)} {unit}
        </p>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-white/80">Velocity Trace</h3>
          <p className="text-white/30 text-xs mt-0.5">
            <span style={{ color: PHASE_COLOUR.concentric }}>■</span>{" "}
            Concentric (positive) &nbsp;
            <span style={{ color: PHASE_COLOUR.eccentric }}>■</span>{" "}
            Eccentric (negative)
          </p>
        </div>
        {isCalib ? (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
            ✅ {calibration!.diameterCm}cm · {unit}
          </span>
        ) : (
          <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
            ⚠️ uncalibrated · {unit}
          </span>
        )}
      </div>

      {/* Main chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 20, left: 12 }}
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
              value:    "Time (s)",
              position: "insideBottom",
              offset:   -10,
              fill:     "rgba(255,255,255,0.3)",
              fontSize: 11,
            }}
          />

          <YAxis
            stroke="rgba(255,255,255,0.2)"
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
            domain={[-axisMax, axisMax]}
            tickFormatter={tickFmt}
            label={{
              value:    unit,
              angle:    -90,
              position: "insideLeft",
              offset:   10,
              fill:     "rgba(255,255,255,0.3)",
              fontSize: 11,
            }}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Zero line */}
          <ReferenceLine
            y={0}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1.5}
          />

          {/* Rep boundary lines */}
          {repBoundaries.map((b) => (
            <ReferenceLine
              key={b.repNumber}
              x={b.time}
              stroke="rgba(255,255,255,0.15)"
              strokeDasharray="4 4"
              label={{
                value:    `R${b.repNumber}`,
                position: "top",
                fill:     "rgba(255,255,255,0.35)",
                fontSize: 10,
              }}
            />
          ))}

          {/* Faint background trace */}
          <Area
            type="monotone"
            dataKey="smoothed"
            stroke="rgba(255,255,255,0.06)"
            fill="rgba(255,255,255,0.02)"
            dot={false}
            strokeWidth={1}
            legendType="none"
          />

          {/* Concentric — orange, positive */}
          <Line
            type="monotone"
            dataKey="concentric"
            stroke="#f97316"
            dot={false}
            strokeWidth={3}
            connectNulls={false}
            name="Concentric"
          />

          {/* Eccentric — blue, negative */}
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

      {/* Per-rep peak concentric bar chart */}
      {repStats.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <p className="text-white/50 text-xs font-semibold mb-3 uppercase tracking-wider">
            Peak Concentric Velocity per Rep
          </p>
          <div className="flex items-end gap-2 h-20">
            {repStats.map((s) => {
              const rep1Peak = repStats[0].peakConcentricVelocity;
              const ratio    = rep1Peak > 0 ? s.peakConcentricVelocity / rep1Peak : 1;
              const barH     = Math.max(ratio * 100, 4);
              const colour   =
                ratio >= 0.95 ? "#10b981" :
                ratio >= 0.85 ? "#f59e0b" : "#ef4444";
              const displayPeak = toDisplay(s.peakConcentricVelocity);
              return (
                <div
                  key={s.repNumber}
                  className="flex flex-col items-center gap-1 flex-1"
                >
                  <span
                    className="text-xs font-mono tabular-nums"
                    style={{ color: colour }}
                  >
                    {isCalib ? displayPeak.toFixed(2) : Math.round(displayPeak)}
                  </span>
                  <div className="w-full flex items-end" style={{ height: "56px" }}>
                    <div
                      className="w-full rounded-t-sm"
                      style={{
                        height:     `${barH}%`,
                        background: colour,
                        opacity:    0.85,
                      }}
                    />
                  </div>
                  <span className="text-white/30 text-xs">R{s.repNumber}</span>
                </div>
              );
            })}
          </div>
          <p className="text-white/20 text-xs text-center mt-2">
            {unit} · smoothed peak concentric
          </p>
        </div>
      )}

    </div>
  );
}