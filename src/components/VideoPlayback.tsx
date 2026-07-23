"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "@/types";
import { useCanvasOverlay } from "@/hooks/useCanvasOverlay";

interface Props {
  file: File;
  result: AnalysisResult;
}

export default function VideoPlayback({ file, result }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const { draw } = useCanvasOverlay(result);

  // Set video source
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const url = URL.createObjectURL(file);
    video.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Animation loop: sync canvas overlay with video time
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const loop = () => {
      if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      draw(canvas, video.currentTime);
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); setPlaying(true); }
    else { video.pause(); setPlaying(false); }
  };

  const onEnded = () => setPlaying(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black">
        <video
          ref={videoRef}
          onEnded={onEnded}
          playsInline
          className="w-full block"
        />
        {/* Canvas overlay — absolutely positioned on top of video */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      </div>
      <div className="flex gap-3 justify-center">
        <button
          onClick={togglePlay}
          className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) { v.currentTime = 0; v.pause(); setPlaying(false); }
          }}
          className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
        >
          ↩ Restart
        </button>
      </div>
    </div>
  );
}