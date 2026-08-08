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

const MAX_REST_GAP_FRAMES = 5;
const MAX_SAME_DIRECTION_STALL_GAP_S = 2.25;
const MAX_STALL_JITTER_DURATION_S = 0.40;
const MAX_STALL_JITTER_RANGE_FRACTION = 0.25;

const MIN_SEGMENT_FRAMES = 5;
const MIN_REP_FRAMES = 10;
const MAX_REP_FRAMES = 600;

const ABS_MIN_VERTICAL_RANGE_PX = 8;
const MIN_RANGE_VS_MEDIAN = 0.40;
const MIN_PEAK_VS_MEDIAN = 0.35;
const EDGE_TRIM_FRACTION = 0.45;
const MIN_PHASE_RUN_FRAMES = 4;

const PAUSE_VELOCITY_FRACTION = 0.08;
const MIN_PAUSE_DURATION_S = 0.20;

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

function pxToM(px: number, calibration?: CalibrationPoints | null): number | null {
  if (!calibration) return null;
  return px / calibration.pxPerM;
}

function frameGapSeconds(vFrames: VelocityFrame[], prevEnd: number, nextStart: number): number {
  const a = vFrames[prevEnd];
  const b = vFrames[nextStart];
  if (!a || !b) return Infinity;
  return Math.max(0, b.timeSeconds - a.timeSeconds);
}

function segmentDurationSeconds(vFrames: VelocityFrame[], seg: MovementSegment): number {
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

// ─── Step 1: Build velocity frames + KINEMATIC CONSTRAINTS ────────────────────

export function buildVelocityFrames(
  frames: FrameResult[],
  fps: number,
  calibration?: CalibrationPoints | null
): VelocityFrame[] {
  if (frames.length < 2) return [];

  const rawSpeed: number[] = [0];
  const rawVY: number[] = [0];

  // METRIC PHYSICS RULE: Max possible accelerations
  // If scale isn't known, fallback to 250 px/m (approximate for typical phone framing)
  const pxPerM = calibration ? calibration.pxPerM : 250;
  
  // Gravity is 9.81. Allow 15 m/s² for ripping the bar down aggressively.
  const MAX_ACCEL_DOWN_M = 15.0; 
  // Human upward power limit (e.g. cleans/jerks). 
  const MAX_ACCEL_UP_M = 25.0;   

  const maxAccelDownPx = MAX_ACCEL_DOWN_M * pxPerM;
  const maxAccelUpPx = MAX_ACCEL_UP_M * pxPerM;

  let prevVy = 0;

  for (let i = 1; i < frames.length; i++) {
    let dt = frames[i].timeSeconds - frames[i - 1].timeSeconds;
    if (dt <= 0) dt = 1 / fps;

    const dx = frames[i].position.x - frames[i - 1].position.x;
    const dy = frames[i].position.y - frames[i - 1].position.y;

    let rawVy = dy / dt;
    let rawVx = dx / dt;

    // Apply Kinematic Constraint to filter out tracker glitches
    const accel = (rawVy - prevVy) / dt;

    if (accel > maxAccelDownPx) {
      // Clamping impossible downward spike
      rawVy = prevVy + maxAccelDownPx * dt;
    } else if (accel < -maxAccelUpPx) {
      // Clamping impossible upward spike
      rawVy = prevVy - maxAccelUpPx * dt;
    }

    rawSpeed.push(Math.sqrt(rawVx * rawVx + rawVy * rawVy));
    rawVY.push(rawVy);
    prevVy = rawVy;
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

function makeSegment(vFrames: VelocityFrame[], dir: -1 | 1, start: number, end: number): MovementSegment {
  const frames = vFrames.slice(start, end + 1);
  return {
    dir,
    start,
    end,
    frameCount: end - start + 1,
    peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
    peakAbsVy: maxAbs(frames.map((f) => f.velocityY)),
    rangePx: Math.abs(vFrames[start].position.y - vFrames[end].position.y),
  };
}

function combineSegments(segs: MovementSegment[], vFrames: VelocityFrame[], primaryDir: -1 | 1): MovementSegment {
  const start = segs[0].start;
  const end = segs[segs.length - 1].end;
  const frames = vFrames.slice(start, end + 1);

  return {
    dir: primaryDir,
    start,
    end,
    frameCount: end - start + 1,
    peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
    peakAbsVy: maxAbs(frames.map((f) => f.velocityY)),
    rangePx: Math.abs(vFrames[start].position.y - vFrames[end].position.y),
  };
}

function initialRawMovementSegments(vFrames: VelocityFrame[]): MovementSegment[] {
  if (!vFrames.length) return [];

  const globalSpeedPeak = Math.max(...vFrames.map((f) => f.velocitySmoothed), 1);
  const globalVyPeak = Math.max(...vFrames.map((f) => Math.abs(f.velocityY)), 1);
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
    if (dir === null) { i++; continue; }

    let j = i + 1;
    while (j < dirByFrame.length && dirByFrame[j] === dir) j++;

    const seg = makeSegment(vFrames, dir, i, j - 1);
    if (seg.frameCount >= MIN_SEGMENT_FRAMES) rawSegments.push(seg);
    i = j;
  }
  return rawSegments;
}

function mergeSameDirectionSegments(segments: MovementSegment[], vFrames: VelocityFrame[]): MovementSegment[] {
  const merged: MovementSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (!last) { merged.push(seg); continue; }

    const gapFrames = seg.start - last.end - 1;
    const gapSeconds = frameGapSeconds(vFrames, last.end, seg.start);

    if (last.dir === seg.dir && (gapFrames <= MAX_REST_GAP_FRAMES || gapSeconds <= MAX_SAME_DIRECTION_STALL_GAP_S)) {
      merged[merged.length - 1] = makeSegment(vFrames, last.dir, last.start, seg.end);
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

function swallowTinyOppositeJitter(segments: MovementSegment[], vFrames: VelocityFrame[]): MovementSegment[] {
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
      const bIsTinyRange = b.rangePx <= surroundingRange * MAX_STALL_JITTER_RANGE_FRACTION;
      const wholeGapSeconds = frameGapSeconds(vFrames, a.end, c.start);

      if (bDuration <= MAX_STALL_JITTER_DURATION_S && bIsTinyRange && wholeGapSeconds <= MAX_SAME_DIRECTION_STALL_GAP_S) {
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
  let merged = initialRawMovementSegments(vFrames);
  merged = mergeSameDirectionSegments(merged, vFrames);
  merged = swallowTinyOppositeJitter(merged, vFrames);
  merged = mergeSameDirectionSegments(merged, vFrames);
  return merged;
}

// ─── Step 3: DISPLACEMENT-BASED REP COMPILATION (Solves Grinders) ─────────────

function buildRepCandidatesByROM(
  segments: MovementSegment[],
  vFrames: VelocityFrame[],
  liftType: LiftType
): RepCandidate[] {
  const expectedFirstDir = getExpectedFirstDir(liftType);
  const candidates: RepCandidate[] = [];

  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];

    // Must start with eccentric phase
    if (seg.dir !== expectedFirstDir) {
      i++; continue;
    }

    // 1. Eccentric phase (accumulate down segments until reversal)
    const eccStartIdx = i;
    let eccEndIdx = i;
    let j = i + 1;

    while (j < segments.length && segments[j].dir === expectedFirstDir) {
      eccEndIdx = j; j++;
    }

    if (j >= segments.length) break;

    const baselineY = vFrames[segments[eccStartIdx].start].position.y;
    const bottomY = vFrames[segments[eccEndIdx].end].position.y;
    const totalRom = Math.abs(bottomY - baselineY);

    // 2. Concentric Phase: Accumulate everything until bar returns to near baseline height.
    // 80% return required to count the rep as finished.
    const targetY = baselineY + signOf(bottomY - baselineY) * (totalRom * 0.20);
    const concentricDir = expectedFirstDir === 1 ? -1 : 1;

    const concStartIdx = j;
    let concEndIdx = j;
    let k = j;

    while (k < segments.length) {
      const currentY = vFrames[segments[k].end].position.y;
      
      // Video Y increases downward. 
      // Squat Target is at TOP (small Y). 
      const passedTarget = expectedFirstDir === 1
        ? currentY <= targetY
        : currentY >= targetY;

      concEndIdx = k;

      if (passedTarget) {
        break; // Rep fully completed!
      }
      k++;
    }

    // Build the super-segments combining all the mini twitches/stalls into one fluid phase
    const firstSuper = combineSegments(segments.slice(eccStartIdx, eccEndIdx + 1), vFrames, expectedFirstDir);
    const secondSuper = combineSegments(segments.slice(concStartIdx, concEndIdx + 1), vFrames, concentricDir);

    candidates.push({
      start: firstSuper.start,
      end: secondSuper.end,
      first: firstSuper,
      second: secondSuper,
      frameCount: secondSuper.end - firstSuper.start + 1,
      peakSpeed: Math.max(firstSuper.peakSpeed, secondSuper.peakSpeed),
      rangePx: Math.abs(vFrames[firstSuper.start].position.y - vFrames[firstSuper.end].position.y)
    });

    // Skip pointer past this entire compiled rep
    i = concEndIdx + 1;
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
    const frameOk = c.frameCount >= MIN_REP_FRAMES && c.frameCount <= MAX_REP_FRAMES;
    if (!frameOk) return false;

    if (calibration) {
      const candidateRangeM = pxToM(c.rangePx, calibration) ?? 0;
      const firstRangeM = pxToM(c.first.rangePx, calibration) ?? 0;
      const secondRangeM = pxToM(c.second.rangePx, calibration) ?? 0;
      return candidateRangeM >= minRepM && firstRangeM >= minPhaseM && secondRangeM >= minPhaseM;
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
    (c) => c.rangePx >= medRange * MIN_RANGE_VS_MEDIAN && c.peakSpeed >= medPeak * MIN_PEAK_VS_MEDIAN
  );
}

// ─── Step 5: Edge trim rack/unrack ────────────────────────────────────────────

function trimEdgeCandidates(candidates: RepCandidate[]): RepCandidate[] {
  if (candidates.length <= 1) return candidates;
  if (candidates.length === 2) {
    const [a, b] = candidates;
    const maxPeak = Math.max(a.peakSpeed, b.peakSpeed);
    const maxRange = Math.max(a.rangePx, b.rangePx);
    return candidates.filter(
      (c) => c.peakSpeed >= maxPeak * EDGE_TRIM_FRACTION && c.rangePx >= maxRange * EDGE_TRIM_FRACTION
    );
  }

  let trimmed = [...candidates];
  for (let pass = 0; pass < 3; pass++) {
    if (trimmed.length <= 2) break;
    const inner = trimmed.slice(1, -1);
    const innerMedianP = median(inner.map((c) => c.peakSpeed));
    const innerMedianR = median(inner.map((c) => c.rangePx));
    let changed = false;

    if (trimmed[0].peakSpeed < innerMedianP * EDGE_TRIM_FRACTION || trimmed[0].rangePx < innerMedianR * EDGE_TRIM_FRACTION) {
      trimmed = trimmed.slice(1); changed = true;
    }
    if (trimmed.length > 2) {
      const newInner = trimmed.slice(1, -1);
      const newIMP = median(newInner.map((c) => c.peakSpeed));
      const newIMR = median(newInner.map((c) => c.rangePx));
      const last = trimmed[trimmed.length - 1];

      if (last.peakSpeed < newIMP * EDGE_TRIM_FRACTION || last.rangePx < newIMR * EDGE_TRIM_FRACTION) {
        trimmed = trimmed.slice(0, -1); changed = true;
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
      while (j < frames.length && frames[j].phase === phase && frames[j].repIndex === repIdx) j++;

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
          for (let k = i; k < j; k++) { frames[k].phase = "rest"; frames[k].repIndex = null; }
        }
        changed = true;
      }
      i = j;
    }
  }
}

function getCleanSegmentBounds(result: VelocityFrame[], seg: MovementSegment): { start: number; end: number } {
  const cutoff = seg.peakSpeed * 0.12;
  let firstActive = -1;
  let lastActive = -1;

  for (let i = seg.start; i <= seg.end; i++) {
    if (result[i].velocitySmoothed >= cutoff) {
      if (firstActive === -1) firstActive = i;
      lastActive = i;
    }
  }
  if (firstActive === -1 || lastActive === -1) return { start: seg.start, end: seg.end };
  return { start: firstActive, end: lastActive };
}

function phaseFromDirection(dir: -1 | 1): Phase {
  return dir === 1 ? "eccentric" : "concentric";
}

function assignSegmentPhase(result: VelocityFrame[], seg: MovementSegment, repIdx: number): void {
  const bounds = getCleanSegmentBounds(result, seg);
  const fallbackPhase = phaseFromDirection(seg.dir);

  for (let i = bounds.start; i <= bounds.end; i++) {
    const f = result[i];
    const dir = signOf(f.velocityY);
    f.repIndex = repIdx;

    if (dir === 0) {
      f.phase = fallbackPhase;
    } else {
      f.phase = phaseFromDirection(dir);
    }
  }
}

export function detectPhasesAndReps(vFrames: VelocityFrame[], options: AnalyseRepOptions = {}): VelocityFrame[] {
  const liftType = options.liftType ?? "squat";
  const result = vFrames.map((f) => ({ ...f, phase: "rest" as Phase, repIndex: null as number | null }));
  if (result.length < MIN_REP_FRAMES) return result;

  const segments = buildMovementSegments(result);
  if (segments.length < 2) return result;

  // New robust ROM compiler
  let candidates = buildRepCandidatesByROM(segments, result, liftType);
  if (!candidates.length) return result;

  candidates = adaptiveFilterCandidates(candidates, options.calibration, liftType);
  candidates = trimEdgeCandidates(candidates);
  if (!candidates.length) return result;

  candidates.forEach((candidate, repIdx) => {
    assignSegmentPhase(result, candidate.first, repIdx);
    assignSegmentPhase(result, candidate.second, repIdx);

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

export function filterAndRenumber(vFrames: VelocityFrame[], options: AnalyseRepOptions = {}): VelocityFrame[] {
  const liftType = options.liftType ?? "squat";
  const result = vFrames.map((f) => ({ ...f }));
  const repIndices = [...new Set(result.map((f) => f.repIndex).filter((r): r is number => r !== null))].sort((a, b) => a - b);
  if (!repIndices.length) return result;

  let metrics = repIndices.map((idx) => {
    const frames = result.filter((f) => f.repIndex === idx);
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames = frames.filter((f) => f.phase === "eccentric");
    const rangePx = range(frames.map((f) => f.position.y));

    return {
      idx, frames, concFrames, eccFrames,
      peakConc: maxValue(concFrames.map((f) => f.velocitySmoothed)),
      peakSpeed: maxValue(frames.map((f) => f.velocitySmoothed)),
      rangePx, rangeM: pxToM(rangePx, options.calibration),
      totalFrames: frames.length,
    };
  });

  metrics = metrics.filter((m) => {
    if (m.totalFrames < MIN_REP_FRAMES || m.concFrames.length === 0 || m.eccFrames.length === 0) return false;
    if (options.calibration && m.rangeM !== null) return m.rangeM >= MIN_REP_RANGE_M[liftType];
    return m.rangePx >= ABS_MIN_VERTICAL_RANGE_PX;
  });

  if (!metrics.length) return result.map((f) => ({ ...f, phase: "rest" as Phase, repIndex: null }));

  const medRange = median(metrics.map((m) => m.rangePx));
  const medPeak = median(metrics.map((m) => m.peakSpeed));

  metrics = metrics.filter(
    (m) => m.rangePx >= medRange * MIN_RANGE_VS_MEDIAN && m.peakSpeed >= medPeak * MIN_PEAK_VS_MEDIAN
  );

  if (!metrics.length) return result.map((f) => ({ ...f, phase: "rest" as Phase, repIndex: null }));

  const validSet = new Set(metrics.map((m) => m.idx));
  const sortedV = [...validSet].sort((a, b) => a - b);
  const remap = new Map(sortedV.map((old, i) => [old, i]));

  for (const f of result) {
    if (f.repIndex === null || !validSet.has(f.repIndex)) {
      f.phase = "rest"; f.repIndex = null;
    } else {
      f.repIndex = remap.get(f.repIndex) ?? null;
    }
  }
  return result;
}

// ─── Step 8: Pause detection ──────────────────────────────────────────────────

function detectPauseWithinRep(repFrames: VelocityFrame[]): { duration: number; startTime: number | null } {
  const none = { duration: 0, startTime: null };
  if (repFrames.length < 3) return none;
  const activeFrames = repFrames.filter((f) => f.phase !== "rest");
  if (activeFrames.length < 3) return none;

  const peakSpeed = Math.max(...activeFrames.map((f) => f.velocitySmoothed), 1);
  const pauseThreshold = peakSpeed * PAUSE_VELOCITY_FRACTION;
  const edgeTrim = Math.max(1, Math.floor(activeFrames.length * 0.08));
  const scanFrames = activeFrames.slice(edgeTrim, activeFrames.length - edgeTrim);

  if (scanFrames.length < 3) return none;

  let currentStart = -1, currentEnd = -1;
  let bestStart = -1, bestEnd = -1, bestDuration = 0;

  const closeRun = () => {
    if (currentStart === -1 || currentEnd === -1) return;
    const dur = scanFrames[currentEnd].timeSeconds - scanFrames[currentStart].timeSeconds;
    if (dur > bestDuration) { bestDuration = dur; bestStart = currentStart; bestEnd = currentEnd; }
    currentStart = -1; currentEnd = -1;
  };

  for (let i = 0; i < scanFrames.length; i++) {
    if (scanFrames[i].velocitySmoothed <= pauseThreshold) {
      if (currentStart === -1) currentStart = i;
      currentEnd = i;
    } else {
      closeRun();
    }
  }
  closeRun();

  if (bestDuration < MIN_PAUSE_DURATION_S || bestStart === -1 || bestEnd === -1) return none;
  return { duration: bestDuration, startTime: scanFrames[bestStart].timeSeconds };
}

// ─── Step 9: Per-rep statistics ───────────────────────────────────────────────

export function computeRepStats(vFrames: VelocityFrame[]): RepStats[] {
  const repMap = new Map<number, VelocityFrame[]>();
  for (const f of vFrames) {
    if (f.repIndex === null) continue;
    if (!repMap.has(f.repIndex)) repMap.set(f.repIndex, []);
    repMap.get(f.repIndex)!.push(f);
  }

  const avg = (arr: VelocityFrame[]) => arr.length ? arr.reduce((s, f) => s + f.velocitySmoothed, 0) / arr.length : 0;
  const peak = (arr: VelocityFrame[]) => arr.length ? Math.max(...arr.map((f) => f.velocitySmoothed)) : 0;
  const dur = (arr: VelocityFrame[]) => arr.length > 1 ? arr[arr.length - 1].timeSeconds - arr[0].timeSeconds : 0;

  const stats: RepStats[] = [];
  repMap.forEach((frames, repIdx) => {
    const concFrames = frames.filter((f) => f.phase === "concentric");
    const eccFrames = frames.filter((f) => f.phase === "eccentric");
    if (frames.length < MIN_REP_FRAMES || concFrames.length === 0 || eccFrames.length === 0) return;

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
  stats.forEach((s, i) => { s.repNumber = i + 1; });

  const rep1Avg = stats[0]?.avgConcentricVelocity ?? 1;
  for (const s of stats) {
    s.percentSpeedDrop = rep1Avg > 0 ? ((rep1Avg - s.avgConcentricVelocity) / rep1Avg) * 100 : 0;
  }
  return stats;
}

// ─── Master export ────────────────────────────────────────────────────────────

export function analyseReps(
  frames: FrameResult[],
  fps: number,
  options: AnalyseRepOptions = {}
): { vFrames: VelocityFrame[]; repStats: RepStats[] } {
  // Now passing calibration into buildVelocityFrames for Physics Rules
  const withVelocity = buildVelocityFrames(frames, fps, options.calibration);
  const withReps = detectPhasesAndReps(withVelocity, options);
  const filtered = filterAndRenumber(withReps, options);
  const repStats = computeRepStats(filtered);

  return { vFrames: filtered, repStats };
}