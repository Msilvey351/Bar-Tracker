import type {
  FrameResult,
  VelocityFrame,
  Phase,
  RepStats,
  CalibrationPoints,
  LiftType,
} from "@/types";

// ─── Public options ───────────────────────────────────────────────────────────

export interface AnalyseRepOptions {
  calibration?: CalibrationPoints | null;
  liftType?: LiftType;
}

// ─── Tuning ───────────────────────────────────────────────────────────────────

const SPEED_SMOOTH_TIME_S = 0.15;
const VY_SMOOTH_TIME_S = 0.25;

const MOVING_FRACTION = 0.04;
const DIRECTION_FRACTION = 0.06;

/**
 * Short rest gaps between same-direction segments are always merged.
 */
const MAX_REST_GAP_FRAMES = 5;

/**
 * Longer gaps are allowed inside a phase so grinders/stalled reps still count.
 *
 * Example:
 * bench press rep:
 * down → up → stall → up
 *
 * The two "up" portions should be treated as one concentric phase.
 */
const MAX_SAME_DIRECTION_STALL_GAP_S = 2.25;

/**
 * If the bar jitters very slightly in the opposite direction during a stall,
 * swallow that tiny segment and keep the rep intact.
 */
const MAX_STALL_JITTER_DURATION_S = 0.40;
const MAX_STALL_JITTER_RANGE_FRACTION = 0.25;

const MIN_SEGMENT_FRAMES = 5;
const MIN_REP_FRAMES = 10;

/**
 * Previously 180 frames could reject grinders:
 * 180 @ 60fps = only 3 seconds.
 *
 * A hard rep can take much longer, especially with a mid-rep stall.
 */
const MAX_REP_FRAMES = 600;

const ABS_MIN_VERTICAL_RANGE_PX = 8;
const MIN_RANGE_VS_MEDIAN = 0.40;
const MIN_PEAK_VS_MEDIAN = 0.35;
const EDGE_TRIM_FRACTION = 0.45;
const MIN_PHASE_RUN_FRAMES = 4;

const PAUSE_VELOCITY_FRACTION = 0.08;
const MIN_PAUSE_DURATION_S = 0.20;

/**
 * Per-lift minimum ROM in metres.
 * Deadlift has the largest ROM.
 * Bench has the smallest.
 * Squat is in between.
 */
const MIN_REP_RANGE_M: Record<LiftType, number> = {
  squat: 0.12,
  bench: 0.08,
  deadlift: 0.15,
};

const MIN_PHASE_RANGE_M: Record<LiftType, number> = {
  squat: 0.04,
  bench: 0.025,
  deadlift: 0.05,
};

/**
 * Expected direction of the FIRST segment of a rep.
 *
 * Video y increases downward.
 *
 * Squat / Bench:
 * bar goes DOWN first = eccentric = +1
 *
 * Deadlift:
 * bar goes UP first = concentric = -1
 */
function getExpectedFirstDir(liftType: LiftType): 1 | -1 {
  return liftType === "deadlift" ? -1 : 1;
}

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

function pxToM(
  px: number,
  calibration?: CalibrationPoints | null
): number | null {
  if (!calibration) return null;
  return px / calibration.pxPerM;
}

function frameGapSeconds(
  vFrames: VelocityFrame[],
  prevEnd: number,
  nextStart: number
): number {
  const a = vFrames[prevEnd];
  const b = vFrames[nextStart];

  if (!a || !b) return Infinity;

  return Math.max(0, b.timeSeconds - a.timeSeconds);
}

function segmentDurationSeconds(
  vFrames: VelocityFrame[],
  seg: MovementSegment
): number {
  const a = vFrames[seg.start];
  const b = vFrames[seg.end];

  if (!a || !b) return 0;

  return Math.max(0, b.timeSeconds - a.timeSeconds);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MovementSegment {
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

  const rawSpeed: number[] = [0];
  const rawVY: number[] = [0];

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;

    let dt = frames[i].timeSeconds - frames[i - 1].timeSeconds;
    if (dt <= 0) dt = 1 / fps;

    rawSpeed.push(Math.sqrt(dx * dx + dy * dy) / dt);
    rawVY.push(dy / dt);
  }

  let speedWindow = Math.max(3, Math.round(SPEED_SMOOTH_TIME_S * fps));
  if (speedWindow % 2 === 0) speedWindow++;

  let vyWindow = Math.max(3, Math.round(VY_SMOOTH_TIME_S * fps));
  if (vyWindow % 2 === 0) vyWindow++;

  const smoothSpeed = boxSmooth(rawSpeed, speedWindow);
  const smoothVY = boxSmooth(rawVY, vyWindow);

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

function initialRawMovementSegments(vFrames: VelocityFrame[]): MovementSegment[] {
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

    const seg = makeSegment(vFrames, dir, i, j - 1);

    if (seg.frameCount >= MIN_SEGMENT_FRAMES) {
      rawSegments.push(seg);
    }

    i = j;
  }

  return rawSegments;
}

function mergeSameDirectionSegments(
  segments: MovementSegment[],
  vFrames: VelocityFrame[]
): MovementSegment[] {
  const merged: MovementSegment[] = [];

  for (const seg of segments) {
    const last = merged[merged.length - 1];

    if (!last) {
      merged.push(seg);
      continue;
    }

    const gapFrames = seg.start - last.end - 1;
    const gapSeconds = frameGapSeconds(vFrames, last.end, seg.start);

    const shouldMerge =
      last.dir === seg.dir &&
      (gapFrames <= MAX_REST_GAP_FRAMES ||
        gapSeconds <= MAX_SAME_DIRECTION_STALL_GAP_S);

    if (shouldMerge) {
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

function swallowTinyOppositeJitter(
  segments: MovementSegment[],
  vFrames: VelocityFrame[]
): MovementSegment[] {
  if (segments.length < 3) return segments;

  const out: MovementSegment[] = [];
  let i = 0;

  while (i < segments.length) {
    const a = segments[i];
    const b = segments[i + 1];
    const c = segments[i + 2];

    if (a && b && c && a.dir === c.dir && b.dir !== a.dir) {
      const bDuration = segmentDurationSeconds(vFrames, b);
      const surroundingRange = Math.max(a.rangePx, c.rangePx, 1);
      const bIsTinyRange =
        b.rangePx <= surroundingRange * MAX_STALL_JITTER_RANGE_FRACTION;

      const wholeGapSeconds = frameGapSeconds(vFrames, a.end, c.start);

      const shouldSwallow =
        bDuration <= MAX_STALL_JITTER_DURATION_S &&
        bIsTinyRange &&
        wholeGapSeconds <= MAX_SAME_DIRECTION_STALL_GAP_S;

      if (shouldSwallow) {
        out.push(makeSegment(vFrames, a.dir, a.start, c.end));
        i += 3;
        continue;
      }
    }

    out.push(a);
    i++;
  }

  return out;
}

function buildMovementSegments(vFrames: VelocityFrame[]): MovementSegment[] {
  const raw = initialRawMovementSegments(vFrames);

  /**
   * Pass 1:
   * Merge same-direction movement separated by low-velocity gaps.
   */
  let merged = mergeSameDirectionSegments(raw, vFrames);

  /**
   * Pass 2:
   * Swallow tiny opposite-direction jitters inside a stall.
   *
   * Example:
   * up → tiny down twitch → up
   *
   * should become:
   * up
   */
  merged = swallowTinyOppositeJitter(merged, vFrames);

  /**
   * Pass 3:
   * Merge same-direction again after swallowing jitters.
   */
  merged = mergeSameDirectionSegments(merged, vFrames);

  return merged;
}

// ─── Step 3: Pair opposite segments into rep candidates ───────────────────────

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
  calibration?: CalibrationPoints | null,
  liftType: LiftType = "squat"
): RepCandidate[] {
  const minRepM = MIN_REP_RANGE_M[liftType];
  const minPhaseM = MIN_PHASE_RANGE_M[liftType];

  return candidates.filter((c) => {
    const frameOk =
      c.frameCount >= MIN_REP_FRAMES && c.frameCount <= MAX_REP_FRAMES;

    if (!frameOk) return false;

    if (calibration) {
      const candidateRangeM = pxToM(c.rangePx, calibration) ?? 0;
      const firstRangeM = pxToM(c.first.rangePx, calibration) ?? 0;
      const secondRangeM = pxToM(c.second.rangePx, calibration) ?? 0;

      return (
        candidateRangeM >= minRepM &&
        firstRangeM >= minPhaseM &&
        secondRangeM >= minPhaseM
      );
    }

    return c.rangePx >= ABS_MIN_VERTICAL_RANGE_PX;
  });
}

function adaptiveFilterCandidates(
  candidates: RepCandidate[],
  calibration?: CalibrationPoints | null,
  liftType: LiftType = "squat"
): RepCandidate[] {
  const basic = basicFilterCandidates(candidates, calibration, liftType);
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
  const medR = median(ranges);
  const medP = median(peaks);

  const rDev =
    medR > 0 ? median(ranges.map((r) => Math.abs(r - medR))) / medR : 1;

  const pDev =
    medP > 0 ? median(peaks.map((p) => Math.abs(p - medP))) / medP : 1;

  const consistency =
    (1 - Math.min(1, rDev)) * 20 + (1 - Math.min(1, pDev)) * 10;

  return candidates.length * 100 + consistency;
}

function chooseBestRepCandidates(
  segments: MovementSegment[],
  vFrames: VelocityFrame[],
  calibration?: CalibrationPoints | null,
  liftType: LiftType = "squat"
): RepCandidate[] {
  const expectedFirstDir = getExpectedFirstDir(liftType);

  const filterByDirection = (candidates: RepCandidate[]) =>
    candidates.filter((c) => c.first.dir === expectedFirstDir);

  const filtered0 = filterByDirection(
    buildRepCandidatesFromOffset(segments, 0, vFrames)
  );

  const filtered1 = filterByDirection(
    buildRepCandidatesFromOffset(segments, 1, vFrames)
  );

  const offset0 = adaptiveFilterCandidates(filtered0, calibration, liftType);
  const offset1 = adaptiveFilterCandidates(filtered1, calibration, liftType);

  const score0 = scoreCandidates(offset0);
  const score1 = scoreCandidates(offset1);

  if (score0 === 0 && score1 === 0) {
    console.warn(
      "No candidates matched expected lift direction. Falling back to unfiltered."
    );

    const fallback0 = adaptiveFilterCandidates(
      buildRepCandidatesFromOffset(segments, 0, vFrames),
      calibration,
      liftType
    );

    const fallback1 = adaptiveFilterCandidates(
      buildRepCandidatesFromOffset(segments, 1, vFrames),
      calibration,
      liftType
    );

    return scoreCandidates(fallback1) > scoreCandidates(fallback0)
      ? fallback1
      : fallback0;
  }

  return score1 > score0 ? offset1 : offset0;
}

// ─── Step 5: Edge trim rack/unrack ────────────────────────────────────────────

function trimEdgeCandidates(candidates: RepCandidate[]): RepCandidate[] {
  if (candidates.length <= 1) return candidates;

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
    const innerMedianP = median(inner.map((c) => c.peakSpeed));
    const innerMedianR = median(inner.map((c) => c.rangePx));
    let changed = false;

    if (
      trimmed[0].peakSpeed < innerMedianP * EDGE_TRIM_FRACTION ||
      trimmed[0].rangePx < innerMedianR * EDGE_TRIM_FRACTION
    ) {
      trimmed = trimmed.slice(1);
      changed = true;
    }

    if (trimmed.length > 2) {
      const newInner = trimmed.slice(1, -1);
      const newIMP = median(newInner.map((c) => c.peakSpeed));
      const newIMR = median(newInner.map((c) => c.rangePx));
      const last = trimmed[trimmed.length - 1];

      if (
        last.peakSpeed < newIMP * EDGE_TRIM_FRACTION ||
        last.rangePx < newIMR * EDGE_TRIM_FRACTION
      ) {
        trimmed = trimmed.slice(0, -1);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return trimmed;
}

// ─── Step 6: Detect phases and assign reps ────────────────────────────────────

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
          for (let k = i; k < j; k++) frames[k].phase = prevPhase;
        } else if (nextPhase !== "rest" && nextRep === repIdx) {
          for (let k = i; k < j; k++) frames[k].phase = nextPhase;
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

/**
 * Trim only the OUTER edges of a segment.
 *
 * Important:
 * This preserves low-velocity stalls INSIDE the segment.
 *
 * Old logic expanded around one peak only, which could lose:
 *
 * up → stall → up
 *
 * because it only kept the lobe around the biggest peak.
 */
function getCleanSegmentBounds(
  result: VelocityFrame[],
  seg: MovementSegment
): { start: number; end: number } {
  const cutoff = seg.peakSpeed * 0.12;

  let firstActive = -1;
  let lastActive = -1;

  for (let i = seg.start; i <= seg.end; i++) {
    if (result[i].velocitySmoothed >= cutoff) {
      if (firstActive === -1) firstActive = i;
      lastActive = i;
    }
  }

  if (firstActive === -1 || lastActive === -1) {
    return { start: seg.start, end: seg.end };
  }

  return {
    start: firstActive,
    end: lastActive,
  };
}

function phaseFromDirection(dir: -1 | 1): Phase {
  /**
   * Video y increases downward:
   * +1 = bar moving down = eccentric
   * -1 = bar moving up   = concentric
   */
  return dir === 1 ? "eccentric" : "concentric";
}

function assignSegmentPhase(
  result: VelocityFrame[],
  seg: MovementSegment,
  repIdx: number
): void {
  const bounds = getCleanSegmentBounds(result, seg);
  const fallbackPhase = phaseFromDirection(seg.dir);

  for (let i = bounds.start; i <= bounds.end; i++) {
    const f = result[i];
    const dir = signOf(f.velocityY);

    f.repIndex = repIdx;

    /**
     * During a stall, velocityY may be near zero. Keep the frame inside the
     * current phase rather than turning it into rest.
     */
    if (dir === 0) {
      f.phase = fallbackPhase;
    } else {
      f.phase = phaseFromDirection(dir);
    }
  }
}

export function detectPhasesAndReps(
  vFrames: VelocityFrame[],
  options: AnalyseRepOptions = {}
): VelocityFrame[] {
  const liftType = options.liftType ?? "squat";

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
    options.calibration,
    liftType
  );

  if (!candidates.length) return result;

  candidates = trimEdgeCandidates(candidates);
  if (!candidates.length) return result;

  candidates.forEach((candidate, repIdx) => {
    assignSegmentPhase(result, candidate.first, repIdx);
    assignSegmentPhase(result, candidate.second, repIdx);

    /**
     * The gap around the direction reversal belongs to the rep too.
     * Mark it using the nearest phase so bottom pauses do not break the rep.
     */
    const gapStart = candidate.first.end + 1;
    const gapEnd = candidate.second.start - 1;

    if (gapStart <= gapEnd) {
      const firstPhase = phaseFromDirection(candidate.first.dir);
      const secondPhase = phaseFromDirection(candidate.second.dir);
      const mid = Math.floor((gapStart + gapEnd) / 2);

      for (let i = gapStart; i <= gapEnd; i++) {
        result[i].repIndex = repIdx;
        result[i].phase = i <= mid ? firstPhase : secondPhase;
      }
    }
  });

  cleanTinyPhaseRuns(result);
  return result;
}

// ─── Step 7: Final sanity filter + renumber ──────────────────────────────────

export function filterAndRenumber(
  vFrames: VelocityFrame[],
  options: AnalyseRepOptions = {}
): VelocityFrame[] {
  const liftType = options.liftType ?? "squat";
  const result = vFrames.map((f) => ({ ...f }));

  const repIndices = [
    ...new Set(
      result.map((f) => f.repIndex).filter((r): r is number => r !== null)
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
      return m.rangeM >= MIN_REP_RANGE_M[liftType];
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
  const sortedV = [...validSet].sort((a, b) => a - b);
  const remap = new Map(sortedV.map((old, i) => [old, i]));

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

// ─── Step 8: Pause detection ──────────────────────────────────────────────────

interface PauseInfo {
  duration: number;
  startTime: number | null;
}

function detectPauseWithinRep(repFrames: VelocityFrame[]): PauseInfo {
  const none: PauseInfo = { duration: 0, startTime: null };

  if (repFrames.length < 3) return none;

  const activeFrames = repFrames.filter((f) => f.phase !== "rest");
  if (activeFrames.length < 3) return none;

  const peakSpeed = Math.max(...activeFrames.map((f) => f.velocitySmoothed), 1);
  const pauseThreshold = peakSpeed * PAUSE_VELOCITY_FRACTION;

  /**
   * Ignore tiny edge pauses at the very start/end of the rep.
   * We care about meaningful pauses inside the rep.
   */
  const edgeTrim = Math.max(1, Math.floor(activeFrames.length * 0.08));
  const scanFrames = activeFrames.slice(edgeTrim, activeFrames.length - edgeTrim);

  if (scanFrames.length < 3) return none;

  let currentStart = -1;
  let currentEnd = -1;

  let bestStart = -1;
  let bestEnd = -1;
  let bestDuration = 0;

  const closeRun = () => {
    if (currentStart === -1 || currentEnd === -1) return;

    const startFrame = scanFrames[currentStart];
    const endFrame = scanFrames[currentEnd];
    const duration = endFrame.timeSeconds - startFrame.timeSeconds;

    if (duration > bestDuration) {
      bestDuration = duration;
      bestStart = currentStart;
      bestEnd = currentEnd;
    }

    currentStart = -1;
    currentEnd = -1;
  };

  for (let i = 0; i < scanFrames.length; i++) {
    const f = scanFrames[i];
    const isPauseLike = f.velocitySmoothed <= pauseThreshold;

    if (isPauseLike) {
      if (currentStart === -1) currentStart = i;
      currentEnd = i;
    } else {
      closeRun();
    }
  }

  closeRun();

  if (
    bestDuration < MIN_PAUSE_DURATION_S ||
    bestStart === -1 ||
    bestEnd === -1
  ) {
    return none;
  }

  return {
    duration: bestDuration,
    startTime: scanFrames[bestStart].timeSeconds,
  };
}

// ─── Step 9: Per-rep statistics ───────────────────────────────────────────────

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
      ? arr.reduce((s, f) => s + f.velocitySmoothed, 0) / arr.length
      : 0;

  const peak = (arr: VelocityFrame[]) =>
    arr.length ? Math.max(...arr.map((f) => f.velocitySmoothed)) : 0;

  const dur = (arr: VelocityFrame[]) =>
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

    const pauseInfo = detectPauseWithinRep(frames);

    stats.push({
      repNumber: repIdx + 1,
      avgConcentricVelocity: avg(concFrames),
      avgEccentricVelocity: avg(eccFrames),
      peakConcentricVelocity: peak(concFrames),
      concentricDuration: dur(concFrames),
      eccentricDuration: dur(eccFrames),
      percentSpeedDrop: 0,
      pauseDuration: pauseInfo.duration,
      pauseStartTime: pauseInfo.startTime,
    });
  });

  stats.sort((a, b) => a.repNumber - b.repNumber);

  stats.forEach((s, i) => {
    s.repNumber = i + 1;
  });

  /**
   * Keep this based on average concentric velocity because it reflects grinders:
   * if a rep stalls halfway up, avg concentric drops meaningfully.
   */
  const rep1Avg = stats[0]?.avgConcentricVelocity ?? 1;

  for (const s of stats) {
    s.percentSpeedDrop =
      rep1Avg > 0 ? ((rep1Avg - s.avgConcentricVelocity) / rep1Avg) * 100 : 0;
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

  return { vFrames: filtered, repStats };
}