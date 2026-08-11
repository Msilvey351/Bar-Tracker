import { VelocityFrame, LiftType } from "@/types";

export interface LiftTelemetryPayload {
  liftType: LiftType;
  totalFrames: number;
  videoDurationSeconds: number;
  heuristicRepCount: number;
  isEdited?: boolean;        // <-- NEW FLAG
  originalRepCount?: number; // <-- NEW FLAG
  trajectory: {
    t: number; // timeSeconds
    x: number; // x position
    y: number; // y position
    p: string; // phase (rest, eccentric, concentric) - Weak label from math
  }[];
}

export async function saveLiftTelemetry(
  liftType: LiftType,
  vFrames: VelocityFrame[],
  heuristicRepCount: number,
  isEdited: boolean = false, // <-- NEW FLAG
  originalRepCount?: number  // <-- NEW FLAG
) {
  try {
    // 1. Strip down the giant vFrames array into a tiny, ML-friendly format
    const trajectory = vFrames.map((f) => ({
      t: Number(f.timeSeconds.toFixed(3)),
      x: Number(f.position.x.toFixed(2)),
      y: Number(f.position.y.toFixed(2)),
      p: f.phase.charAt(0), // 'r' for rest, 'e' for eccentric, 'c' for concentric
    }));

    const payload: LiftTelemetryPayload = {
      liftType,
      totalFrames: vFrames.length,
      videoDurationSeconds: vFrames[vFrames.length - 1]?.timeSeconds || 0,
      heuristicRepCount,
      isEdited,             // <-- ADDED TO PAYLOAD
      originalRepCount,     // <-- ADDED TO PAYLOAD
      trajectory,
    };
    
    console.log("🚀 [Telemetry] Sending payload to API...", payload);

    // 2. Fire and forget (don't await it so it doesn't block the UI)
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("Telemetry upload failed:", err));

  } catch (error) {
    console.error("Failed to compile telemetry payload:", error);
  }
}