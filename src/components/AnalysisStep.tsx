"use client";

import { useMemo } from "react";
import type { FrameResult } from "@/types";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { buildVelocityFrames } from "@/lib/repDetection";

interface Props {
  progress:    number;
  error:       string | null;
  liveFrames:  FrameResult[];
  liveFps:     number;
}

interface ChartPoint {
  time:       string;
  concentric: number | null;
  eccentric:  number | null;
}

const MIN_FRAMES_TO_SHOW_CHART = 10;

export default function AnalysisStep({
  progress,
  error,
  liveFrames,
  liveFps,
}: Props) {

  /**
   * Build a live velocity chart from partial tracked frames.
   * We run buildVelocityFrames (cheap — just smoothing + diffs)
   * but skip the expensive rep detection until analysis is complete.
   */
  const chartData = useMemo((): ChartPoint[] => {
    if (liveFrames.length < MIN_FRAMES_TO_SHOW_CHART || liveFps === 0) {
      return [];
    }

    const vFrames = buildVelocityFrames(liveFrames, liveFps);

    return vFrames.map((f) => {
      const speed  = f.velocitySmoothed;
      const isDown = f.velocityY > 0;
      const signed = speed < 1e-6 ? 0 : isDown ? -speed : speed;

      return {
        time:       f.timeSeconds.toFixed(2),
        concentric: signed > 0 ? signed : null,
        eccentric:  signed < 0 ? signed : null,
      };
    });
  }, [liveFrames, liveFps]);

  const maxV = useMemo(() => {
    if (!chartData.length) return 200;
    return Math.max(
      ...chartData.map((d) =>
        Math.max(Math.abs(d.concentric ?? 0), Math.abs(d.eccentric ?? 0))
      ),
      1
    );
  }, [chartData]);

  const showChart = chartData.length >= MIN_FRAMES_TO_SHOW_CHART;

  return (
    <div className="flex flex-col items-center gap-8 py-8">

      {/* Icon + title */}
      <div className="text-center">
        <div className="text-5xl mb-3">
          {error ? "❌" : "🔬"}
        </div>
        <h2 className="text-2xl font-bold">
          {error ? "Analysis Failed" : "Analysing Video"}
        </h2>
        <p className="text-white/40 text-sm mt-1">
          {error
            ? error
            : "Tracking barbell frame-by-frame using optical flow…"}
        </p>
      </div>

      {/* Progress bar */}
      {!error && (
        <div className="w-full max-w-md">
          <div className="flex justify-between text-sm text-white/50 mb-2">
            <span>Progress</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-white/25 text-xs text-center mt-2">
            Processing in your browser — keep this tab open
          </p>
        </div>
      )}

      {/* Live velocity chart */}
      {!error && showChart && (
        <div className="w-full max-w-3xl bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">
              Live Velocity Trace
            </p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              <span className="text-orange-400 text-xs font-mono">
                {liveFrames.length} frames
              </span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={chartData}
              margin={{ top: 4, right: 8, bottom: 12, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.05)"
              />

              <XAxis
                dataKey="time"
                stroke="rgba(255,255,255,0.15)"
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.25)" }}
                label={{
                  value:    "Time (s)",
                  position: "insideBottom",
                  offset:   -6,
                  fill:     "rgba(255,255,255,0.25)",
                  fontSize: 10,
                }}
              />

              <YAxis
                stroke="rgba(255,255,255,0.15)"
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.25)" }}
                domain={[-Math.ceil(maxV * 1.3), Math.ceil(maxV * 1.3)]}
                tickFormatter={(v: number) => {
                  const abs = Math.abs(v);
                  return v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : "0";
                }}
              />

              {/* Zero line */}
              <ReferenceLine
                y={0}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1}
              />

              {/* Concentric — orange */}
              <Line
                type="monotone"
                dataKey="concentric"
                stroke="#f97316"
                dot={false}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* Eccentric — blue */}
              <Line
                type="monotone"
                dataKey="eccentric"
                stroke="#3b82f6"
                dot={false}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
              />

            </ComposedChart>
          </ResponsiveContainer>

          <p className="text-white/20 text-xs text-center mt-1">
            <span style={{ color: "#f97316" }}>■</span> Concentric &nbsp;
            <span style={{ color: "#3b82f6" }}>■</span> Eccentric &nbsp;
            · px/s · updates every {8} frames
          </p>
        </div>
      )}


    </div>
  );
}