import type { RirProfileData } from "@/hooks/useVelocityProfile";

// 1. Draw a line of best fit through your historical RIR data
export function getProfileTrendline(profile: RirProfileData[]) {
  if (profile.length < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  const n = profile.length;

  profile.forEach(p => {
    sumX += p.rir;
    sumY += p.avgVelocity;
    sumXY += p.rir * p.avgVelocity;
    sumX2 += p.rir * p.rir;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

// 2. Estimate today's 1RM based on a single warmup set's speed
export function calculateDaily1RM(
  weight: number, 
  repsCompleted: number, 
  avgVelocity: number, 
  profile: RirProfileData[]
): number | null {
  const trendline = getProfileTrendline(profile);
  if (!trendline) return null;

  // Find out how many RIR this velocity equals based on your trendline
  // equation: Velocity = slope * RIR + intercept  =>  RIR = (Velocity - intercept) / slope
  let estimatedRir = (avgVelocity - trendline.intercept) / trendline.slope;
  estimatedRir = Math.max(0, estimatedRir); // Can't be negative RIR

  const totalMaxReps = repsCompleted + estimatedRir;

  // Epley 1RM Formula
  const e1RM = weight * (1 + totalMaxReps / 30);
  return e1RM;
}

// 3. Prescribe weight for a target set
export function prescribeWeight(e1RM: number, targetReps: number, targetRpe: number): number {
  const targetRir = Math.max(0, 10 - targetRpe);
  const targetMaxReps = targetReps + targetRir;

  // Reverse Epley Formula
  const prescribedWeight = e1RM / (1 + targetMaxReps / 30);
  
  // Round to nearest 2.5kg (standard fractional plates)
  return Math.round(prescribedWeight / 2.5) * 2.5; 
}