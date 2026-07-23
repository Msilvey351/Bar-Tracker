import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** Smoothing window (frames) for velocity */
const SMOOTH_WINDOW = 7;

/** Minimum smoothed speed (px/s) to be considered "moving" not "rest" */
const MOVEMENT_THRESHOLD = 8;

/** Minimum speed as fraction of that rep's peak to count as active phase */
const PHASE_FRACTION = 0.15;

/** Minimum number of frames to count as a valid phase (avoids glitches) */
const MIN_PHASE_FRAMES = 4;

/** Minimum frames of rest between reps */
const MIN_REST_FRAMES = 6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gaussianSmooth(values: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2);
  // Simple box smooth (good enough, fast)
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    const slice = values.slice(lo, hi + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function magnitude(dx: number, dy: number) {
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Step 1: Build VelocityFrame array ───────────────────────────────────────

export function buildVelocityFrames(frames: FrameResult[], fps: number): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt = 1 / fps;

  // Raw speed + signed Y velocity
  const rawSpeeds: number[] = [0];
  const rawVY: number[] = [0];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const dx = curr.position.x - prev.position.x;
    const dy = curr.position.y - prev.position.y;
    rawSpeeds.push(magnitude(dx, dy) / dt);
    // dy positive = bar moved DOWN in image coords (eccentric for squat/bench)
    rawVY.push(dy / dt);
  }

  const smoothedSpeeds = gaussianSmooth(rawSpeeds, SMOOTH_WINDOW);
  const smoothedVY = gaussianSmooth(rawVY, SMOOTH_WINDOW);

  return frames.map((f, i) => ({
    frameIndex: f.frameIndex,
    timeSeconds: f.timeSeconds,
    position: f.position,
    velocityRaw: rawSpeeds[i],
    velocitySmoothed: smoothedSpeeds[i],
    velocityY: smoothedVY[i],
    phase: "rest" as Phase,
    repIndex: null,
  }));
}

// ─── Step 2: Detect phases ────────────────────────────────────────────────────
//
// Convention (camera-fixed, bar tracked in image px):
//   velocityY > 0  → bar moving DOWN  → eccentric (squat descent / bench lower)
//   velocityY < 0  → bar moving UP    → concentric (squat rise / bench press)
//
// We auto-detect which direction is concentric by looking at which direction
// has the higher peak velocity across the whole set.

export function detectPhases(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  // Determine concentric direction: whichever signed-Y direction has higher
  // mean absolute velocity when above threshold
  const upFrames   = result.filter(f => f.velocityY < -MOVEMENT_THRESHOLD);
  const downFrames = result.filter(f => f.velocityY >  MOVEMENT_THRESHOLD);

  const meanUp   = upFrames.length   ? upFrames.reduce((s, f)   => s + Math.abs(f.velocityY), 0) / upFrames.length   : 0;
  const meanDown = downFrames.length ? downFrames.reduce((s, f) => s + Math.abs(f.velocityY), 0) / downFrames.length : 0;

  // concentricSign: -1 = bar goes UP for concentric (squat/bench), +1 = bar goes DOWN (not typical)
  const concentricSign = meanUp >= meanDown ? -1 : 1;

  for (const f of result) {
    if (f.velocitySmoothed < MOVEMENT_THRESHOLD) {
      f.phase = "rest";
      continue;
    }
    const isConc = concentricSign * f.velocityY < 0; // moving in concentric direction
    f.phase = isConc ? "concentric" : "eccentric";
  }

  // Clean up tiny blips — any phase segment shorter than MIN_PHASE_FRAMES
  // gets merged into neighbours
  let i = 0;
  while (i < result.length) {
    const startPhase = result[i].phase;
    let j = i;
    while (j < result.length && result[j].phase === startPhase) j++;
    const len = j - i;
    if (len < MIN_PHASE_FRAMES && startPhase !== "rest") {
      for (let k = i; k < j; k++) result[k].phase = "rest";
    }
    i = j;
  }

  return result;
}

// ─── Step 3: Segment into reps ────────────────────────────────────────────────
//
// A rep = one eccentric phase followed by one concentric phase (or vice-versa
// for a deadlift). We use the simpler heuristic: every time we see a
// concentric burst separated by rest, that's a new rep.

export function segmentReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));
  let repIndex = 0;
  let inRep = false;
  let restCount = 0;

  for (let i = 0; i < result.length; i++) {
    const f = result[i];
    if (f.phase === "rest") {
      restCount++;
      if (inRep && restCount >= MIN_REST_FRAMES) {
        inRep = false;
        repIndex++;
      }
      f.repIndex = null;
    } else {
      restCount = 0;
      if (!inRep) inRep = true;
      f.repIndex = repIndex;
    }
  }

  return result;
}

// ─── Step 4: Compute per-rep statistics ───────────────────────────────────────

export function computeRepStats(vFrames: VelocityFrame[]): RepStats[] {
  // Group frames by repIndex
  const repMap = new Map<number, VelocityFrame[]>();
  for (const f of vFrames) {
    if (f.repIndex === null) continue;
    if (!repMap.has(f.repIndex)) repMap.set(f.repIndex, []);
    repMap.get(f.repIndex)!.push(f);
  }

  const stats: RepStats[] = [];

  repMap.forEach((frames, repIdx) => {
    const concFrames = frames.filter(f => f.phase === "concentric");
    const eccFrames  = frames.filter(f => f.phase === "eccentric");

    const avg = (arr: VelocityFrame[]) =>
      arr.length ? arr.reduce((s, f) => s + f.velocitySmoothed, 0) / arr.length : 0;

    const peak = (arr: VelocityFrame[]) =>
      arr.length ? Math.max(...arr.map(f => f.velocitySmoothed)) : 0;

    const dur = (arr: VelocityFrame[]) =>
      arr.length > 1 ? arr[arr.length - 1].timeSeconds - arr[0].timeSeconds : 0;

    stats.push({
      repNumber: repIdx + 1,
      avgConcentricVelocity: avg(concFrames),
      avgEccentricVelocity:  avg(eccFrames),
      peakConcentricVelocity: peak(concFrames),
      concentricDuration: dur(concFrames),
      eccentricDuration:  dur(eccFrames),
      percentSpeedDrop: 0, // filled in below
    });
  });

  // Sort by rep number
  stats.sort((a, b) => a.repNumber - b.repNumber);

  // Calculate % speed drop relative to rep 1 peak concentric
  const rep1Peak = stats[0]?.peakConcentricVelocity ?? 1;
  for (const s of stats) {
    s.percentSpeedDrop = rep1Peak > 0
      ? ((rep1Peak - s.peakConcentricVelocity) / rep1Peak) * 100
      : 0;
  }

  return stats;
}

// ─── Master function ──────────────────────────────────────────────────────────

export function analyseReps(frames: FrameResult[], fps: number): {
  vFrames: VelocityFrame[];
  repStats: RepStats[];
} {
  const withVelocity = buildVelocityFrames(frames, fps);
  const withPhases   = detectPhases(withVelocity);
  const withReps     = segmentReps(withPhases);
  const repStats     = computeRepStats(withReps);
  return { vFrames: withReps, repStats };
}