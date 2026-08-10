// src/app/api/telemetry/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
// We use the standard environment variables you likely already have in your .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const data = await request.json();

    // Insert the payload into our new Supabase table
    const { error } = await supabase
      .from("lift_telemetry")
      .insert({
        lift_type: data.liftType,
        total_frames: data.totalFrames,
        video_duration_seconds: data.videoDurationSeconds,
        heuristic_rep_count: data.heuristicRepCount,
        trajectory_json: data.trajectory,
      });

    if (error) {
      console.error("[Telemetry] Supabase Insert Error:", error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(
      `[Telemetry] Saved ${data.liftType} data with ${data.trajectory.length} frames to Supabase.`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Telemetry] API Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save telemetry" },
      { status: 500 }
    );
  }
}