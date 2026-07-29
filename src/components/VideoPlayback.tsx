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
  const urlRef = useRef<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { draw } = useCanvasOverlay(result);

  // ── Set video source ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(null);
    setPlaying(false);

    // Clean up previous URL
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }

    let cancelled = false;

    // Create URL
    const url = URL.createObjectURL(file);
    urlRef.current = url;

    // Critical for iOS/Mobile
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = "auto";
    video.removeAttribute("crossorigin"); // Must not be present for blob URLs

    // Apply src
    video.src = url;
    video.load();

    const onCanPlay = () => {
      if (!cancelled) setReady(true);
    };

    const onError = (e: Event) => {
      if (cancelled) return;
      const ve = e.target as HTMLVideoElement;
      const code = ve.error?.code ?? 0;
      const msg = ve.error?.message ?? "unknown";
      
      console.warn(`Playback Video Error ${code}: ${msg}`);
      
      // Don't show scary error immediately if it's just a warning
      if (code === 4) {
          setError(`Video playback not supported by browser (Code 4)`);
      } else {
          setError(`Video error ${code}: ${msg}`);
      }
    };

    video.addEventListener("canplay", onCanPlay, { once: true });
    video.addEventListener("error", onError, { once: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [file]);

  // ── Canvas overlay animation loop ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const loop = () => {
      if (video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        draw(canvas, video.currentTime);
      }
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ── Controls ───────────────────────────────────────────────────────────────
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
      setError(`Playback failed: ${String(e)}`);
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
      <div
        className="relative rounded-xl overflow-hidden border border-white/10 bg-black"
        style={{ minHeight: "200px" }}
      >
        {/* Loading state */}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-white/40 text-sm">Loading video…</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 px-6">
            <div className="text-center">
              <p className="text-red-400 text-sm mb-3">{error}</p>
            </div>
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
          style={{ display: ready && !error ? "block" : "none" }}
        />

        {/* Canvas overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none", display: error ? "none" : "block" }}
        />

        {/* Tap to play overlay when paused */}
        {ready && !playing && !error && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/20 z-10"
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
          disabled={!ready || !!error}
          className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button
          onClick={restart}
          disabled={!ready || !!error}
          className="px-6 py-2.5 bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white rounded-xl transition-colors"
        >
          ↩ Restart
        </button>
      </div>
    </div>
  );
}