"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, VelocityFrame } from "@/types";
import { useCanvasOverlay } from "@/hooks/useCanvasOverlay";

interface Props {
  file: File;
  result: AnalysisResult;
  vFrames: VelocityFrame[];
}

export default function VideoPlayback({ file, result, vFrames }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // ── EXPORT REFS ────────────────────────────────────────────────────────────
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const isExportingRef = useRef(false); 
  const [isExporting, setIsExporting] = useState(false);

  const animRef = useRef<number>(0);
  const urlRef = useRef<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // To perfectly hug the video and prevent letterboxing offset
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const { draw } = useCanvasOverlay(result, vFrames);

  // ── Set video source ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(null);
    setPlaying(false);

    let cancelled = false;
    const url = URL.createObjectURL(file);
    urlRef.current = url;

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.removeAttribute("crossorigin");
    video.src = url;

    const onCanPlay = () => {
      if (!cancelled) {
        setReady(true);
        if (videoRef.current) {
          setAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
        }
      }
    };

    const onError = (e: Event) => {
      if (cancelled) return;
      const ve = e.target as HTMLVideoElement;
      const code = ve.error?.code ?? 0;
      const msg = ve.error?.message ?? "unknown";
      console.warn(`Playback Video Error ${code}: ${msg}`);
      setError(`Video error ${code}: ${msg}`);
    };

    video.addEventListener("loadedmetadata", onCanPlay, { once: true });
    video.addEventListener("error", onError, { once: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      video.removeEventListener("loadedmetadata", onCanPlay);
      video.removeEventListener("error", onError);
      video.pause();
      video.src = "";
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [file]);

  // ── Watermark Drawer ───────────────────────────────────────────────────────
  const drawWatermark = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const padding = width * 0.04;
    const fontSizeLarge = Math.max(Math.floor(width * 0.07), 24);
    const fontSizeSmall = Math.max(Math.floor(width * 0.025), 12);

    ctx.textAlign = "right";
    ctx.textBaseline = "top"; // Moved to TOP so player controls don't hide it

    // Add shadow so it's readable on bright walls/lights
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    // Draw "VELOCITY"
    ctx.font = `italic 900 ${fontSizeLarge}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillText("VELOCITY", width - padding, padding);

    // Draw "TRACKED USING"
    ctx.font = `600 ${fontSizeSmall}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText("TRACKED USING", width - padding, padding + fontSizeLarge + 5);

    // Reset shadow for other drawings
    ctx.shadowColor = "transparent";
  };

  // ── Canvas overlay & Recording loop ────────────────────────────────────────
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

        if (isExportingRef.current && exportCanvasRef.current) {
          const eCanvas = exportCanvasRef.current;
          
          if (eCanvas.width !== video.videoWidth) {
              eCanvas.width = video.videoWidth;
              eCanvas.height = video.videoHeight;
          }
          
          const eCtx = eCanvas.getContext('2d');
          if (eCtx) {
              eCtx.drawImage(video, 0, 0, eCanvas.width, eCanvas.height);
              eCtx.drawImage(canvas, 0, 0, eCanvas.width, eCanvas.height);
              drawWatermark(eCtx, eCanvas.width, eCanvas.height);
          }
        }
      }
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ── Video Export Logic ─────────────────────────────────────────────────────
  const exportVideo = async () => {
    const video = videoRef.current;
    const eCanvas = exportCanvasRef.current;
    if (!video || !eCanvas) return;

    setIsExporting(true);
    isExportingRef.current = true;

    try {
      video.pause();
      video.currentTime = 0;
      await new Promise((resolve) => setTimeout(resolve, 100)); 

      const stream = eCanvas.captureStream(30); 
      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
      }

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          
          const link = document.createElement("a");
          const dateStr = new Date().toISOString().split("T")[0];
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          
          link.download = `velocity_tracked_${dateStr}.${ext}`;
          link.href = url;
          link.click();
          
          URL.revokeObjectURL(url);
          setIsExporting(false);
          isExportingRef.current = false;
          setPlaying(false);
      };

      recorder.start();
      const handleEnd = () => {
          recorder.stop();
          video.removeEventListener('ended', handleEnd);
      };
      video.addEventListener('ended', handleEnd);
      
      await video.play();
      setPlaying(true);

    } catch (err) {
      console.error("Export failed:", err);
      setError("Failed to export video. Your browser may not support MediaRecorder.");
      setIsExporting(false);
      isExportingRef.current = false;
      setPlaying(false);
    }
  };

  const togglePlay = async () => {
    if (isExporting) return; 
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
    if (isExporting) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.pause();
    setPlaying(false);
  };

  const onEnded = () => {
    if (!isExporting) setPlaying(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 
        This container forces the Canvas to exactly match the video size 
        No letterboxing, no offset dots!
      */}
      <div
        className="w-full flex justify-center bg-black rounded-xl overflow-hidden border border-white/10"
        style={{ height: "65vh", minHeight: "300px" }}
      >
        {aspectRatio && (
          <div
            className="relative h-full flex justify-center items-center"
            style={{ aspectRatio: `${aspectRatio}`, maxWidth: "100%" }}
          >
            {/* Video element */}
            <video
              ref={videoRef}
              onEnded={onEnded}
              playsInline
              muted
              className="w-full h-full object-contain block"
              style={{ display: ready && !error ? "block" : "none" }}
            />

            {/* Visual Canvas overlay */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full block"
              style={{ pointerEvents: "none", display: error ? "none" : "block" }}
            />
            
            {/* Hidden Export Canvas */}
            <canvas ref={exportCanvasRef} className="hidden" />

            {/* Loading state */}
            {!ready && !error && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-white/40 text-sm">Loading video…</span>
                </div>
              </div>
            )}

            {/* Tap to play overlay when paused */}
            {ready && !playing && !error && !isExporting && (
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/20 z-10"
              >
                <div className="w-16 h-16 rounded-full bg-orange-500/90 flex items-center justify-center shadow-lg">
                  <span className="text-white text-2xl ml-1">▶</span>
                </div>
              </button>
            )}

            {/* Recording Overlay */}
            {isExporting && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                 <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4" />
                 <p className="text-white font-bold animate-pulse text-lg">Generating Video...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 justify-center mt-2">
        <button
          onClick={togglePlay}
          disabled={!ready || !!error || isExporting}
          className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button
          onClick={restart}
          disabled={!ready || !!error || isExporting}
          className="px-6 py-2.5 bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white rounded-xl transition-colors"
        >
          ↩ Restart
        </button>
        
        <button
          onClick={exportVideo}
          disabled={!ready || !!error || isExporting}
          className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/40 text-white font-bold rounded-xl transition-colors"
        >
          <span>📸</span> Save Video
        </button>
      </div>
    </div>
  );
}