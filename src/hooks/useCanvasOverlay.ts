"use client";

import { useCallback, useRef } from "react";
import type { AnalysisResult, VelocityFrame } from "@/types";

const COLOURS = {
  concentric: "#f97316", // orange
  eccentric: "#3b82f6",  // blue
  rest: "#6b7280",       // grey
  dot: "#ffffff",        // white centre dot
} as const;

function findClosestVFrame(
  vFrames: VelocityFrame[],
  timeSeconds: number
): VelocityFrame | null {
  if (!vFrames.length) return null;
  let closest = vFrames[0];
  let minDiff = Infinity;
  for (const f of vFrames) {
    const diff = Math.abs(f.timeSeconds - timeSeconds);
    if (diff < minDiff) {
      minDiff = diff;
      closest = f;
    }
  }
  return closest;
}

function phaseColour(vFrames: VelocityFrame[], timeSeconds: number): string {
  const f = findClosestVFrame(vFrames, timeSeconds);
  if (!f || f.repIndex === null) return COLOURS.rest;
  return f.phase === "concentric"
    ? COLOURS.concentric
    : f.phase === "eccentric"
    ? COLOURS.eccentric
    : COLOURS.rest;
}

export function useCanvasOverlay(
  result: AnalysisResult,
  vFrames: VelocityFrame[] = []
) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement, currentTime: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Ensure the canvas resolution matches its CSS size
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (result.frames.length < 2) return;

      /**
       * Calculate exactly where the video is displayed inside the canvas.
       * This handles pillarboxing (black bars on sides) and letterboxing (black bars top/bottom).
       */
      const containerAspect = canvas.width / canvas.height;
      const videoAspect = result.videoWidth / result.videoHeight;

      let displayedW = canvas.width;
      let displayedH = canvas.height;
      let offsetX = 0;
      let offsetY = 0;

      if (videoAspect > containerAspect) {
        // Video is limited by container width (letterboxed)
        displayedH = canvas.width / videoAspect;
        offsetY = (canvas.height - displayedH) / 2;
      } else {
        // Video is limited by container height (pillarboxed)
        displayedW = canvas.height * videoAspect;
        offsetX = (canvas.width - displayedW) / 2;
      }

      const scaleX = displayedW / result.videoWidth;
      const scaleY = displayedH / result.videoHeight;

      // ── Full bar path — draw as coloured segments ─────────────────────────
      for (let i = 1; i < result.frames.length; i++) {
        const prev = result.frames[i - 1];
        const curr = result.frames[i];

        const colour = phaseColour(vFrames, curr.timeSeconds);

        ctx.beginPath();
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.moveTo(prev.position.x * scaleX + offsetX, prev.position.y * scaleY + offsetY);
        ctx.lineTo(curr.position.x * scaleX + offsetX, curr.position.y * scaleY + offsetY);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // ── Traced path up to current time — brighter ─────────────────────────
      const pastFrames = result.frames.filter(
        (f) => f.timeSeconds <= currentTime + 0.001
      );

      if (pastFrames.length > 1) {
        for (let i = 1; i < pastFrames.length; i++) {
          const prev = pastFrames[i - 1];
          const curr = pastFrames[i];
          const colour = phaseColour(vFrames, curr.timeSeconds);

          ctx.beginPath();
          ctx.strokeStyle = colour;
          ctx.lineWidth = 3;
          ctx.moveTo(prev.position.x * scaleX + offsetX, prev.position.y * scaleY + offsetY);
          ctx.lineTo(curr.position.x * scaleX + offsetX, curr.position.y * scaleY + offsetY);
          ctx.stroke();
        }
      }

      // ── Current position dot ──────────────────────────────────────────────
      let closest = result.frames[0];
      let minDiff = Infinity;
      for (const f of result.frames) {
        const diff = Math.abs(f.timeSeconds - currentTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = f;
        }
      }

      const cx = closest.position.x * scaleX + offsetX;
      const cy = closest.position.y * scaleY + offsetY;
      const dotColour = phaseColour(vFrames, closest.timeSeconds);

      // Outer coloured ring
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = dotColour;
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