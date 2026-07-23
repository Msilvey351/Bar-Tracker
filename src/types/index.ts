/** A 2-D point in video-pixel space */
export interface Point {
  x: number;
  y: number;
}

/** One tracked frame result */
export interface FrameResult {
  frameIndex: number;
  timeSeconds: number;
  position: Point;        // bar centre in original video coords
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
export type AppStage =
  | "upload"
  | "seed"
  | "analysing"
  | "results";