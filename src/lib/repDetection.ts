import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Wide smoothing for speed magnitude — kills noise, keeps rep shape */
const SMOOTH_WINDOW = 15;

/** Even wider smoothing for direction signal — prevents mid-rep phase flips */
const DIR_SMOOTH_WINDOW = 25;

/** Speed must exceed this fraction of global peak to count as "moving" */
const MOVING_FRACTION = 0.08;

/** Minimum number of frames between two peaks (prevents double-counting
 *  one rep as two). At 30fps, 20 frames = ~0.67s minimum rep duration. */
const MIN_PEAK_SEPARATION_FRAMES = 20;

/** A peak must be at least this fraction of the median peak height
 *  to be counted as a real rep (filters unrack/rerack and noise peaks) */
const MIN_PEAK_VS_MEDIAN = 0.45;

/** Minimum frames on each side of a peak to assign phase labels */
const MIN_PHASE_FRAMES = 5;

// ─── Maths helpers ────────────────────────────────────────────────────────────

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

/** Find local maxima in `values` that are separated by at least
 *  `minSep` frames and exceed `minHeight`. */
function findPeaks(
  values:    number[],
  minSep:    number,
  minHeight: number
): number[] {
  const peaks: number[] = [];

  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] <= minHeight) continue;
    if (values[i] < values[i - 1] || values[i] < values[i + 1]) continue;

    // Local maximum — check it's higher than neighbours within minSep
    let isMax = true;
    for (let j = Math.max(0, i - minSep); j <= Math.min(values.length - 1, i + minSep); j++) {
      if (j !== i && values[j] >= values[i]) { isMax = false; break; }
    }
    if (isMax) peaks.push(i);
  }

  return peaks;
}

/** Find the valley (minimum) index between two peak frame indices */
function findValley(values: number[], from: number, to: number): number {
  let minVal = Infinity;
  let minIdx = from;
  for (let i = from; i <= to; i++) {
    if (values[i] < minVal) { minVal = values[i]; minIdx = i; }
  }
  return minIdx;
}

// ─── Step 1: Build velocity frames ───────────────────────────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps:    number
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt          = 1 / fps;
  const rawSpeeds   = [0];
  const rawVY       = [0];

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
  vFrames:          VelocityFrame[],
  movingThreshold:  number
): 1 | -1 {
  const moving   = vFrames.filter((f) => f.velocitySmoothed > movingThreshold);
  const up       = moving.filter((f) => f.velocityY < 0);
  const down     = moving.filter((f) => f.velocityY > 0);
  const meanUp   = up.length
    ? up.reduce((s, f) => s + Math.abs(f.velocityY), 0) / up.length : 0;
  const meanDown = down.length
    ? down.reduce((s, f) => s + Math.abs(f.velocityY), 0) / down.length : 0;
  // -1 → bar going UP = concentric (squat / bench)
  // +1 → bar going DOWN = concentric (deadlift)
  return meanUp >= meanDown ? -1 : 1;
}

// ─── Step 3: Find rep peaks and segment ──────────────────────────────────────
//
// PRIMARY STRATEGY: treat each local maximum in the smoothed speed signal
// as the centre of one rep. Valley points between adjacent peaks become
// the rep boundaries. This is robust to reps that don't have a full stop
// between them (which breaks rest-gap detection).

export function detectPhasesAndReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result          = vFrames.map((f) => ({ ...f }));
  const speeds          = result.map((f) => f.velocitySmoothed);
  const globalPeak      = Math.max(...speeds, 1);
  const movingThreshold = globalPeak * MOVING_FRACTION;
  const concentricSign  = getConcentricSign(result, movingThreshold);

  // ── 3a. Find all candidate peaks ─────────────────────────────────────────
  const candidatePeaks = findPeaks(
    speeds,
    MIN_PEAK_SEPARATION_FRAMES,
    movingThreshold * 2   // peaks must be well above noise floor
  );

  if (candidatePeaks.length === 0) return result;

  // ── 3b. Filter peaks by median height (removes unrack/rerack) ───────────
  const peakHeights  = candidatePeaks.map((i) => speeds[i]);
  const medianHeight = median(peakHeights);
  const minPeakH     = medianHeight * MIN_PEAK_VS_MEDIAN;

  const realPeaks = candidatePeaks.filter((i) => speeds[i] >= minPeakH);

  if (realPeaks.length === 0) return result;

  // ── 3c. Find valley boundaries between consecutive peaks ─────────────────
  //  boundaries[0]   = left edge of rep 0  (start of movement or first valley)
  //  boundaries[k]   = valley between rep k-1 and rep k
  //  boundaries[n]   = right edge of last rep

  const boundaries: number[] = [];

  // Left boundary — valley from index 0 to first peak
  boundaries.push(findValley(speeds, 0, realPeaks[0]));

  // Between consecutive peaks
  for (let p = 0; p < realPeaks.length - 1; p++) {
    boundaries.push(findValley(speeds, realPeaks[p], realPeaks[p + 1]));
  }

  // Right boundary — valley from last peak to end
  boundaries.push(findValley(speeds, realPeaks[realPeaks.length - 1], speeds.length - 1));

  // ── 3d. Assign repIndex and phase to each frame ───────────────────────────
  for (let r = 0; r < realPeaks.length; r++) {
    const repStart = boundaries[r];
    const repEnd   = boundaries[r + 1];
    const peakIdx  = realPeaks[r];

    for (let i = repStart; i < repEnd; i++) {
      const f = result[i];

      // Frames below moving threshold = rest (between sets)
      if (f.velocitySmoothed < movingThreshold) {
        f.phase    = "rest";
        f.repIndex = null;
        continue;
      }

      f.repIndex = r;

      // Phase labelling:
      // Before the speed peak → approaching peak → first half of rep
      // After the speed peak  → decelerating   → second half of rep
      //
      // Which half is concentric depends on concentricSign + direction of
      // bar travel (velocityY sign).
      //
      // We use the actual Y-direction at each frame, not position relative
      // to peak — this handles asymmetric reps and pauses correctly.
      const isConc = concentricSign * f.velocityY < 0;
      f.phase = isConc ? "concentric" : "eccentric";
    }
  }

  // ── 3e. Clean up short glitch segments ───────────────────────────────────
  let changed = true;
  while (changed) {
    changed = false;
    let i   = 0;
    while (i < result.length) {
      const phase = result[i].phase;
      let j = i;
      while (j < result.length && result[j].phase === phase) j++;

      if (phase !== "rest" && j - i < MIN_PHASE_FRAMES) {
        const prevPhase = i > 0             ? result[i - 1].phase : "rest";
        const nextPhase = j < result.length ? result[j].phase     : "rest";
        const fill =
          prevPhase !== "rest" ? prevPhase :
          nextPhase !== "rest" ? nextPhase : "rest";
        for (let k = i; k < j; k++) {
          result[k].phase    = fill;
          result[k].repIndex = fill === "rest" ? null : result[k].repIndex;
        }
        changed = true;
      }
      i = j;
    }
  }

  return result;
}

// ─── Step 4: Per-rep statistics ───────────────────────────────────────────────

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

  // % drop vs rep 1
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
  const repStats     = computeRepStats(withReps);
  return { vFrames: withReps, repStats };
}