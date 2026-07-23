import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

const SMOOTH_WINDOW     = 15;
const DIR_SMOOTH_WINDOW = 21;

/** Fraction of global peak — below this = rest/noise */
const MOVING_FRACTION = 0.08;

/** Minimum frames in a single phase segment to be kept */
const MIN_PHASE_FRAMES = 8;

/** A rep's peak concentric must be >= this fraction of the MEDIAN rep peak
 *  (not global peak) — trims weak unrack/rerack reps */
const MIN_REP_VS_MEDIAN = 0.45;

/** Minimum total frames for a rep to be valid */
const MIN_REP_TOTAL_FRAMES = 15;

/** Outlier reps at start/end with peak < this fraction of median are trimmed */
const EDGE_TRIM_FRACTION = 0.50;

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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
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

  const smoothedSpeeds = boxSmooth(rawSpeeds, SMOOTH_WINDOW);
  const smoothedVY     = boxSmooth(rawVY,     DIR_SMOOTH_WINDOW);

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

function getConcentricSign(
  vFrames: VelocityFrame[],
  movingThreshold: number
): 1 | -1 {
  const moving   = vFrames.filter((f) => f.velocitySmoothed > movingThreshold);
  const up       = moving.filter((f) => f.velocityY < 0);
  const down     = moving.filter((f) => f.velocityY > 0);
  const meanUp   = up.length   ? up.reduce((s, f)   => s + Math.abs(f.velocityY), 0) / up.length   : 0;
  const meanDown = down.length ? down.reduce((s, f) => s + Math.abs(f.velocityY), 0) / down.length : 0;
  return meanUp >= meanDown ? -1 : 1;
}

// ─── Step 3: Label phases ─────────────────────────────────────────────────────

export function detectPhases(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result          = vFrames.map((f) => ({ ...f }));
  const globalPeak      = Math.max(...result.map((f) => f.velocitySmoothed), 1);
  const movingThreshold = globalPeak * MOVING_FRACTION;
  const concentricSign  = getConcentricSign(result, movingThreshold);

  for (const f of result) {
    if (f.velocitySmoothed < movingThreshold) {
      f.phase = "rest";
      continue;
    }
    f.phase = concentricSign * f.velocityY < 0 ? "concentric" : "eccentric";
  }

  // Iteratively merge short glitch segments into neighbours
  let changed = true;
  while (changed) {
    changed = false;
    let i   = 0;
    while (i < result.length) {
      const phase = result[i].phase;
      let j = i;
      while (j < result.length && result[j].phase === phase) j++;

      if (phase !== "rest" && j - i < MIN_PHASE_FRAMES) {
        const prevPhase = i > 0            ? result[i - 1].phase : "rest";
        const nextPhase = j < result.length ? result[j].phase     : "rest";
        const fill =
          prevPhase !== "rest" ? prevPhase :
          nextPhase !== "rest" ? nextPhase : "rest";
        for (let k = i; k < j; k++) result[k].phase = fill;
        changed = true;
      }
      i = j;
    }
  }

  return result;
}

// ─── Step 4: Build phase segments ─────────────────────────────────────────────

interface Segment {
  phase: Phase;
  start: number;
  end:   number;
}

function buildSegments(result: VelocityFrame[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < result.length) {
    const phase = result[i].phase;
    let j = i;
    while (j < result.length && result[j].phase === phase) j++;
    if (phase !== "rest") segments.push({ phase, start: i, end: j });
    i = j;
  }
  return segments;
}

// ─── Step 5: Segment reps by direction reversal ───────────────────────────────

export function segmentReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result   = vFrames.map((f) => ({ ...f }));
  const segments = buildSegments(result);

  if (segments.length < 2) return result;

  // Determine convention from first moving segment
  const firstPhase = segments[0].phase;
  let repIndex     = 0;

  if (firstPhase === "eccentric") {
    // Squat / bench press: ecc then conc = one rep
    for (let s = 0; s < segments.length - 1; s++) {
      if (
        segments[s].phase     === "eccentric" &&
        segments[s + 1].phase === "concentric"
      ) {
        const ecc  = segments[s];
        const conc = segments[s + 1];
        for (let k = ecc.start;  k < ecc.end;  k++) result[k].repIndex = repIndex;
        for (let k = conc.start; k < conc.end; k++) result[k].repIndex = repIndex;
        repIndex++;
        s++; // consumed both
      }
    }
  } else {
    // Deadlift: conc then ecc = one rep
    for (let s = 0; s < segments.length - 1; s++) {
      if (
        segments[s].phase     === "concentric" &&
        segments[s + 1].phase === "eccentric"
      ) {
        const conc = segments[s];
        const ecc  = segments[s + 1];
        for (let k = conc.start; k < conc.end; k++) result[k].repIndex = repIndex;
        for (let k = ecc.start;  k < ecc.end;  k++) result[k].repIndex = repIndex;
        repIndex++;
        s++;
      }
    }
  }

  return result;
}

// ─── Step 6: Trim false reps (unrack / rerack) ───────────────────────────────
//
// After pairing, compute peak concentric for each rep.
// Find the median of all rep peaks.
// Discard reps at the EDGES (first / last) that are well below median —
// these are almost always unracking or re-racking artefacts.
// Reps in the MIDDLE are never discarded by this rule — only edge reps.

function trimEdgeReps(
  result:    VelocityFrame[],
  allRepIdx: number[]
): Set<number> {
  const peakByRep = new Map<number, number>();
  for (const idx of allRepIdx) {
    const concFrames = result.filter(
      (f) => f.repIndex === idx && f.phase === "concentric"
    );
    peakByRep.set(
      idx,
      concFrames.length ? Math.max(...concFrames.map((f) => f.velocitySmoothed)) : 0
    );
  }

  const peaks      = allRepIdx.map((i) => peakByRep.get(i) ?? 0);
  const medianPeak = median(peaks);
  const minPeak    = medianPeak * EDGE_TRIM_FRACTION;

  const valid = new Set(allRepIdx);

  // Trim from the front
  for (const idx of allRepIdx) {
    if ((peakByRep.get(idx) ?? 0) < minPeak) valid.delete(idx);
    else break;
  }

  // Trim from the back
  for (const idx of [...allRepIdx].reverse()) {
    if ((peakByRep.get(idx) ?? 0) < minPeak) valid.delete(idx);
    else break;
  }

  return valid;
}

// ─── Step 7: Filter + renumber ───────────────────────────────────────────────

function filterAndRenumber(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  const allRepIdx = [
    ...new Set(
      result.map((f) => f.repIndex).filter((r): r is number => r !== null)
    ),
  ].sort((a, b) => a - b);

  // Basic validity: enough frames + has concentric phase
  const basicValid = new Set(
    allRepIdx.filter((idx) => {
      const repFrames  = result.filter((f) => f.repIndex === idx);
      const concFrames = repFrames.filter((f) => f.phase === "concentric");
      return (
        repFrames.length  >= MIN_REP_TOTAL_FRAMES &&
        concFrames.length >  0
      );
    })
  );

  // Median-based peak filter (global, not just edges)
  const concPeaks = [...basicValid].map((idx) => {
    const frames = result.filter(
      (f) => f.repIndex === idx && f.phase === "concentric"
    );
    return frames.length ? Math.max(...frames.map((f) => f.velocitySmoothed)) : 0;
  });
  const medPeak  = median(concPeaks);
  const minPeak  = medPeak * MIN_REP_VS_MEDIAN;

  const midValid = new Set(
    [...basicValid].filter((idx) => {
      const frames = result.filter(
        (f) => f.repIndex === idx && f.phase === "concentric"
      );
      const peak = frames.length
        ? Math.max(...frames.map((f) => f.velocitySmoothed))
        : 0;
      return peak >= minPeak;
    })
  );

  // Trim edge artefacts (unrack/rerack)
  const validIdx = [...midValid].sort((a, b) => a - b);
  const trimmed  = trimEdgeReps(result, validIdx);

  // Renumber sequentially
  const finalIdx = [...trimmed].sort((a, b) => a - b);
  const remap    = new Map(finalIdx.map((old, i) => [old, i]));

  for (const f of result) {
    if (f.repIndex === null || !trimmed.has(f.repIndex)) {
      f.repIndex = null;
      if (f.phase !== "rest") f.phase = "rest";
    } else {
      f.repIndex = remap.get(f.repIndex) ?? null;
    }
  }

  return result;
}

// ─── Step 8: Per-rep statistics ───────────────────────────────────────────────

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

  const rep1Peak = stats[0]?.peakConcentricVelocity ?? 1;
  for (const s of stats) {
    s.percentSpeedDrop =
      rep1Peak > 0
        ? ((rep1Peak - s.peakConcentricVelocity) / rep1Peak) * 100
        : 0;
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
  const filtered     = filterAndRenumber(withReps);
  const repStats     = computeRepStats(filtered);
  return { vFrames: filtered, repStats };
}