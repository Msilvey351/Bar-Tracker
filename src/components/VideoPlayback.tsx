"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "@/types";
import { useCanvasOverlay } from "@/hooks/useCanvasOverlay";

interface Props {
  file:   File;
  result: AnalysisResult;
}

export default function VideoPlayback({ file, result }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const urlRef    = useRef<string | null>(null);

  const [playing,   setPlaying]   = useState(false);
  const [ready,     setReady]     = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const { draw } = useCanvasOverlay(result);

  // ── Set video source ─────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url    = URL.createObjectURL(file);
    urlRef.current = url;

    // Critical for mobile — must be set before src
    video.muted        = true;
    video.playsInline  = true;
    video.controls     = false;
    video.preload      = "auto";
    video.crossOrigin  = "anonymous";

    video.src = url;
    video.load();

    const onCanPlay = () => setReady(true);
    const onError   = () => setError("Video failed to load");

    video.addEventListener("canplay",  onCanPlay, { once: true });
    video.addEventListener("error",    onError,   { once: true });

    return () => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error",   onError);
      video.pause();
      video.src = "";
      URL.revokeObjectURL(url);
      urlRef.current = null;
    };
  }, [file]);

  // ── Canvas overlay animation loop ────────────────────────────────────────
  useEffect(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const loop = () => {
      if (video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        draw(canvas, video.currentTime);
      }
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (video.paused) {
        await video.play();
        setPlaying(true);
      } else {
        video.pause();
        setPlaying(false);
      }
    } catch (e) {
      setError(`Playback error: ${String(e)}`);
    }
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.pause();
    setPlaying(false);
  };

  const onEnded = () => setPlaying(false);

  return (
    <div className="flex flex-col gap-3">

      {/* Video container */}
      <div
        className="relative rounded-xl overflow-hidden border border-white/10 bg-black"
        style={{ minHeight: "200px" }}
      >
        {/* Loading state */}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white/40 text-sm">Loading video…</div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-red-400 text-sm px-4 text-center">{error}</div>
          </div>
        )}

        {/* Video element */}
        <video
          ref={videoRef}
          onEnded={onEnded}
          onCanPlay={() => setReady(true)}
          playsInline
          muted
          className="w-full block"
          style={{ display: ready ? "block" : "none" }}
        />

        {/* Canvas overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        />

        {/* Tap to play overlay when paused */}
        {ready && !playing && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/20"
          >
            <div className="w-16 h-16 rounded-full bg-orange-500/90 flex items-center justify-center shadow-lg">
              <span className="text-white text-2xl ml-1">▶</span>
            </div>
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={togglePlay}
          disabled={!ready}
          className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button
          onClick={restart}
          disabled={!ready}
          className="px-6 py-2.5 bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white rounded-xl transition-colors"
        >
          ↩ Restart
        </button>
      </div>

    </div>
  );
}