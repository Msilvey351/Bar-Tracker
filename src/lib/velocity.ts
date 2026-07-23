import type { FrameResult } from "@/types";

export interface VelocityPoint {
  timeSeconds: number;
  velocityMs: number;        // pixels/second (scale-agnostic)
  smoothedVelocityMs: number;
}

/**
 * Compute frame-by-frame velocity from tracked positions.
 * Uses a simple central-difference scheme + running average smoothing.
 */
export function computeVelocity(
  frames: FrameResult[],
  smoothingWindow = 5
): VelocityPoint[] {
  if (frames.length < 2) return [];

  const raw: number[] = frames.map((f, i) => {
    if (i === 0) return 0;
    const prev = frames[i - 1];
    const dt = f.timeSeconds - prev.timeSeconds;
    if (dt === 0) return 0;
    const dx = f.position.x - prev.position.x;
    const dy = f.position.y - prev.position.y;
    return Math.sqrt(dx * dx + dy * dy) / dt;
  });

  const half = Math.floor(smoothingWindow / 2);
  const smoothed = raw.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(raw.length - 1, i + half);
    const slice = raw.slice(lo, hi + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  return frames.map((f, i) => ({
    timeSeconds: f.timeSeconds,
    velocityMs: raw[i],
    smoothedVelocityMs: smoothed[i],
  }));
}