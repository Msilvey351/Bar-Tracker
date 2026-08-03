/** A 2-D point in video-pixel space */
export interface Point {
  x: number;
  y: number;
}

export type LiftType = "squat" | "bench" | "deadlift";

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

/** Movement phase for a single frame */
export type Phase = "concentric" | "eccentric" | "rest";

/** One frame with velocity and phase attached */
export interface VelocityFrame {
  frameIndex: number;
  timeSeconds: number;
  position: Point;
  /** Raw pixel/s speed magnitude */
  velocityRaw: number;
  /** Smoothed pixel/s speed magnitude */
  velocitySmoothed: number;
  /**
   * Signed vertical velocity in px/s.
   * Positive = bar moving DOWN (eccentric).
   * Negative = bar moving UP (concentric).
   */
  velocityY: number;
  phase: Phase;
  /** null = not part of any detected rep */
  repIndex: number | null;
}

/** Per-rep statistics shown in the VBT table */
export interface RepStats {
  repNumber: number;
  /** Average smoothed speed during concentric phase (px/s) */
  avgConcentricVelocity: number;
  /** Average smoothed speed during eccentric phase (px/s) */
  avgEccentricVelocity: number;
  /** Peak smoothed speed during concentric phase (px/s) */
  peakConcentricVelocity: number;
  /** Duration of concentric phase in seconds */
  concentricDuration: number;
  /** Duration of eccentric phase in seconds */
  eccentricDuration: number;
  /** % drop from rep 1 peak concentric velocity */
  percentSpeedDrop: number;
  /**
   * Duration of intentional pause within the rep in seconds.
   * 0 if no meaningful pause was detected.
   */
  pauseDuration: number;
  /**
   * Video timestamp (seconds) at which the pause started.
   * null if no meaningful pause was detected.
   */
  pauseStartTime: number | null;
}

/** Plate calibration from user-clicked points */
export interface CalibrationPoints {
  top: Point;
  bottom: Point;
  /** Diameter in cm as entered by user */
  diameterCm: number;
  /** Derived: pixels per centimetre */
  pxPerCm: number;
  /** Derived: pixels per metre */
  pxPerM: number;
}