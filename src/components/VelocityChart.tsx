"use client";

import React, { useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import type { VelocityFrame, RepStats, CalibrationPoints } from "@/types";

interface Props {
  vFrames:     VelocityFrame[];
  repStats:    RepStats[];
  calibration: CalibrationPoints | null;
}

const PHASE_COLOUR = {
  concentric: "#f97316",
  eccentric:  "#3b82f6",
  unassigned: "#6b7280",
  pause:      "#a855f7",
} as const;

interface ChartPoint {
  time:       string;
  concentric: number | null;
  eccentric:  number | null;
  unassigned: number | null;
  phase:      string;
  repIndex:   number | null;
}

export default function VelocityChart({
  vFrames,
  repStats,
  calibration,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  // ── Unit helpers ────────────────────────────────────────────────────────────
  const isCalib = calibration !== null;
  const unit    = isCalib ? "m/s" : "px/s";

  const toDisplay = (pxPerS: number): number => {
    if (!isCalib) return Math.round(pxPerS);
    return Math.round((pxPerS / calibration!.pxPerM) * 1000) / 1000;
  };

  // ── Build chart data ────────────────────────────────────────────────────────
  const data: ChartPoint[] = vFrames.map((f) => {
    const speed  = toDisplay(f.velocitySmoothed);
    const isDown = f.velocityY > 0;

    const signed = speed < 0.001 ? 0 : isDown ? -speed : speed;
    const hasRep = f.repIndex !== null;

    return {
      time:       f.timeSeconds.toFixed(2),
      concentric: hasRep && f.phase === "concentric" ?  signed : null,
      eccentric:  hasRep && f.phase === "eccentric"  ?  signed : null,
      unassigned: !hasRep && Math.abs(signed) > 0    ?  signed : null,
      phase:      f.phase,
      repIndex:   f.repIndex,
    };
  });

  const repBoundaries = repStats.map((s) => {
    const firstFrame = vFrames.find(
      (f) => f.repIndex === s.repNumber - 1 && f.phase !== "rest"
    );
    return {
      repNumber: s.repNumber,
      time:      firstFrame?.timeSeconds.toFixed(2) ?? "0",
    };
  });

  const pauseZones = repStats
    .filter((s) => s.pauseDuration >= 0.2 && s.pauseStartTime !== null)
    .map((s) => ({
      repNumber: s.repNumber,
      x1:        s.pauseStartTime!.toFixed(2),
      x2:        (s.pauseStartTime! + s.pauseDuration).toFixed(2),
      label:     `${s.pauseDuration.toFixed(2)}s`,
    }));

  const maxV    = Math.max(...vFrames.map((f) => toDisplay(f.velocitySmoothed)), 1);
  const axisMax = isCalib
    ? Math.ceil(maxV * 1.2 * 100) / 100
    : Math.ceil(maxV * 1.2);

  const tickFmt = (v: number) => {
    const abs = Math.abs(v);
    const str = isCalib ? abs.toFixed(2) : String(abs);
    return v > 0 ? `+${str}` : v < 0 ? `−${str}` : "0";
  };

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

    const phaseLabel =
      repIdx !== null
        ? `${phase} · Rep ${repIdx + 1}`
        : phase === "rest"
        ? "rest"
        : "not counted";

    const labelFloat = parseFloat(label ?? "0");
    const inPause = pauseZones.some(
      (z) =>
        labelFloat >= parseFloat(z.x1) &&
        labelFloat <= parseFloat(z.x2)
    );

    return (
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
        <p className="text-white/40 mb-1">{label}s</p>

        {inPause && (
          <p className="text-purple-400 font-semibold mb-0.5">⏸ Pause</p>
        )}

        <p
          className="font-bold capitalize mb-0.5"
          style={{ color: inPause ? PHASE_COLOUR.pause : colour }}
        >
          {phaseLabel}
        </p>

        <p className="text-white font-mono">
          {sign}{isCalib ? val.toFixed(3) : Math.round(val)} {unit}
        </p>
      </div>
    );
  };

  // ── Image Export Handler ────────────────────────────────────────────────────
  const exportChart = async () => {
    if (!chartRef.current) return;
    setIsExporting(true);

    try {
      // 1. Unhide the watermark footer right before capture
      const watermark = chartRef.current.querySelector("#watermark-footer") as HTMLElement;
      if (watermark) watermark.style.display = "flex";

      // 2. Give the browser a split second to apply the display change
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 3. Capture the element
      const dataUrl = await htmlToImage.toPng(chartRef.current, {
        quality: 1.0,
        pixelRatio: 2, // High resolution for Retina displays/phones
        backgroundColor: "#09090b", // Solid dark background so it's not transparent
        style: {
          padding: "24px",
          margin: "0",
          borderRadius: "16px",
        },
      });

      // 4. Hide the watermark footer again
      if (watermark) watermark.style.display = "none";

      // 5. Trigger download
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      link.download = `velocity_chart_${dateStr}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to export chart:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      
      {/* EXPORT BUTTON */}
      <div className="flex justify-end">
        <button
          onClick={exportChart}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg border border-zinc-700 transition-colors"
        >
          <span>📸</span> {isExporting ? "Saving..." : "Download Image"}
        </button>
      </div>

      {/* CHART CONTAINER (The div that gets converted to PNG) */}
      <div 
        ref={chartRef} 
        className="bg-zinc-900 border border-white/10 rounded-xl p-6 flex flex-col gap-6"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-white/80">Velocity Trace</h3>
            <p className="text-white/30 text-xs mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <span style={{ color: PHASE_COLOUR.concentric }}>■</span>{" "}
                Concentric
              </span>
              <span>
                <span style={{ color: PHASE_COLOUR.eccentric }}>■</span>{" "}
                Eccentric
              </span>
              <span>
                <span style={{ color: PHASE_COLOUR.unassigned }}>■</span>{" "}
                Not counted
              </span>
              {pauseZones.length > 0 && (
                <span>
                  <span style={{ color: PHASE_COLOUR.pause }}>■</span>{" "}
                  Pause
                </span>
              )}
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

            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />

            {pauseZones.map((z) => (
              <ReferenceArea
                key={`pause-${z.repNumber}`}
                x1={z.x1}
                x2={z.x2}
                fill="rgba(168, 85, 247, 0.12)"
                stroke="rgba(168, 85, 247, 0.35)"
                strokeWidth={1}
                label={{
                  value:    `⏸ ${z.label}`,
                  position: "insideTop",
                  fill:     "rgba(168, 85, 247, 0.8)",
                  fontSize: 10,
                }}
              />
            ))}

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
            <Line
              type="monotone"
              dataKey="concentric"
              stroke={PHASE_COLOUR.concentric}
              dot={false}
              strokeWidth={3}
              connectNulls={false}
              name="Concentric"
            />
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
                  <div key={s.repNumber} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-xs font-mono tabular-nums" style={{ color: colour }}>
                      {isCalib ? displayPeak.toFixed(2) : Math.round(displayPeak)}
                    </span>
                    <div className="w-full flex items-end" style={{ height: "56px" }}>
                      <div
                        className="w-full rounded-t-sm relative"
                        style={{ height: `${barH}%`, background: colour, opacity: 0.85 }}
                      >
                        {s.pauseDuration >= 0.2 && (
                          <div className="absolute -top-4 left-0 right-0 flex justify-center">
                            <span className="text-purple-400 text-xs">⏸</span>
                          </div>
                        )}
                      </div>
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

        {/* THE WATERMARK (Hidden in UI, Revealed on Export) */}
        <div id="watermark-footer" style={{ display: "none" }} className="pt-6 mt-2 border-t border-white/5 justify-between items-end">
          <div className="flex flex-col">
             <span className="text-white/30 text-[10px] uppercase tracking-widest font-semibold">Tracked using</span>
             <span className="text-white/80 text-xl font-black italic tracking-widest">VELOCITY</span>
          </div>
          <span className="text-white/20 text-xs font-mono">
            {new Date().toLocaleDateString()}
          </span>
        </div>

      </div>
    </div>
  );
}