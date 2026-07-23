"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@/types";

interface Props {
  file: File;
  onSeedSet: (point: Point) => void;
}

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seed, setSeed] = useState<Point | null>(null);
  const [ready, setReady] = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1 });

  // Load video and draw first frame to canvas
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.preload = "auto";

    const onLoaded = async () => {
      setVideoDims({ w: video.videoWidth, h: video.videoHeight });
      video.currentTime = 0;
    };
    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);
      setReady(true);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("seeked", onSeeked);
    video.load();

    return () => {
      URL.revokeObjectURL(url);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [file]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = videoDims.w / rect.width;
    const scaleY = videoDims.h / rect.height;
    const point: Point = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
    setSeed(point);

    // Draw crosshair
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Redraw video frame first to clear old crosshair
    const video = videoRef.current;
    if (video) ctx.drawImage(video, 0, 0);
    // Orange circle
    ctx.beginPath();
    ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 3;
    ctx.stroke();
    // White centre dot
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    // Crosshair lines
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(point.x - 22, point.y); ctx.lineTo(point.x + 22, point.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(point.x, point.y - 22); ctx.lineTo(point.x, point.y + 22); ctx.stroke();
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div>
        <h2 className="text-2xl font-bold text-center">Mark the Barbell</h2>
        <p className="text-white/50 text-center mt-1 text-sm">
          Click exactly on the centre of the barbell in the first frame
        </p>
      </div>

      <div className="relative w-full max-w-3xl rounded-xl overflow-hidden border border-white/10 bg-black">
        {/* Hidden video used only for frame capture */}
        <video ref={videoRef} className="hidden" playsInline />
        {!ready && (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">
            Loading first frame…
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className={`w-full cursor-crosshair ${ready ? "block" : "hidden"}`}
        />
        {seed && (
          <div className="absolute top-3 left-3 bg-orange-500/90 text-white text-xs font-mono px-2 py-1 rounded-md">
            Seed: ({Math.round(seed.x)}, {Math.round(seed.y)})
          </div>
        )}
      </div>

      {seed ? (
        <button
          onClick={() => onSeedSet(seed)}
          className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-lg shadow-lg shadow-orange-500/20"
        >
          Start Analysis →
        </button>
      ) : (
        <p className="text-white/30 text-sm italic">👆 Click on the barbell to set tracking point</p>
      )}
    </div>
  );
}