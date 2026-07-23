"use client";

import { useCallback, useRef } from "react";
import type { AnalysisResult, Point } from "@/types";

export function useCanvasOverlay(result: AnalysisResult | null) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(
    (canvas: HTMLCanvasElement, currentTime: number) => {
      if (!result) return;
      canvasRef.current = canvas;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const scaleX = canvas.width / result.videoWidth;
      const scaleY = canvas.height / result.videoHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw full bar path (faint)
      if (result.frames.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(249,115,22,0.4)";
        ctx.lineWidth = 2;
        const first = result.frames[0].position;
        ctx.moveTo(first.x * scaleX, first.y * scaleY);
        for (const f of result.frames) {
          ctx.lineTo(f.position.x * scaleX, f.position.y * scaleY);
        }
        ctx.stroke();
      }

      // Find closest frame to currentTime
      let closest = result.frames[0];
      let minDiff = Infinity;
      for (const f of result.frames) {
        const diff = Math.abs(f.timeSeconds - currentTime);
        if (diff < minDiff) { minDiff = diff; closest = f; }
      }

      // Draw traced path up to current time (bright)
      const pastFrames = result.frames.filter(
        (f) => f.timeSeconds <= currentTime + 0.001
      );
      if (pastFrames.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 3;
        ctx.moveTo(pastFrames[0].position.x * scaleX, pastFrames[0].position.y * scaleY);
        for (const f of pastFrames) {
          ctx.lineTo(f.position.x * scaleX, f.position.y * scaleY);
        }
        ctx.stroke();
      }

      // Draw current position dot
      const cx = closest.position.x * scaleX;
      const cy = closest.position.y * scaleY;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // White centre dot
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    },
    [result]
  );

  return { draw };
}