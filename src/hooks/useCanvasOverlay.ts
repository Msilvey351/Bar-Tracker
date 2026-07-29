"use client";

import { useCallback } from "react";
import type { AnalysisResult, VelocityFrame } from "@/types";

const COLOURS = {
  concentric: "#f97316",  // orange
  eccentric:  "#3b82f6",  // blue
  rest:       "#6b7280",  // grey
  dot:        "#ffffff",  // white centre dot
} as const;

/** Find the VelocityFrame closest to a given time */
function findClosestVFrame(
  vFrames: VelocityFrame[],
  timeSeconds: number
): VelocityFrame | null {
  if (!vFrames.length) return null;
  let closest = vFrames[0];
  let minDiff = Infinity;
  for (const f of vFrames) {
    const diff = Math.abs(f.timeSeconds - timeSeconds);
    if (diff < minDiff) { minDiff = diff; closest = f; }
  }
  return closest;
}

/** Phase colour for a given time */
function phaseColour(vFrames: VelocityFrame[], timeSeconds: number): string {
  const f = findClosestVFrame(vFrames, timeSeconds);
  if (!f || f.repIndex === null) return COLOURS.rest;
  return f.phase === "concentric" ? COLOURS.concentric
       : f.phase === "eccentric"  ? COLOURS.eccentric
       : COLOURS.rest;
}

export function useCanvasOverlay(
  result:  AnalysisResult,
  vFrames: VelocityFrame[] = []
) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement, currentTime: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const scaleX = canvas.width  / result.videoWidth;
      const scaleY = canvas.height / result.videoHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (result.frames.length < 2) return;

      // ── Full bar path — draw as coloured segments ─────────────────────────
      for (let i = 1; i < result.frames.length; i++) {
        const prev = result.frames[i - 1];
        const curr = result.frames[i];

        const colour = phaseColour(vFrames, curr.timeSeconds);

        ctx.beginPath();
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth   = 2;
        ctx.moveTo(prev.position.x * scaleX, prev.position.y * scaleY);
        ctx.lineTo(curr.position.x * scaleX, curr.position.y * scaleY);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // ── Traced path up to current time — brighter ─────────────────────────
      const pastFrames = result.frames.filter(
        (f) => f.timeSeconds <= currentTime + 0.001
      );

      if (pastFrames.length > 1) {
        for (let i = 1; i < pastFrames.length; i++) {
          const prev   = pastFrames[i - 1];
          const curr   = pastFrames[i];
          const colour = phaseColour(vFrames, curr.timeSeconds);

          ctx.beginPath();
          ctx.strokeStyle = colour;
          ctx.lineWidth   = 3;
          ctx.moveTo(prev.position.x * scaleX, prev.position.y * scaleY);
          ctx.lineTo(curr.position.x * scaleX, curr.position.y * scaleY);
          ctx.stroke();
        }
      }

      // ── Current position dot ──────────────────────────────────────────────
      let closest = result.frames[0];
      let minDiff = Infinity;
      for (const f of result.frames) {
        const diff = Math.abs(f.timeSeconds - currentTime);
        if (diff < minDiff) { minDiff = diff; closest = f; }
      }

      const cx = closest.position.x * scaleX;
      const cy = closest.position.y * scaleY;
      const dotColour = phaseColour(vFrames, closest.timeSeconds);

      // Outer coloured ring
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle   = dotColour;
      ctx.fill();

      // White centre
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = COLOURS.dot;
      ctx.fill();
    },
    [result, vFrames]
  );

  return { draw };
}