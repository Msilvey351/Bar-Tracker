// This file is now a thin re-export kept for backwards compatibility.
// The real velocity logic lives in repDetection.ts via buildVelocityFrames().
// VelocityChart imports VelocityFrame directly from repDetection.

export type { VelocityFrame } from "@/types";