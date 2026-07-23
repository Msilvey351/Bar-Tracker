"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { AnalysisResult } from "@/types";
import { computeVelocity } from "@/lib/velocity";

interface Props { result: AnalysisResult; }

export default function VelocityChart({ result }: Props) {
  const data = computeVelocity(result.frames, 7).map((v) => ({
    time: v.timeSeconds.toFixed(2),
    velocity: Math.round(v.velocityMs),
    smoothed: Math.round(v.smoothedVelocityMs),
  }));

  const maxV = Math.max(...data.map((d) => d.smoothed), 1);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <h3 className="font-bold text-white/80 mb-1">Barbell Velocity</h3>
      <p className="text-white/30 text-xs mb-6">pixels/second · smoothed over 7 frames</p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="time"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            label={{ value: "Time (s)", position: "insideBottom", offset: -2, fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11 }}
            domain={[0, Math.ceil(maxV * 1.2)]}
          />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
            labelStyle={{ color: "rgba(255,255,255,0.5)" }}
            itemStyle={{ color: "#f97316" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="velocity" stroke="rgba(249,115,22,0.3)" dot={false} name="Raw" strokeWidth={1} />
          <Line type="monotone" dataKey="smoothed" stroke="#f97316" dot={false} name="Smoothed" strokeWidth={2.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}