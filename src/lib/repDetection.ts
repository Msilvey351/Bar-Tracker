import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** Smoothing window in frames — wider = less noise */
const SMOOTH_WINDOW = 11;

/** A frame must exceed this fraction of the global peak speed
 *  to be considered "moving" at all. Filters out drift/tremor. */
const MOVEMENT_THRESHOLD_FRACTION = 0.12;

/** A concentric phase must have peak velocity above this fraction
 *  of the global peak to count as a real rep (not a glitch) */
const MIN_REP_PEAK_FRACTION = 0.20;

/** Minimum frames in a phase to be considered real (not a glitch) */
const MIN_PHASE_FRAMES = 6;

/** Minimum frames of near-zero velocity to count as inter-rep rest */
const MIN_REST_FRAMES = 8;

/** Minimum frames a full rep (ecc + conc combined) must span */
const MIN_REP_FRAMES = 10;

// ─── Smoothing ────────────────────────────────────────────────────────────────

function smooth(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    const slice = values.slice(lo, hi + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ─── Step 1: Build velocity frames ───────────────────────────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps: number
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt = 1 / fps;
  const rawSpeeds: number[] = [0];
  const rawVY: number[]     = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;
    rawSpeeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
    rawVY.push(dy / dt);
  }

  const smoothedSpeeds = smooth(rawSpeeds, SMOOTH_WINDOW);
  const smoothedVY     = smooth(rawVY, SMOOTH_WINDOW);

  return frames.map((f, i) => ({
    frameIndex:       f.frameIndex,
    timeSeconds:      f.timeSeconds,
    position:         f.position,
    velocityRaw:      rawSpeeds[i],
    velocitySmoothed: smoothedSpeeds[i],
    velocityY:        smoothedVY[i],
    phase:            "rest" as Phase,
    repIndex:         null,
  }));
}

// ─── Step 2: Detect phases ────────────────────────────────────────────────────

export function detectPhases(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  // Global peak speed — used to set adaptive threshold
  const globalPeak = Math.max(...result.map((f) => f.velocitySmoothed), 1);
  const movementThreshold = globalPeak * MOVEMENT_THRESHOLD_FRACTION;

  // Determine concentric direction from frames that are clearly moving
  const movingFrames = result.filter((f) => f.velocitySmoothed > movementThreshold);
  const upFrames     = movingFrames.filter((f) => f.velocityY < 0);
  const downFrames   = movingFrames.filter((f) => f.velocityY > 0);

  const meanUp   = upFrames.length
    ? upFrames.reduce((s, f) => s + Math.abs(f.velocityY), 0) / upFrames.length
    : 0;
  const meanDown = downFrames.length
    ? downFrames.reduce((s, f) => s + Math.abs(f.velocityY), 0) / downFrames.length
    : 0;

  // concentricSign: -1 = upward in image = concentric (squat/bench)
  //                 +1 = downward in image = concentric (unusual)
  const concentricSign = meanUp >= meanDown ? -1 : 1;

  // Label each frame
  for (const f of result) {
    if (f.velocitySmoothed < movementThreshold) {
      f.phase = "rest";
      continue;
    }
    f.phase = concentricSign * f.velocityY < 0 ? "concentric" : "eccentric";
  }

  // ── Pass 2: Remove short glitch segments ─────────────────────────────────
  // Walk through runs of the same phase; if a run is shorter than
  // MIN_PHASE_FRAMES, reset it to "rest"
  let i = 0;
  while (i < result.length) {
    const startPhase = result[i].phase;
    let j = i;
    while (j < result.length && result[j].phase === startPhase) j++;
    if (startPhase !== "rest" && j - i < MIN_PHASE_FRAMES) {
      for (let k = i; k < j; k++) result[k].phase = "rest";
    }
    i = j;
  }

  return result;
}

// ─── Step 3: Segment reps ─────────────────────────────────────────────────────
// A rep boundary occurs when we see MIN_REST_FRAMES consecutive rest frames
// after at least one non-rest frame. Each contiguous block of movement = one rep.

export function segmentReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  let repIndex  = 0;
  let inRep     = false;
  let restCount = 0;
  let repFrameCount = 0;

  for (let i = 0; i < result.length; i++) {
    const f = result[i];

    if (f.phase === "rest") {
      restCount++;
      repFrameCount = 0;

      if (inRep && restCount >= MIN_REST_FRAMES) {
        inRep = false;
        repIndex++;
      }
      f.repIndex = null;
    } else {
      restCount = 0;
      repFrameCount++;

      if (!inRep) inRep = true;
      f.repIndex = repIndex;
    }
  }

  return result;
}

// ─── Step 4: Filter fake reps ─────────────────────────────────────────────────
// After segmentation, remove rep indices that don't look like real reps:
//   • too few total frames
//   • peak concentric velocity too low vs global peak
//   • no concentric frames at all

function filterFakeReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  // Gather all rep indices
  const repIndices = new Set(
    result.map((f) => f.repIndex).filter((r): r is number => r !== null)
  );

  const globalPeak = Math.max(...result.map((f) => f.velocitySmoothed), 1);
  const minRepPeak = globalPeak * MIN_REP_PEAK_FRACTION;

  const validReps = new Set<number>();

  for (const idx of repIndices) {
    const repFrames = result.filter((f) => f.repIndex === idx);
    const concFrames = repFrames.filter((f) => f.phase === "concentric");
    const peakConc   = concFrames.length
      ? Math.max(...concFrames.map((f) => f.velocitySmoothed))
      : 0;

    const isLongEnough  = repFrames.length >= MIN_REP_FRAMES;
    const hasConc       = concFrames.length > 0;
    const peakHighEnough = peakConc >= minRepPeak;

    if (isLongEnough && hasConc && peakHighEnough) {
      validReps.add(idx);
    }
  }

  // Zero out invalid reps and renumber valid ones
  const sortedValid = [...validReps].sort((a, b) => a - b);
  const remapIdx    = new Map(sortedValid.map((old, i) => [old, i]));

  for (const f of result) {
    if (f.repIndex === null || !validReps.has(f.repIndex)) {
      f.repIndex = null;
      f.phase    = "rest";
    } else {
      f.repIndex = remapIdx.get(f.repIndex) ?? null;
    }
  }

  return result;
}

// ─── Step 5: Compute per-rep stats ───────────────────────────────────────────

export function computeRepStats(vFrames: VelocityFrame[]): RepStats[] {
  const repMap = new Map<number, VelocityFrame[]>();
  for (const f of vFrames) {
    if (f.repIndex === null) continue;
    if (!repMap.has(f.repIndex)) repMap.set(f.repIndex, []);
    repMap.get(f.repIndex)!.push(f);
  }

  const avg  = (arr: VelocityFrame[]) =>
    arr.length ? arr.reduce((s, f) => s + f.velocitySmoothed, 0) / arr.length : 0;
  const peak = (arr: VelocityFrame[]) =>
    arr.length ? Math.max(...arr.map((f) => f.velocitySmoothed)) : 0;
  const dur  = (arr: VelocityFrame[]) =>
    arr.length > 1 ? arr[arr.length - 1].timeSeconds - arr[0].timeSeconds : 0;

  const stats: RepStats[] = [];

  repMap.forEach((frames, repIdx) => {
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames  = frames.filter((f) => f.phase === "eccentric");

    stats.push({
      repNumber:              repIdx + 1,
      avgConcentricVelocity:  avg(concFrames),
      avgEccentricVelocity:   avg(eccFrames),
      peakConcentricVelocity: peak(concFrames),
      concentricDuration:     dur(concFrames),
      eccentricDuration:      dur(eccFrames),
      percentSpeedDrop:       0,
    });
  });

  stats.sort((a, b) => a.repNumber - b.repNumber);

  // % speed drop vs rep 1
  const rep1Peak = stats[0]?.peakConcentricVelocity ?? 1;
  for (const s of stats) {
    s.percentSpeedDrop =
      rep1Peak > 0
        ? ((rep1Peak - s.peakConcentricVelocity) / rep1Peak) * 100
        : 0;
  }

  return stats;
}

// ─── Master function ──────────────────────────────────────────────────────────

export function analyseReps(
  frames: FrameResult[],
  fps: number
): { vFrames: VelocityFrame[]; repStats: RepStats[] } {
  const withVelocity = buildVelocityFrames(frames, fps);
  const withPhases   = detectPhases(withVelocity);
  const withReps     = segmentReps(withPhases);
  const filtered     = filterFakeReps(withReps);   // ← new step
  const repStats     = computeRepStats(filtered);
  return { vFrames: filtered, repStats };
}