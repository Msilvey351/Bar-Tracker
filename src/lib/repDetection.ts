import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Smoothing window for speed magnitude */
const SMOOTH_WINDOW = 15;

/** Wider smoothing for direction signal — prevents mid-rep phase flips */
const DIR_SMOOTH_WINDOW = 25;

/** Fraction of global peak speed below which a frame is "at rest" */
const MOVING_FRACTION = 0.08;

/** Minimum frames between two peaks of the same sign.
 *  At 30fps, 15 frames ≈ 0.5s minimum half-rep duration. */
const MIN_HALF_REP_FRAMES = 15;

/** A rep's concentric peak must be >= this fraction of the median
 *  concentric peak across all candidate reps. */
const MIN_REP_VS_MEDIAN = 0.40;

/** Minimum total frames for a valid rep */
const MIN_REP_FRAMES = 12;

/** A rep must have vertical bar travel >= this fraction of the median
 *  vertical range. Filters racking movements (mostly horizontal). */
const MIN_VERTICAL_RANGE_FRACTION = 0.50;

/** Edge reps (first/last) are trimmed if their peak concentric velocity
 *  is below this fraction of the INNER reps' median peak. */
const EDGE_TRIM_FRACTION = 0.65;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function boxSmooth(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo    = Math.max(0, i - half);
    const hi    = Math.min(values.length - 1, i + half);
    const slice = values.slice(lo, hi + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s   = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Find local maxima in `signal` separated by at least `minSep` frames
 * and exceeding `minHeight`.
 */
function findPeaks(
  signal:    number[],
  minSep:    number,
  minHeight: number
): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] <= minHeight) continue;
    if (signal[i] < signal[i - 1] || signal[i] < signal[i + 1]) continue;
    let isMax = true;
    for (
      let j = Math.max(0, i - minSep);
      j <= Math.min(signal.length - 1, i + minSep);
      j++
    ) {
      if (j !== i && signal[j] >= signal[i]) { isMax = false; break; }
    }
    if (isMax) peaks.push(i);
  }
  return peaks;
}

/** Index of minimum value in `signal` between `from` and `to` inclusive */
function valleyBetween(signal: number[], from: number, to: number): number {
  let minVal = Infinity;
  let minIdx = from;
  for (let i = from; i <= to; i++) {
    if (signal[i] < minVal) { minVal = signal[i]; minIdx = i; }
  }
  return minIdx;
}

/**
 * Vertical range (max Y − min Y) of original tracked positions
 * for a set of VelocityFrames. Large = real rep with full ROM.
 * Small = racking movement (mostly horizontal, little vertical travel).
 */
function verticalRange(
  repVFrames: VelocityFrame[],
  allFrames:  FrameResult[]
): number {
  if (repVFrames.length < 2) return 0;
  const idxSet  = new Set(repVFrames.map((f) => f.frameIndex));
  const matched = allFrames.filter((f) => idxSet.has(f.frameIndex));
  if (matched.length < 2) return 0;
  const ys = matched.map((f) => f.position.y);
  return Math.max(...ys) - Math.min(...ys);
}

// ─── Step 1: Build velocity frames ───────────────────────────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps:    number
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt       = 1 / fps;
  const rawSpeed = [0];
  const rawVY    = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;
    rawSpeed.push(Math.sqrt(dx * dx + dy * dy) / dt);
    rawVY.push(dy / dt); // positive = bar moving DOWN in image coords
  }

  const smoothSpeed = boxSmooth(rawSpeed, SMOOTH_WINDOW);
  const smoothVY    = boxSmooth(rawVY,    DIR_SMOOTH_WINDOW);

  return frames.map((f, i) => ({
    frameIndex:       f.frameIndex,
    timeSeconds:      f.timeSeconds,
    position:         f.position,
    velocityRaw:      rawSpeed[i],
    velocitySmoothed: smoothSpeed[i],
    velocityY:        smoothVY[i],
    phase:            "rest" as Phase,
    repIndex:         null,
  }));
}

// ─── Step 2: Determine concentric direction ───────────────────────────────────

function getConcentricSign(
  vFrames:   VelocityFrame[],
  threshold: number
): 1 | -1 {
  const moving   = vFrames.filter((f) => f.velocitySmoothed > threshold);
  const up       = moving.filter((f) => f.velocityY < 0);
  const down     = moving.filter((f) => f.velocityY > 0);
  const meanUp   = up.length
    ? up.reduce((s, f) => s + Math.abs(f.velocityY), 0) / up.length : 0;
  const meanDown = down.length
    ? down.reduce((s, f) => s + Math.abs(f.velocityY), 0) / down.length : 0;
  // -1 → bar going UP = concentric (squat / bench press)
  // +1 → bar going DOWN = concentric (deadlift)
  return meanUp >= meanDown ? -1 : 1;
}

// ─── Step 3: Detect phases and segment reps ───────────────────────────────────
//
// Uses SIGNED velocity peaks rather than magnitude peaks.
// Each concentric peak is paired with its nearest eccentric peak
// to form one rep. This prevents eccentric and concentric phases
// of the same rep being counted as separate reps.

export function detectPhasesAndReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result          = vFrames.map((f) => ({ ...f }));
  const speeds          = result.map((f) => f.velocitySmoothed);
  const globalPeak      = Math.max(...speeds, 1);
  const movingThreshold = globalPeak * MOVING_FRACTION;
  const concentricSign  = getConcentricSign(result, movingThreshold);

  // Build signed concentric signal:
  // positive where moving concentrically, negative where eccentric, 0 at rest
  const concSignal = result.map((f, i) =>
    speeds[i] < movingThreshold ? 0 : -concentricSign * f.velocityY
  );

  // Find concentric peaks (positive humps)
  const concPeakSig  = concSignal.map((v) => Math.max(v, 0));
  const concPeaks    = findPeaks(concPeakSig, MIN_HALF_REP_FRAMES, movingThreshold);

  // Find eccentric peaks (flip negatives to find their peaks)
  const eccPeakSig   = concSignal.map((v) => Math.max(-v, 0));
  const eccPeaks     = findPeaks(eccPeakSig, MIN_HALF_REP_FRAMES, movingThreshold);

  if (concPeaks.length === 0) return result;

  // Filter concentric peaks by median height
  const concHeights   = concPeaks.map((i) => concPeakSig[i]);
  const medConc       = median(concHeights);
  const minConcH      = medConc * MIN_REP_VS_MEDIAN;
  const realConcPeaks = concPeaks.filter((i) => concPeakSig[i] >= minConcH);
  if (realConcPeaks.length === 0) return result;

  // ── Pair concentric peaks with eccentric peaks ────────────────────────────
  // For squat/bench (concentricSign = -1): eccentric comes BEFORE concentric
  // For deadlift   (concentricSign = +1): eccentric comes AFTER concentric
  interface RepPair {
    eccIdx:  number; // -1 if no partner found
    concIdx: number;
    start:   number;
    end:     number;
  }

  const pairs:   RepPair[]   = [];
  const usedEcc: Set<number> = new Set();
  const eccBeforeConc        = concentricSign === -1;

  for (const ci of realConcPeaks) {
    let bestEcc  = -1;
    let bestDist = Infinity;

    for (const ei of eccPeaks) {
      if (usedEcc.has(ei)) continue;
      // Must be on the correct side
      if ((ei < ci) !== eccBeforeConc) continue;
      const dist = Math.abs(ei - ci);
      if (dist < bestDist && dist <= MIN_HALF_REP_FRAMES * 8) {
        bestDist = dist;
        bestEcc  = ei;
      }
    }

    if (bestEcc !== -1) usedEcc.add(bestEcc);
    const repStart = bestEcc === -1 ? ci : Math.min(bestEcc, ci);
    const repEnd   = bestEcc === -1 ? ci : Math.max(bestEcc, ci);
    pairs.push({ eccIdx: bestEcc, concIdx: ci, start: repStart, end: repEnd });
  }

  pairs.sort((a, b) => a.start - b.start);

  // ── Assign frame boundaries using speed valleys ───────────────────────────
  const repBounds = pairs.map((p, pi) => {
    const prevEnd   = pi > 0              ? pairs[pi - 1].end   : 0;
    const nextStart = pi < pairs.length-1 ? pairs[pi + 1].start : speeds.length - 1;
    return {
      frameStart: valleyBetween(speeds, prevEnd,  p.start),
      frameEnd:   valleyBetween(speeds, p.end,    nextStart),
    };
  });

  // ── Label each frame with repIndex and phase ──────────────────────────────
  for (let r = 0; r < repBounds.length; r++) {
    const { frameStart, frameEnd } = repBounds[r];
    for (let i = frameStart; i <= frameEnd; i++) {
      const f = result[i];
      if (f.velocitySmoothed < movingThreshold) {
        f.phase = "rest"; f.repIndex = null; continue;
      }
      f.repIndex = r;
      f.phase    = concentricSign * f.velocityY < 0 ? "concentric" : "eccentric";
    }
  }

  // ── Merge short glitch phase segments into neighbours ────────────────────
  let changed = true;
  while (changed) {
    changed = false;
    let i   = 0;
    while (i < result.length) {
      const phase = result[i].phase;
      let j = i;
      while (j < result.length && result[j].phase === phase) j++;
      if (phase !== "rest" && j - i < 5) {
        const prev = i > 0             ? result[i - 1].phase : "rest";
        const next = j < result.length ? result[j].phase     : "rest";
        const fill = prev !== "rest" ? prev : next !== "rest" ? next : "rest";
        for (let k = i; k < j; k++) {
          result[k].phase    = fill;
          if (fill === "rest") result[k].repIndex = null;
        }
        changed = true;
      }
      i = j;
    }
  }

  return result;
}

// ─── Step 4: Filter fake reps + renumber ─────────────────────────────────────

interface RepMetrics {
  idx:         number;
  frames:      VelocityFrame[];
  concFrames:  VelocityFrame[];
  peakConc:    number;
  totalFrames: number;
  vertRange:   number;
}

export function filterAndRenumber(
  vFrames:   VelocityFrame[],
  allFrames: FrameResult[]
): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  const allRepIdx = [
    ...new Set(
      result.map((f) => f.repIndex).filter((r): r is number => r !== null)
    ),
  ].sort((a, b) => a - b);

  if (allRepIdx.length === 0) return result;

  // ── Build per-rep metrics ─────────────────────────────────────────────────
  const metrics: RepMetrics[] = allRepIdx.map((idx) => {
    const frames     = result.filter((f) => f.repIndex === idx);
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const peakConc   = concFrames.length
      ? Math.max(...concFrames.map((f) => f.velocitySmoothed)) : 0;
    return {
      idx,
      frames,
      concFrames,
      peakConc,
      totalFrames: frames.length,
      vertRange:   verticalRange(frames, allFrames),
    };
  });

  // ── Pass 1: Basic validity ────────────────────────────────────────────────
  const basicValid = metrics.filter(
    (m) => m.totalFrames >= MIN_REP_FRAMES && m.concFrames.length > 0
  );
  if (basicValid.length === 0) return result;

  // ── Pass 2: Vertical range filter (kills racking movements) ──────────────
  const medVertRange = median(basicValid.map((m) => m.vertRange));
  const minVertRange = medVertRange * MIN_VERTICAL_RANGE_FRACTION;
  const rangeValid   = basicValid.filter((m) => m.vertRange >= minVertRange);
  if (rangeValid.length === 0) return result;

  // ── Pass 3: Peak velocity filter (kills noise / glitch reps) ─────────────
  const medPeak   = median(rangeValid.map((m) => m.peakConc));
  const minPeak   = medPeak * MIN_REP_VS_MEDIAN;
  const peakValid = rangeValid.filter((m) => m.peakConc >= minPeak);
  if (peakValid.length === 0) return result;

  // ── Pass 4: Edge trim — removes unrack / rerack ───────────────────────────
  // Compares first/last rep against INNER reps' median.
  // Repeats up to 3 times to handle multiple bad edge reps.
  let edgeFiltered = [...peakValid];

  const trimEdges = (reps: RepMetrics[]): RepMetrics[] => {
    if (reps.length <= 2) return reps;
    const inner       = reps.slice(1, -1);
    const innerMedian = median(inner.map((m) => m.peakConc));
    const minEdgePeak = innerMedian * EDGE_TRIM_FRACTION;
    let   trimmed     = [...reps];

    // Trim from front
    while (trimmed.length > 1 && trimmed[0].peakConc < minEdgePeak) {
      trimmed = trimmed.slice(1);
    }
    // Trim from back
    while (trimmed.length > 1 && trimmed[trimmed.length - 1].peakConc < minEdgePeak) {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
  };

  for (let pass = 0; pass < 3; pass++) {
    const trimmed = trimEdges(edgeFiltered);
    if (trimmed.length === edgeFiltered.length) break;
    edgeFiltered = trimmed;
  }

  // ── Renumber sequentially ─────────────────────────────────────────────────
  const validSet = new Set(edgeFiltered.map((m) => m.idx));
  const sorted   = [...validSet].sort((a, b) => a - b);
  const remap    = new Map(sorted.map((old, i) => [old, i]));

  for (const f of result) {
    if (f.repIndex === null || !validSet.has(f.repIndex)) {
      f.repIndex = null;
      if (f.phase !== "rest") f.phase = "rest";
    } else {
      f.repIndex = remap.get(f.repIndex) ?? null;
    }
  }

  return result;
}

// ─── Step 5: Per-rep statistics ───────────────────────────────────────────────

export function computeRepStats(vFrames: VelocityFrame[]): RepStats[] {
  const repMap = new Map<number, VelocityFrame[]>();
  for (const f of vFrames) {
    if (f.repIndex === null) continue;
    if (!repMap.has(f.repIndex)) repMap.set(f.repIndex, []);
    repMap.get(f.repIndex)!.push(f);
  }

  const avg  = (arr: VelocityFrame[]) =>
    arr.length
      ? arr.reduce((s, f) => s + f.velocitySmoothed, 0) / arr.length
      : 0;
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
    if (frames.length < MIN_REP_FRAMES || concFrames.length === 0) return;
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

  // Sort and renumber
  stats.sort((a, b) => a.repNumber - b.repNumber);
  stats.forEach((s, i) => { s.repNumber = i + 1; });

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

// ─── Master export ────────────────────────────────────────────────────────────

export function analyseReps(
  frames: FrameResult[],
  fps:    number
): { vFrames: VelocityFrame[]; repStats: RepStats[] } {
  const withVelocity = buildVelocityFrames(frames, fps);
  const withReps     = detectPhasesAndReps(withVelocity);
  const filtered     = filterAndRenumber(withReps, frames);
  const repStats     = computeRepStats(filtered);
  return { vFrames: filtered, repStats };
}