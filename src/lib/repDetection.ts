import type { FrameResult, VelocityFrame, Phase, RepStats } from "@/types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Smoothing for speed magnitude display */
const SMOOTH_WINDOW = 15;

/** Wide smoothing for the signed Y signal used for rep detection */
const DIR_SMOOTH_WINDOW = 25;

/** Fraction of global peak speed below which a frame is "at rest" */
const MOVING_FRACTION = 0.08;

/** Minimum frames between a concentric peak and the next eccentric peak
 *  (prevents same rep's two humps being split). At 30fps = ~0.5s */
const MIN_HALF_REP_FRAMES = 15;

/** A rep's concentric peak must be >= this fraction of median concentric peak */
const MIN_REP_VS_MEDIAN = 0.40;

/** Minimum frames for a valid rep */
const MIN_REP_FRAMES = 12;

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
 * Find local maxima in `signal` that are:
 *  - above `minHeight`
 *  - separated by at least `minSep` frames from any higher value
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

/** Index of minimum value between two indices (inclusive) */
function valleyBetween(signal: number[], from: number, to: number): number {
  let minVal = Infinity, minIdx = from;
  for (let i = from; i <= to; i++) {
    if (signal[i] < minVal) { minVal = signal[i]; minIdx = i; }
  }
  return minIdx;
}

// ─── Step 1: Build velocity frames ───────────────────────────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps:    number
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt        = 1 / fps;
  const rawSpeed  = [0];
  const rawVY     = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;
    rawSpeed.push(Math.sqrt(dx * dx + dy * dy) / dt);
    rawVY.push(dy / dt);   // +ve = bar moving DOWN in image
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
  // -1 → moving UP in image = concentric (squat / bench)
  // +1 → moving DOWN in image = concentric (deadlift)
  return meanUp >= meanDown ? -1 : 1;
}

// ─── Step 3: Detect reps using SIGNED velocity peaks ─────────────────────────
//
// KEY FIX: instead of finding peaks in |speed| (which gives 2 peaks per rep —
// one eccentric, one concentric), we find peaks in the SIGNED Y velocity.
// Concentric produces a peak in one direction, eccentric in the other.
// Pairing adjacent opposite-sign peaks = one rep.

export function detectPhasesAndReps(vFrames: VelocityFrame[]): VelocityFrame[] {
  const result          = vFrames.map((f) => ({ ...f }));
  const speeds          = result.map((f) => f.velocitySmoothed);
  const signedVY        = result.map((f) => f.velocityY);
  const globalPeak      = Math.max(...speeds, 1);
  const movingThreshold = globalPeak * MOVING_FRACTION;
  const concentricSign  = getConcentricSign(result, movingThreshold);

  // Build signed concentric velocity signal:
  // positive where bar moves concentrically, negative where eccentric,
  // zero where at rest.
  // concentricSign = -1 → concentric = negative velocityY (bar going up)
  //   so concentric signal = -velocityY (positive when going up)
  // concentricSign = +1 → concentric = positive velocityY (bar going down)
  //   so concentric signal = +velocityY
  const concSignal = signedVY.map((vy, i) =>
    speeds[i] < movingThreshold ? 0 : -concentricSign * vy
  );
  // concSignal > 0 → concentric movement
  // concSignal < 0 → eccentric movement

  // ── 3a. Find concentric peaks (positive peaks in concSignal) ─────────────
  const concPeakSignal = concSignal.map((v) => Math.max(v, 0));
  const concPeaks = findPeaks(
    concPeakSignal,
    MIN_HALF_REP_FRAMES,
    movingThreshold
  );

  // ── 3b. Find eccentric peaks (negative → flip sign, find peaks) ──────────
  const eccPeakSignal = concSignal.map((v) => Math.max(-v, 0));
  const eccPeaks = findPeaks(
    eccPeakSignal,
    MIN_HALF_REP_FRAMES,
    movingThreshold
  );

  if (concPeaks.length === 0) return result;

  // ── 3c. Filter concentric peaks by median height ──────────────────────────
  const concHeights  = concPeaks.map((i) => concPeakSignal[i]);
  const medConc      = median(concHeights);
  const minConcPeak  = medConc * MIN_REP_VS_MEDIAN;
  const realConcPeaks = concPeaks.filter((i) => concPeakSignal[i] >= minConcPeak);

  if (realConcPeaks.length === 0) return result;

  // ── 3d. Pair each concentric peak with its nearest eccentric peak ─────────
  // A rep = one eccentric phase + one concentric phase.
  // For squat/bench: eccentric comes BEFORE concentric.
  // For deadlift:    concentric comes BEFORE eccentric.
  // We pair by finding the closest eccentric peak to each concentric peak
  // on the expected side.

  interface RepPair {
    eccIdx:  number;  // frame index of eccentric peak
    concIdx: number;  // frame index of concentric peak
    start:   number;  // frame index of rep start
    end:     number;  // frame index of rep end
  }

  const pairs: RepPair[] = [];
  const usedEcc = new Set<number>();

  for (const ci of realConcPeaks) {
    // Find the closest eccentric peak that hasn't been used yet
    // For squat/bench (concentricSign = -1), eccentric is BEFORE concentric
    // For deadlift   (concentricSign = +1), eccentric is AFTER concentric
    const expectedBefore = concentricSign === -1;

    let bestEcc   = -1;
    let bestDist  = Infinity;

    for (const ei of eccPeaks) {
      if (usedEcc.has(ei)) continue;
      const isBefore = ei < ci;
      if (expectedBefore !== isBefore) continue;
      const dist = Math.abs(ei - ci);
      if (dist < bestDist && dist <= MIN_HALF_REP_FRAMES * 8) {
        bestDist = dist;
        bestEcc  = ei;
      }
    }

    if (bestEcc === -1) {
      // No eccentric partner found — still count it as a rep (conc-only)
      pairs.push({ eccIdx: -1, concIdx: ci, start: ci, end: ci });
    } else {
      usedEcc.add(bestEcc);
      const repStart = Math.min(bestEcc, ci);
      const repEnd   = Math.max(bestEcc, ci);
      pairs.push({ eccIdx: bestEcc, concIdx: ci, start: repStart, end: repEnd });
    }
  }

  // ── 3e. Assign frame boundaries using valleys ─────────────────────────────
  // Sort pairs by time
  pairs.sort((a, b) => a.start - b.start);

  // For each pair, determine the rep's frame range using valleys in speed
  interface RepBounds {
    frameStart: number;
    frameEnd:   number;
    concIdx:    number;
    eccIdx:     number;
  }

  const repBounds: RepBounds[] = pairs.map((p, pi) => {
    const prevEnd   = pi > 0 ? pairs[pi - 1].end : 0;
    const nextStart = pi < pairs.length - 1 ? pairs[pi + 1].start : speeds.length - 1;

    // Frame start = valley between previous rep end and this rep start
    const frameStart = valleyBetween(speeds, prevEnd, p.start);
    // Frame end = valley between this rep end and next rep start
    const frameEnd   = valleyBetween(speeds, p.end, nextStart);

    return { frameStart, frameEnd, concIdx: p.concIdx, eccIdx: p.eccIdx };
  });

  // ── 3f. Label frames ──────────────────────────────────────────────────────
  for (let r = 0; r < repBounds.length; r++) {
    const { frameStart, frameEnd } = repBounds[r];

    for (let i = frameStart; i <= frameEnd; i++) {
      const f = result[i];
      if (f.velocitySmoothed < movingThreshold) {
        f.phase    = "rest";
        f.repIndex = null;
        continue;
      }

      f.repIndex = r;
      // Use actual signed direction for phase label
      const isConc = concentricSign * f.velocityY < 0;
      f.phase = isConc ? "concentric" : "eccentric";
    }
  }

  // ── 3g. Clean up tiny phase glitches ─────────────────────────────────────
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

// ─── Step 4: Per-rep statistics ───────────────────────────────────────────────

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

  // Filter out reps without concentric frames or too short
  const stats: RepStats[] = [];
  repMap.forEach((frames, repIdx) => {
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames  = frames.filter((f) => f.phase === "eccentric");
    if (frames.length < MIN_REP_FRAMES) return;
    if (concFrames.length === 0) return;
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

  // Renumber sequentially after filtering
  stats.sort((a, b) => a.repNumber - b.repNumber);
  stats.forEach((s, i) => { s.repNumber = i + 1; });

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