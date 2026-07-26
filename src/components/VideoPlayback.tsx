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

  const [playing, setPlaying] = useState(false);
  const [ready,   setReady]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const { draw } = useCanvasOverlay(result);

  // ── Set video source ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset state on each new file
    setReady(false);
    setError(null);
    setPlaying(false);

    const url      = URL.createObjectURL(file);
    urlRef.current = url;

    /**
     * Set attributes directly on the element before setting src.
     * Do NOT set crossOrigin — blob URLs + crossOrigin breaks on mobile.
     */
    video.muted       = true;
    video.playsInline = true;
    video.preload     = "auto";
    video.removeAttribute("crossorigin");

    video.src = url;
    video.load();

    const onCanPlay = () => {
      setReady(true);
    };

    const onError = (e: Event) => {
      const ve   = e.target as HTMLVideoElement;
      const code = ve.error?.code ?? "?";
      const msg  = ve.error?.message ?? "unknown";
      /**
       * MediaError codes:
       * 1 = MEDIA_ERR_ABORTED
       * 2 = MEDIA_ERR_NETWORK
       * 3 = MEDIA_ERR_DECODE
       * 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
       */
      setError(`Video error ${code}: ${msg}`);
    };

    video.addEventListener("canplay", onCanPlay, { once: true });
    video.addEventListener("error",   onError,   { once: true });

    return () => {
      cancelAnimationFrame(animRef.current);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error",   onError);
      video.pause();
      video.src  = "";
      video.load();
      URL.revokeObjectURL(url);
      urlRef.current = null;
    };
  }, [file]);

  // ── Canvas overlay animation loop ──────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Video container */}
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
              <p className="text-white/30 text-xs">
                Try playing the video in a different browser,
                or re-upload the file.
              </p>
            </div>
          </div>
        )}

        {/*
          Video element.
          - playsInline is critical on iOS — without it Safari opens fullscreen
          - muted is required for autoplay on mobile
          - No crossOrigin — breaks blob URLs on mobile browsers
        */}
        <video
          ref={videoRef}
          onEnded={onEnded}
          onCanPlay={() => setReady(true)}
          playsInline
          muted
          className="w-full block"
          style={{ display: ready ? "block" : "none" }}
        />

        {/* Canvas overlay — bar path + tracking dot */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        />

        {/* Tap-to-play overlay when paused and ready */}
        {ready && !playing && (
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

      {/* Control buttons */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={togglePlay}
          disabled={!ready}
          className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button
          onClick={restart}
          disabled={!ready}
          className="px-6 py-2.5 bg-white/10 hover:bg-white/20 active:bg-white/30 disabled:bg-white/5 text-white rounded-xl transition-colors"
        >
          ↩ Restart
        </button>
      </div>

    </div>
  );
}