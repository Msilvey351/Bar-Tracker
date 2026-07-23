/** A 2-D point in video-pixel space */
export interface Point {
  x: number;
  y: number;
}

/** One tracked frame result */
export interface FrameResult {
  frameIndex: number;
  timeSeconds: number;
  position: Point;
}

/** Final analysis output */
export interface AnalysisResult {
  frames: FrameResult[];
  fps: number;
  videoWidth: number;
  videoHeight: number;
  durationSeconds: number;
}

/** App-level state machine stages */
export type AppStage = "upload" | "seed" | "analysing" | "results";

// ─── VBT / Rep detection types ────────────────────────────────────────────────

/** Movement phase for a single frame */
export type Phase = "concentric" | "eccentric" | "rest";

/** One frame with velocity + phase attached */
export interface VelocityFrame {
  frameIndex: number;
  timeSeconds: number;
  position: Point;
  /** Raw pixel/s velocity */
  velocityRaw: number;
  /** Smoothed pixel/s velocity */
  velocitySmoothed: number;
  /** Signed: negative = bar moving down (eccentric for squat/bench),
   *  positive = bar moving up (concentric for squat/bench).
   *  For deadlift the sign convention flips — handled in repDetection. */
  velocityY: number;
  phase: Phase;
  repIndex: number | null;   // null = rest/between reps
}

/** Per-rep statistics — the VBT table row */
export interface RepStats {
  repNumber: number;
  /** Average velocity during concentric phase (px/s) */
  avgConcentricVelocity: number;
  /** Average velocity during eccentric phase (px/s) */
  avgEccentricVelocity: number;
  /** Peak smoothed velocity during concentric phase (px/s) */
  peakConcentricVelocity: number;
  /** Duration of concentric phase in seconds */
  concentricDuration: number;
  /** Duration of eccentric phase in seconds */
  eccentricDuration: number;
  /** % drop from rep 1 peak concentric velocity */
  percentSpeedDrop: number;
}

/** Plate calibration — two clicked points defining plate diameter */
export interface CalibrationPoints {
  top:    Point;
  bottom: Point;
  /** Diameter in cm as entered by user */
  diameterCm: number;
  /** Derived: pixels per centimetre */
  pxPerCm: number;
  /** Derived: pixels per metre */
  pxPerM: number;
}