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

/**
 * Phase colours:
 *   concentric = orange (positive, bar moving up)
 *   eccentric  = blue   (negative, bar moving down)
 *   rest/unassigned = grey (shown but not counted as a rep)
 */
const PHASE_COLOUR = {
  concentric:  "#f97316",
  eccentric:   "#3b82f6",
  unassigned:  "#6b7280",
  rest:        "#6b7280",
} as const;

interface ChartPoint {
  time:        string;
  background:  number | null;
  concentric:  number | null;
  eccentric:   number | null;
  unassigned:  number | null;
  phase:       string;
  repIndex:    number | null;
}

export default function VelocityChart({
  vFrames,
  repStats,
  calibration,
}: Props) {

  // ── Unit helpers ────────────────────────────────────────────────────────────
  const isCalib = calibration !== null;
  const unit    = isCalib ? "m/s" : "px/s";

  const toDisplay = (pxPerS: number): number => {
    if (!isCalib) return Math.round(pxPerS);
    return Math.round((pxPerS / calibration!.pxPerM) * 1000) / 1000;
  };

  // ── Build chart data ────────────────────────────────────────────────────────
  /**
   * All frames are plotted.
   *
   * Frames assigned to a rep:
   *   concentric = positive (orange)
   *   eccentric  = negative (blue)
   *
   * Frames NOT assigned to a rep (rest, unracking, reracking):
   *   shown as signed velocity but coloured grey
   *   this lets the user see what was detected but not counted
   */
  const data: ChartPoint[] = vFrames.map((f) => {
    const speed  = toDisplay(f.velocitySmoothed);
    const isDown = f.velocityY > 0;

    /**
     * Sign:
     *   bar moving down = negative (eccentric)
     *   bar moving up   = positive (concentric)
     */
    const signed = f.velocitySmoothed < 1e-6
      ? 0
      : isDown ? -speed : speed;

    const hasRep = f.repIndex !== null;

    return {
      time:       f.timeSeconds.toFixed(2),
      background: null,

      concentric: hasRep && f.phase === "concentric" ? signed  : null,
      eccentric:  hasRep && f.phase === "eccentric"  ? signed  : null,

      /**
       * Unassigned = any frame where the bar is moving but not counted as a rep.
       * This includes unracking, reracking, pauses, wobble.
       */
      unassigned: !hasRep && Math.abs(signed) > 0 ? signed : null,

      phase:    f.phase,
      repIndex: f.repIndex,
    };
  });

  // ── Rep boundary reference lines ────────────────────────────────────────────
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
    ? Math.ceil(maxV * 1.2 * 100) / 100
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
    const phase  = point?.phase    ?? "rest";
    const repIdx = point?.repIndex ?? null;

    const rawVal = payload.find(
      (p) => p.value !== null && p.value !== undefined
    )?.value ?? 0;

    const val  = Math.abs(rawVal);
    const sign =
      phase === "eccentric"  ? "−" :
      phase === "concentric" ? "+" : "";

    const colour =
      repIdx !== null
        ? phase === "concentric"
          ? PHASE_COLOUR.concentric
          : PHASE_COLOUR.eccentric
        : PHASE_COLOUR.unassigned;

    const label2 =
      repIdx !== null
        ? `${phase} · Rep ${repIdx + 1}`
        : phase === "rest"
        ? "rest"
        : "not counted";

    return (
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
        <p className="text-white/40 mb-1">{label}s</p>
        <p className="font-bold capitalize mb-0.5" style={{ color: colour }}>
          {label2}
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
          <p className="text-white/30 text-xs mt-1 flex items-center gap-3 flex-wrap">
            <span>
              <span style={{ color: PHASE_COLOUR.concentric }}>■</span>{" "}
              Concentric (positive)
            </span>
            <span>
              <span style={{ color: PHASE_COLOUR.eccentric }}>■</span>{" "}
              Eccentric (negative)
            </span>
            <span>
              <span style={{ color: PHASE_COLOUR.unassigned }}>■</span>{" "}
              Not counted
            </span>
          </p>
        </div>

        {isCalib ? (
          <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg shrink-0">
            ✅ {calibration!.diameterCm}cm · {unit}
          </span>
        ) : (
          <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg shrink-0">
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

          {/* Rep boundary reference lines */}
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

          {/* Grey — not counted (unracking, reracking, rest movement) */}
          <Line
            type="monotone"
            dataKey="unassigned"
            stroke={PHASE_COLOUR.unassigned}
            strokeOpacity={0.5}
            dot={false}
            strokeWidth={2}
            connectNulls={false}
            name="Not counted"
          />

          {/* Orange — concentric (positive, bar moving up) */}
          <Line
            type="monotone"
            dataKey="concentric"
            stroke={PHASE_COLOUR.concentric}
            dot={false}
            strokeWidth={3}
            connectNulls={false}
            name="Concentric"
          />

          {/* Blue — eccentric (negative, bar moving down) */}
          <Line
            type="monotone"
            dataKey="eccentric"
            stroke={PHASE_COLOUR.eccentric}
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
              const ratio    = rep1Peak > 0
                ? s.peakConcentricVelocity / rep1Peak
                : 1;
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
                    {isCalib
                      ? displayPeak.toFixed(2)
                      : Math.round(displayPeak)}
                  </span>

                  <div
                    className="w-full flex items-end"
                    style={{ height: "56px" }}
                  >
                    <div
                      className="w-full rounded-t-sm"
                      style={{
                        height:     `${barH}%`,
                        background: colour,
                        opacity:    0.85,
                      }}
                    />
                  </div>

                  <span className="text-white/30 text-xs">
                    R{s.repNumber}
                  </span>
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