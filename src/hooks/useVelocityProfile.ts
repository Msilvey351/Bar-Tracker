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

      // ✨ Calculate the date exactly 3 months ago
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      // We need to fetch workouts first to filter by date
      const { data: workouts, error: workoutError } = await supabase
        .from("workouts")
        .select("id")
        .gte("date", threeMonthsAgo.toISOString());

      if (workoutError || !workouts) {
        console.error("Error fetching workouts:", workoutError);
        setLoading(false);
        return;
      }

      const workoutIds = workouts.map(w => w.id);

      if (workoutIds.length === 0) {
        setProfile([]);
        setLoading(false);
        return;
      }

      // Now fetch sets that belong to those recent workouts
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
        .in("workout_id", workoutIds)
        .eq("exercise", exercise)
        .eq("velocity_unit", "m/s");

      if (error || !data) {
        console.error("Error fetching profile data:", error);
        setLoading(false);
        return;
      }

      const rirBuckets: Record<number, number[]> = {};

      data.forEach((set) => {
        set.reps.forEach((rep) => {
          if (rep.rir != null && rep.avg_concentric_velocity != null) {
            const roundedRir = Math.round(rep.rir * 2) / 2;
            if (!rirBuckets[roundedRir]) rirBuckets[roundedRir] = [];
            rirBuckets[roundedRir].push(rep.avg_concentric_velocity);
          }
        });
      });

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
        .sort((a, b) => a.rir - b.rir);

      setProfile(processedProfile);
      setLoading(false);
    }

    fetchProfile();
  }, [exercise]);

  return { profile, loading };
}