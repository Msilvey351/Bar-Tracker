import type {
  FrameResult,
  VelocityFrame,
  Phase,
  RepStats,
  CalibrationPoints,
} from "@/types";

// ─── Public options ───────────────────────────────────────────────────────────

export interface AnalyseRepOptions {
  calibration?: CalibrationPoints | null;
}

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Smoothing window for speed magnitude */
const SPEED_SMOOTH_WINDOW = 15;

/** Smoothing window for signed vertical velocity */
const VY_SMOOTH_WINDOW = 17;

/** Below this fraction of global speed peak = rest/noise */
const MOVING_FRACTION = 0.07;

/** Below this fraction of global vertical velocity = no reliable direction */
const DIRECTION_FRACTION = 0.06;

/** Merge same-direction movement segments if the rest gap between them is small */
const MAX_REST_GAP_FRAMES = 5;

/** Minimum frames in one directional movement segment */
const MIN_SEGMENT_FRAMES = 5;

/** Minimum frames in a full rep candidate */
const MIN_REP_FRAMES = 14;

/** Maximum frames in a full rep candidate */
const MAX_REP_FRAMES = 180;

/** Pixel fallback if no calibration exists */
const ABS_MIN_VERTICAL_RANGE_PX = 8;

/**
 * Physical filters used when calibration exists.
 * This makes close/far camera videos behave consistently.
 */
const MIN_REP_RANGE_M = 0.10;

/**
 * Each half of the rep must have meaningful vertical travel.
 * Helps reject rack/unrack movements that only contain one real phase.
 */
const MIN_PHASE_RANGE_M = 0.035;

/** Rep vertical range must be at least this fraction of median candidate range */
const MIN_RANGE_VS_MEDIAN = 0.40;

/** Rep peak speed must be at least this fraction of median candidate peak */
const MIN_PEAK_VS_MEDIAN = 0.35;

/** Edge trim — first/last reps below this fraction of inner median are removed */
const EDGE_TRIM_FRACTION = 0.45;

/** Tiny phase glitches shorter than this get removed/merged */
const MIN_PHASE_RUN_FRAMES = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function range(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function maxValue(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values);
}

function maxAbs(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values.map((v) => Math.abs(v)));
}

function signOf(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

function pxToM(px: number, calibration?: CalibrationPoints | null): number | null {
  if (!calibration) return null;
  return px / calibration.pxPerM;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MovementSegment {
  /**
   * Direction convention:
   * -1 = bar moving UP
   * +1 = bar moving DOWN
   *
   * Browser/video coordinates:
   * y increases downward.
   */
  dir: -1 | 1;

  start: number;
  end: number;
  frameCount: number;
  peakSpeed: number;
  peakAbsVy: number;
  rangePx: number;
}

interface RepCandidate {
  start: number;
  end: number;
  first: MovementSegment;
  second: MovementSegment;
  frameCount: number;
  peakSpeed: number;
  rangePx: number;
}

// ─── Step 1: Build velocity frames ────────────────────────────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps: number
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const dt = 1 / fps;

  const rawSpeed: number[] = [0];
  const rawVY: number[] = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;

    rawSpeed.push(Math.sqrt(dx * dx + dy * dy) / dt);

    /**
     * velocityY > 0 = bar moving DOWN
     * velocityY < 0 = bar moving UP
     */
    rawVY.push(dy / dt);
  }

  const smoothSpeed = boxSmooth(rawSpeed, SPEED_SMOOTH_WINDOW);
  const smoothVY = boxSmooth(rawVY, VY_SMOOTH_WINDOW);

  return frames.map((f, i) => ({
    frameIndex: f.frameIndex,
    timeSeconds: f.timeSeconds,
    position: f.position,
    velocityRaw: rawSpeed[i],
    velocitySmoothed: smoothSpeed[i],
    velocityY: smoothVY[i],
    phase: "rest" as Phase,
    repIndex: null,
  }));
}

// ─── Step 2: Build active movement segments ───────────────────────────────────

function buildMovementSegments(vFrames: VelocityFrame[]): MovementSegment[] {
  if (!vFrames.length) return [];

  const globalSpeedPeak = Math.max(
    ...vFrames.map((f) => f.velocitySmoothed),
    1
  );

  const globalVyPeak = Math.max(
    ...vFrames.map((f) => Math.abs(f.velocityY)),
    1
  );

  const movingThreshold = globalSpeedPeak * MOVING_FRACTION;
  const directionThreshold = globalVyPeak * DIRECTION_FRACTION;

  const dirByFrame: Array<-1 | 1 | null> = vFrames.map((f) => {
    if (f.velocitySmoothed < movingThreshold) return null;
    if (Math.abs(f.velocityY) < directionThreshold) return null;

    return f.velocityY < 0 ? -1 : 1;
  });

  const rawSegments: MovementSegment[] = [];

  let i = 0;

  while (i < dirByFrame.length) {
    const dir = dirByFrame[i];

    if (dir === null) {
      i++;
      continue;
    }

    let j = i + 1;

    while (j < dirByFrame.length && dirByFrame[j] === dir) {
      j++;
    }

    const segment = makeSegment(vFrames, dir, i, j - 1);

    if (segment.frameCount >= MIN_SEGMENT_FRAMES) {
      rawSegments.push(segment);
    }

    i = j;
  }

  // Merge same-direction segments separated by tiny rest gaps.
  const merged: MovementSegment[] = [];

  for (const seg of rawSegments) {
    const last = merged[merged.length - 1];

    if (
      last &&
      last.dir === seg.dir &&
      seg.start - last.end - 1 <= MAX_REST_GAP_FRAMES
    ) {
      merged[merged.length - 1] = makeSegment(
        vFrames,
        last.dir,
        last.start,
        seg.end
      );
    } else {
      merged.push(seg);
    }
  }

  return merged;
}

function makeSegment(
  vFrames: VelocityFrame[],
  dir: -1 | 1,
  start: number,
  end: number
): MovementSegment {
  const frames = vFrames.slice(start, end + 1);

  return {
    dir,
    start,
    end,
    frameCount: end - start + 1,
    peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
    peakAbsVy: maxAbs(frames.map((f) => f.velocityY)),
    rangePx: range(frames.map((f) => f.position.y)),
  };
}

// ─── Step 3: Pair opposite-direction segments into rep candidates ─────────────

function buildRepCandidatesFromOffset(
  segments: MovementSegment[],
  offset: 0 | 1,
  vFrames: VelocityFrame[]
): RepCandidate[] {
  const candidates: RepCandidate[] = [];

  let i = offset;

  while (i < segments.length - 1) {
    const a = segments[i];
    const b = segments[i + 1];

    // A rep must contain two opposite-direction phases.
    if (a.dir === b.dir) {
      i++;
      continue;
    }

    const start = a.start;
    const end = b.end;
    const frames = vFrames.slice(start, end + 1);

    candidates.push({
      start,
      end,
      first: a,
      second: b,
      frameCount: end - start + 1,
      peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
      rangePx: range(frames.map((f) => f.position.y)),
    });

    i += 2;
  }

  return candidates;
}

// ─── Step 4: Candidate filters ────────────────────────────────────────────────

function basicFilterCandidates(
  candidates: RepCandidate[],
  calibration?: CalibrationPoints | null
): RepCandidate[] {
  return candidates.filter((c) => {
    const frameOk =
      c.frameCount >= MIN_REP_FRAMES &&
      c.frameCount <= MAX_REP_FRAMES;

    if (!frameOk) return false;

    /**
     * Calibrated mode:
     * use physical ROM in metres instead of pixels.
     */
    if (calibration) {
      const candidateRangeM = pxToM(c.rangePx, calibration) ?? 0;
      const firstRangeM = pxToM(c.first.rangePx, calibration) ?? 0;
      const secondRangeM = pxToM(c.second.rangePx, calibration) ?? 0;

      return (
        candidateRangeM >= MIN_REP_RANGE_M &&
        firstRangeM >= MIN_PHASE_RANGE_M &&
        secondRangeM >= MIN_PHASE_RANGE_M
      );
    }

    /**
     * Fallback mode:
     * use pixel range if there is no calibration.
     */
    return c.rangePx >= ABS_MIN_VERTICAL_RANGE_PX;
  });
}

function adaptiveFilterCandidates(
  candidates: RepCandidate[],
  calibration?: CalibrationPoints | null
): RepCandidate[] {
  const basic = basicFilterCandidates(candidates, calibration);

  if (!basic.length) return [];

  const medRange = median(basic.map((c) => c.rangePx));
  const medPeak = median(basic.map((c) => c.peakSpeed));

  return basic.filter(
    (c) =>
      c.rangePx >= medRange * MIN_RANGE_VS_MEDIAN &&
      c.peakSpeed >= medPeak * MIN_PEAK_VS_MEDIAN
  );
}

function scoreCandidates(candidates: RepCandidate[]): number {
  if (!candidates.length) return 0;

  const ranges = candidates.map((c) => c.rangePx);
  const peaks = candidates.map((c) => c.peakSpeed);

  const medRange = median(ranges);
  const medPeak = median(peaks);

  const rangeDeviation =
    medRange > 0
      ? median(ranges.map((r) => Math.abs(r - medRange))) / medRange
      : 1;

  const peakDeviation =
    medPeak > 0
      ? median(peaks.map((p) => Math.abs(p - medPeak))) / medPeak
      : 1;

  const consistency =
    (1 - Math.min(1, rangeDeviation)) * 20 +
    (1 - Math.min(1, peakDeviation)) * 10;

  // Number of reps matters most. Consistency breaks ties.
  return candidates.length * 100 + consistency;
}

function chooseBestRepCandidates(
  segments: MovementSegment[],
  vFrames: VelocityFrame[],
  calibration?: CalibrationPoints | null
): RepCandidate[] {
  /**
   * Try both possible pairings:
   *
   * Offset 0:
   *   segment 0 + segment 1
   *   segment 2 + segment 3
   *
   * Offset 1:
   *   segment 1 + segment 2
   *   segment 3 + segment 4
   *
   * This makes the detector lift-agnostic:
   * it can handle down→up reps or up→down reps.
   */
  const offset0 = adaptiveFilterCandidates(
    buildRepCandidatesFromOffset(segments, 0, vFrames),
    calibration
  );

  const offset1 = adaptiveFilterCandidates(
    buildRepCandidatesFromOffset(segments, 1, vFrames),
    calibration
  );

  const score0 = scoreCandidates(offset0);
  const score1 = scoreCandidates(offset1);

  return score1 > score0 ? offset1 : offset0;
}

// ─── Step 5: Infer concentric direction ───────────────────────────────────────

function inferConcentricDirection(candidates: RepCandidate[]): -1 | 1 {
  const upPeaks: number[] = [];
  const downPeaks: number[] = [];

  for (const c of candidates) {
    for (const seg of [c.first, c.second]) {
      if (seg.dir === -1) {
        upPeaks.push(seg.peakAbsVy);
      } else {
        downPeaks.push(seg.peakAbsVy);
      }
    }
  }

  const medUp = median(upPeaks);
  const medDown = median(downPeaks);

  /**
   * General heuristic:
   * the faster / more forceful direction is usually concentric.
   *
   * dir -1 = bar moving up
   * dir +1 = bar moving down
   */
  return medUp >= medDown ? -1 : 1;
}

// ─── Step 6: Edge trim rack/unrack candidates ─────────────────────────────────

function trimEdgeCandidates(candidates: RepCandidate[]): RepCandidate[] {
  if (candidates.length <= 1) return candidates;

  /**
   * Special case for two candidates:
   * common in one-rep videos where rack/unrack creates one extra candidate.
   */
  if (candidates.length === 2) {
    const [a, b] = candidates;
    const maxPeak = Math.max(a.peakSpeed, b.peakSpeed);
    const maxRange = Math.max(a.rangePx, b.rangePx);

    return candidates.filter(
      (c) =>
        c.peakSpeed >= maxPeak * EDGE_TRIM_FRACTION &&
        c.rangePx >= maxRange * EDGE_TRIM_FRACTION
    );
  }

  let trimmed = [...candidates];

  for (let pass = 0; pass < 3; pass++) {
    if (trimmed.length <= 2) break;

    const inner = trimmed.slice(1, -1);

    const innerMedianPeak = median(inner.map((c) => c.peakSpeed));
    const innerMedianRange = median(inner.map((c) => c.rangePx));

    let changed = false;

    const first = trimmed[0];
    if (
      first.peakSpeed < innerMedianPeak * EDGE_TRIM_FRACTION ||
      first.rangePx < innerMedianRange * EDGE_TRIM_FRACTION
    ) {
      trimmed = trimmed.slice(1);
      changed = true;
    }

    if (trimmed.length > 2) {
      const newInner = trimmed.slice(1, -1);
      const newInnerMedianPeak = median(newInner.map((c) => c.peakSpeed));
      const newInnerMedianRange = median(newInner.map((c) => c.rangePx));
      const last = trimmed[trimmed.length - 1];

      if (
        last.peakSpeed < newInnerMedianPeak * EDGE_TRIM_FRACTION ||
        last.rangePx < newInnerMedianRange * EDGE_TRIM_FRACTION
      ) {
        trimmed = trimmed.slice(0, -1);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return trimmed;
}

// ─── Step 7: Detect phases and assign reps ────────────────────────────────────

export function detectPhasesAndReps(
  vFrames: VelocityFrame[],
  options: AnalyseRepOptions = {}
): VelocityFrame[] {
  const result = vFrames.map((f) => ({
    ...f,
    phase: "rest" as Phase,
    repIndex: null as number | null,
  }));

  if (result.length < MIN_REP_FRAMES) return result;

  const segments = buildMovementSegments(result);

  if (segments.length < 2) return result;

  let candidates = chooseBestRepCandidates(
    segments,
    result,
    options.calibration
  );

  if (!candidates.length) return result;

  candidates = trimEdgeCandidates(candidates);

  if (!candidates.length) return result;

  const concentricDir = inferConcentricDirection(candidates);

  candidates.forEach((candidate, repIdx) => {
    for (let i = candidate.start; i <= candidate.end; i++) {
      const f = result[i];

      const dir = signOf(f.velocityY);

      if (dir === 0) {
        f.phase = "rest";
        f.repIndex = null;
        continue;
      }

      // Only label active frames inside the rep window.
      const isMovingEnough =
        f.velocitySmoothed >= candidate.peakSpeed * 0.10;

      if (!isMovingEnough) {
        f.phase = "rest";
        f.repIndex = null;
        continue;
      }

      f.repIndex = repIdx;
      f.phase = dir === concentricDir ? "concentric" : "eccentric";
    }
  });

  cleanTinyPhaseRuns(result);

  return result;
}

// ─── Step 8: Clean tiny phase runs ────────────────────────────────────────────

function cleanTinyPhaseRuns(frames: VelocityFrame[]): void {
  let changed = true;

  while (changed) {
    changed = false;

    let i = 0;

    while (i < frames.length) {
      const phase = frames[i].phase;
      const repIdx = frames[i].repIndex;

      let j = i + 1;

      while (
        j < frames.length &&
        frames[j].phase === phase &&
        frames[j].repIndex === repIdx
      ) {
        j++;
      }

      const len = j - i;

      if (phase !== "rest" && len < MIN_PHASE_RUN_FRAMES) {
        const prevPhase = i > 0 ? frames[i - 1].phase : "rest";
        const prevRep = i > 0 ? frames[i - 1].repIndex : null;

        const nextPhase = j < frames.length ? frames[j].phase : "rest";
        const nextRep = j < frames.length ? frames[j].repIndex : null;

        if (prevPhase !== "rest" && prevRep === repIdx) {
          for (let k = i; k < j; k++) {
            frames[k].phase = prevPhase;
          }
        } else if (nextPhase !== "rest" && nextRep === repIdx) {
          for (let k = i; k < j; k++) {
            frames[k].phase = nextPhase;
          }
        } else {
          for (let k = i; k < j; k++) {
            frames[k].phase = "rest";
            frames[k].repIndex = null;
          }
        }

        changed = true;
      }

      i = j;
    }
  }
}

// ─── Step 9: Final sanity filter + renumber ──────────────────────────────────

export function filterAndRenumber(
  vFrames: VelocityFrame[],
  options: AnalyseRepOptions = {}
): VelocityFrame[] {
  const result = vFrames.map((f) => ({ ...f }));

  const repIndices = [
    ...new Set(
      result
        .map((f) => f.repIndex)
        .filter((r): r is number => r !== null)
    ),
  ].sort((a, b) => a - b);

  if (!repIndices.length) return result;

  interface RepMetric {
    idx: number;
    frames: VelocityFrame[];
    concFrames: VelocityFrame[];
    eccFrames: VelocityFrame[];
    peakConc: number;
    peakSpeed: number;
    rangePx: number;
    rangeM: number | null;
    totalFrames: number;
  }

  let metrics: RepMetric[] = repIndices.map((idx) => {
    const frames = result.filter((f) => f.repIndex === idx);
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames = frames.filter((f) => f.phase === "eccentric");

    const rangePx = range(frames.map((f) => f.position.y));

    return {
      idx,
      frames,
      concFrames,
      eccFrames,
      peakConc: maxValue(concFrames.map((f) => f.velocitySmoothed)),
      peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
      rangePx,
      rangeM: pxToM(rangePx, options.calibration),
      totalFrames: frames.length,
    };
  });

  metrics = metrics.filter((m) => {
    const basicOk =
      m.totalFrames >= MIN_REP_FRAMES &&
      m.concFrames.length > 0 &&
      m.eccFrames.length > 0;

    if (!basicOk) return false;

    if (options.calibration && m.rangeM !== null) {
      return m.rangeM >= MIN_REP_RANGE_M;
    }

    return m.rangePx >= ABS_MIN_VERTICAL_RANGE_PX;
  });

  if (!metrics.length) {
    return result.map((f) => ({
      ...f,
      phase: "rest" as Phase,
      repIndex: null,
    }));
  }

  const medRange = median(metrics.map((m) => m.rangePx));
  const medPeak = median(metrics.map((m) => m.peakSpeed));

  metrics = metrics.filter(
    (m) =>
      m.rangePx >= medRange * MIN_RANGE_VS_MEDIAN &&
      m.peakSpeed >= medPeak * MIN_PEAK_VS_MEDIAN
  );

  if (!metrics.length) {
    return result.map((f) => ({
      ...f,
      phase: "rest" as Phase,
      repIndex: null,
    }));
  }

  const validSet = new Set(metrics.map((m) => m.idx));
  const sortedValid = [...validSet].sort((a, b) => a - b);
  const remap = new Map(sortedValid.map((oldIdx, newIdx) => [oldIdx, newIdx]));

  for (const f of result) {
    if (f.repIndex === null || !validSet.has(f.repIndex)) {
      f.phase = "rest";
      f.repIndex = null;
    } else {
      f.repIndex = remap.get(f.repIndex) ?? null;
    }
  }

  return result;
}

// ─── Step 10: Per-rep statistics ──────────────────────────────────────────────

export function computeRepStats(vFrames: VelocityFrame[]): RepStats[] {
  const repMap = new Map<number, VelocityFrame[]>();

  for (const f of vFrames) {
    if (f.repIndex === null) continue;

    if (!repMap.has(f.repIndex)) {
      repMap.set(f.repIndex, []);
    }

    repMap.get(f.repIndex)!.push(f);
  }

  const avg = (arr: VelocityFrame[]) =>
    arr.length
      ? arr.reduce((sum, f) => sum + f.velocitySmoothed, 0) / arr.length
      : 0;

  const peak = (arr: VelocityFrame[]) =>
    arr.length ? Math.max(...arr.map((f) => f.velocitySmoothed)) : 0;

  const duration = (arr: VelocityFrame[]) =>
    arr.length > 1
      ? arr[arr.length - 1].timeSeconds - arr[0].timeSeconds
      : 0;

  const stats: RepStats[] = [];

  repMap.forEach((frames, repIdx) => {
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames = frames.filter((f) => f.phase === "eccentric");

    if (
      frames.length < MIN_REP_FRAMES ||
      concFrames.length === 0 ||
      eccFrames.length === 0
    ) {
      return;
    }

    stats.push({
      repNumber: repIdx + 1,
      avgConcentricVelocity: avg(concFrames),
      avgEccentricVelocity: avg(eccFrames),
      peakConcentricVelocity: peak(concFrames),
      concentricDuration: duration(concFrames),
      eccentricDuration: duration(eccFrames),
      percentSpeedDrop: 0,
    });
  });

  stats.sort((a, b) => a.repNumber - b.repNumber);

  stats.forEach((s, i) => {
    s.repNumber = i + 1;
  });

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
  fps: number,
  options: AnalyseRepOptions = {}
): { vFrames: VelocityFrame[]; repStats: RepStats[] } {
  const withVelocity = buildVelocityFrames(frames, fps);
  const withReps = detectPhasesAndReps(withVelocity, options);
  const filtered = filterAndRenumber(withReps, options);
  const repStats = computeRepStats(filtered);

  return {
    vFrames: filtered,
    repStats,
  };
}