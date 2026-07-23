import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Heavy smoothing — must be wide enough to kill noise but keep rep shape */
const SMOOTH_WINDOW = 15;

/** Narrower window for direction signal only */
const DIR_SMOOTH_WINDOW = 21;

/** A frame is "moving" if its speed exceeds this fraction of global peak.
 *  Keeps still frames (between sets) as rest. */
const MOVING_FRACTION = 0.08;

/** When scanning for direction reversals, ignore transitions shorter than
 *  this many frames (prevents noise from splitting one rep into two). */
const MIN_PHASE_FRAMES = 10;

/** A rep's peak concentric velocity must be at least this fraction of the
 *  global concentric peak to count as a real rep (filters tracking glitches). */
const MIN_REP_PEAK_FRACTION = 0.15;

/** Minimum total frames (eccentric + concentric combined) for a valid rep */
const MIN_REP_TOTAL_FRAMES = 12;

// ─── Smoothing ────────────────────────────────────────────────────────────────

function boxSmooth(values: number[], window: number): number[] {
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
  const rawVY: number[] = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;
    rawSpeeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
    // Positive dy = bar moving DOWN in image coords
    rawVY.push(dy / dt);
  }

  const smoothedSpeeds = boxSmooth(rawSpeeds, SMOOTH_WINDOW);
  // Use a wider window for direction to avoid jitter at phase transitions
  const smoothedVY = boxSmooth(rawVY, DIR_SMOOTH_WINDOW);

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

// ─── Step 2: Detect concentric direction ─────────────────────────────────────
// Look at which signed-Y direction has the higher mean velocity when bar
// is clearly moving. Works for squat, bench, deadlift automatically.

function getConcentricSign(vFrames: VelocityFrame[], movingThreshold: number): 1 | -1 {
  const moving = vFrames.filter((f) => f.velocitySmoothed > movingThreshold);
  const up   = moving.filter((f) => f.velocityY < 0);
  const down = moving.filter((f) => f.velocityY > 0);
  const meanUp   = up.length   ? up.reduce((s, f) => s + Math.abs(f.velocityY), 0)   / up.length   : 0;
  const meanDown = down.length ? down.reduce((s, f) => s + Math.abs(f.velocityY), 0) / down.length : 0;
  // concentricSign = -1 → bar going UP = concentric (squat/bench)
  // concentricSign = +1 → bar going DOWN = concentric (rare)
  return meanUp >= meanDown ? -1 : 1;
}

// ─── Step 3: Label phases by direction reversal ───────────────────────────────
//
// KEY INSIGHT: instead of using a speed threshold to call something "rest",
// we label every frame as either concentric or eccentric based purely on the
// sign of smoothedVY. Then we use direction-change events as rep boundaries.
// Rest is only assigned to frames where the bar is genuinely still
// (e.g. before/after the set).

export function detectPhases(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  const globalPeak      = Math.max(...result.map((f) => f.velocitySmoothed), 1);
  const movingThreshold = globalPeak * MOVING_FRACTION;
  const concentricSign  = getConcentricSign(result, movingThreshold);

  // Label every frame
  for (const f of result) {
    if (f.velocitySmoothed < movingThreshold) {
      f.phase = "rest";
      continue;
    }
    // concentricSign * velocityY < 0  → moving in concentric direction
    f.phase = concentricSign * f.velocityY < 0 ? "concentric" : "eccentric";
  }

  // ── Merge short glitch segments into neighbours ───────────────────────────
  // Walk runs; if a non-rest run is shorter than MIN_PHASE_FRAMES,
  // absorb it into the surrounding phase (whichever is longer neighbour).
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < result.length) {
      const phase = result[i].phase;
      let j = i;
      while (j < result.length && result[j].phase === phase) j++;
      const len = j - i;

      if (phase !== "rest" && len < MIN_PHASE_FRAMES) {
        // Find the dominant neighbour phase
        const prevPhase = i > 0 ? result[i - 1].phase : "rest";
        const nextPhase = j < result.length ? result[j].phase : "rest";
        const fill = prevPhase !== "rest" ? prevPhase
                   : nextPhase !== "rest" ? nextPhase
                   : "rest";
        for (let k = i; k < j; k++) result[k].phase = fill;
        changed = true;
      }
      i = j;
    }
  }

  return result;
}

// ─── Step 4: Segment reps by direction reversal ───────────────────────────────
//
// A rep boundary is a transition from eccentric → concentric (bottom of lift)
// or concentric → eccentric (top of lift / start of next rep).
//
// Strategy:
//   1. Build a run-length encoded list of phase segments
//   2. Find alternating ecc→conc pairs — each pair = one rep
//   3. Assign repIndex to all frames in each pair

export function segmentReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  // Build run-length segments (excluding rest)
  interface Segment {
    phase: Phase;
    start: number;  // frame index into result[]
    end:   number;
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < result.length) {
    const phase = result[i].phase;
    let j = i;
    while (j < result.length && result[j].phase === phase) j++;
    if (phase !== "rest") {
      segments.push({ phase, start: i, end: j });
    }
    i = j;
  }

  // Determine which direction starts a rep
  // If bar starts eccentric (squat/bench): ecc→conc = one rep
  // If bar starts concentric (deadlift):   conc→ecc→conc = one rep
  // We pair up: find all ecc segments, each followed by a conc segment
  // OR find all conc segments if lift starts concentric.

  // Count leading phase to decide convention
  const firstMoving = segments[0]?.phase;

  let repIndex = 0;

  if (firstMoving === "eccentric") {
    // Squat / bench: rep = eccentric + following concentric
    for (let s = 0; s < segments.length - 1; s++) {
      const cur  = segments[s];
      const next = segments[s + 1];
      if (cur.phase === "eccentric" && next.phase === "concentric") {
        // Assign both to this rep
        for (let k = cur.start; k < cur.end; k++)   result[k].repIndex = repIndex;
        for (let k = next.start; k < next.end; k++) result[k].repIndex = repIndex;
        repIndex++;
        s++; // skip next since we consumed it
      }
    }
  } else {
    // Deadlift / starts concentric: rep = concentric + following eccentric
    for (let s = 0; s < segments.length - 1; s++) {
      const cur  = segments[s];
      const next = segments[s + 1];
      if (cur.phase === "concentric" && next.phase === "eccentric") {
        for (let k = cur.start; k < cur.end; k++)   result[k].repIndex = repIndex;
        for (let k = next.start; k < next.end; k++) result[k].repIndex = repIndex;
        repIndex++;
        s++;
      }
    }
    // Also catch any trailing concentric without an eccentric (last rep of deadlift)
    const last = segments[segments.length - 1];
    if (last?.phase === "concentric" && result[last.start].repIndex === null) {
      for (let k = last.start; k < last.end; k++) result[k].repIndex = repIndex;
    }
  }

  return result;
}

// ─── Step 5: Filter fake reps ─────────────────────────────────────────────────

function filterFakeReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  const allRepIndices = [
    ...new Set(result.map((f) => f.repIndex).filter((r): r is number => r !== null)),
  ].sort((a, b) => a - b);

  const globalPeak  = Math.max(...result.map((f) => f.velocitySmoothed), 1);
  const minRepPeak  = globalPeak * MIN_REP_PEAK_FRACTION;

  const validReps = new Set<number>();

  for (const idx of allRepIndices) {
    const repFrames  = result.filter((f) => f.repIndex === idx);
    const concFrames = repFrames.filter((f) => f.phase === "concentric");
    const peakConc   = concFrames.length
      ? Math.max(...concFrames.map((f) => f.velocitySmoothed))
      : 0;

    if (
      repFrames.length  >= MIN_REP_TOTAL_FRAMES &&
      concFrames.length >  0 &&
      peakConc          >= minRepPeak
    ) {
      validReps.add(idx);
    }
  }

  // Renumber sequentially
  const sorted   = [...validReps].sort((a, b) => a - b);
  const remap    = new Map(sorted.map((old, i) => [old, i]));

  for (const f of result) {
    if (f.repIndex === null || !validReps.has(f.repIndex)) {
      f.repIndex = null;
      if (f.phase !== "rest") f.phase = "rest";
    } else {
      f.repIndex = remap.get(f.repIndex) ?? null;
    }
  }

  return result;
}

// ─── Step 6: Per-rep statistics ───────────────────────────────────────────────

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
    arr.length > 1
      ? arr[arr.length - 1].timeSeconds - arr[0].timeSeconds
      : 0;

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

  // % drop relative to rep 1
  const rep1Peak = stats[0]?.peakConcentricVelocity ?? 1;
  for (const s of stats) {
    s.percentSpeedDrop =
      rep1Peak > 0 ? ((rep1Peak - s.peakConcentricVelocity) / rep1Peak) * 100 : 0;
  }

  return stats;
}

// ─── Master export ────────────────────────────────────────────────────────────

export function analyseReps(
  frames: FrameResult[],
  fps: number
): { vFrames: VelocityFrame[]; repStats: RepStats[] } {
  const withVelocity = buildVelocityFrames(frames, fps);
  const withPhases   = detectPhases(withVelocity);
  const withReps     = segmentReps(withPhases);
  const filtered     = filterFakeReps(withReps);
  const repStats     = computeRepStats(filtered);
  return { vFrames: filtered, repStats };
}