import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RirProfileData {
  rir: number;
  avgVelocity: number;
  sampleSize: number;
}

export function useVelocityProfile(exercise: string) {
  const [profile, setProfile] = useState<RirProfileData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProfile() {
      setLoading(true);
      const supabase = createClient();

      // Fetch all sets for this exercise that have a weight and are calibrated (m/s)
      const { data, error } = await supabase
        .from("sets")
        .select(`
          id,
          velocity_unit,
          reps (
            rir,
            avg_concentric_velocity
          )
        `)
        .eq("exercise", exercise)
        .eq("velocity_unit", "m/s");

      if (error || !data) {
        console.error("Error fetching profile data:", error);
        setLoading(false);
        return;
      }

      // Group reps by RIR
      const rirBuckets: Record<number, number[]> = {};

      data.forEach((set) => {
        set.reps.forEach((rep) => {
          if (rep.rir != null && rep.avg_concentric_velocity != null) {
            // Round RIR to the nearest 0.5 to group them cleanly
            const roundedRir = Math.round(rep.rir * 2) / 2;
            
            if (!rirBuckets[roundedRir]) rirBuckets[roundedRir] = [];
            rirBuckets[roundedRir].push(rep.avg_concentric_velocity);
          }
        });
      });

      // Calculate averages and sort from 0 RIR to highest RIR
      const processedProfile: RirProfileData[] = Object.keys(rirBuckets)
        .map((key) => {
          const rir = parseFloat(key);
          const speeds = rirBuckets[rir];
          const avgVelocity = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          
          return {
            rir,
            avgVelocity,
            sampleSize: speeds.length,
          };
        })
        .sort((a, b) => a.rir - b.rir); // Sort 0 RIR (Max) at the top

      setProfile(processedProfile);
      setLoading(false);
    }

    fetchProfile();
  }, [exercise]);

  return { profile, loading };
}