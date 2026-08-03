"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Point, CalibrationPoints, LiftType } from "@/types";

interface Props {
  file: File;
  onSeedSet: (point: Point, calibration: CalibrationPoints, liftType: LiftType) => void;
}

type ClickStep = "bar" | "plateTop" | "plateBottom" | "done";

const STEP_CONFIG: Record<ClickStep, { label: string; colour: string; hint: string }> = {
  bar: {
    label:  "Step 1 of 3 — Position the crosshair on the weights",
    colour: "#f97316",
    hint:   "Drag to move · tap Confirm when centred on the barbell sleeve",
  },
  plateTop: {
    label:  "Step 2 of 3 — Position the crosshair on the top of the plate",
    colour: "#3b82f6",
    hint:   "Drag to move · tap Confirm when on the very top edge of the plate",
  },
  plateBottom: {
    label:  "Step 3 of 3 — Position the crosshair on the bottom of the plate",
    colour: "#3b82f6",
    hint:   "Drag to move · tap Confirm when on the very bottom edge of the plate",
  },
  done: {
    label:  "All points set — ready to analyse",
    colour: "#10b981",
    hint:   "",
  },
};

const LIFTS: { id: LiftType; label: string; icon: string; hint: string }[] = [
  { id: "squat",    label: "Squat",    icon: "🏋️", hint: "Bar goes down first" },
  { id: "bench",    label: "Bench",    icon: "🔴",  hint: "Bar goes down first" },
  { id: "deadlift", label: "Deadlift", icon: "⬆️",  hint: "Bar goes up first"  },
];

function getDisplayedVideoSize(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
) {
  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;

  if (videoAspect > containerAspect) {
    return { w: containerW, h: containerW / videoAspect };
  } else {
    return { w: containerH * videoAspect, h: containerH };
  }
}

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);

  const [ready,           setReady]           = useState(false);
  const [videoNativeDims, setVideoNativeDims] = useState({ w: 1, h: 1 });
  const [step,            setStep]            = useState<ClickStep>("bar");
  const [barPoint,        setBarPoint]        = useState<Point | null>(null);
  const [plateTop,        setPlateTop]        = useState<Point | null>(null);
  const [plateBot,        setPlateBot]        = useState<Point | null>(null);
  const [diameter,        setDiameter]        = useState<number>(45);
  const [liftType,        setLiftType]        = useState<LiftType>("squat");
  const [crosshairPos,    setCrosshairPos]    = useState({ x: 0, y: 0 });

  const crosshairPosRef = useRef({ x: 0, y: 0 });
  const draggingRef     = useRef(false);

  const updateCrosshair = useCallback((x: number, y: number) => {
    crosshairPosRef.current = { x, y };
    setCrosshairPos({ x, y });
  }, []);

  // ── Load Video ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url = URL.createObjectURL(file);
    video.src          = url;
    video.defaultMuted = true;
    video.muted        = true;
    video.playsInline  = true;
    video.preload      = "auto";

    let isReadyLocal = false;

    const handleReady = () => {
      // Wait until we actually have video dimensions
      if (!isReadyLocal && video.videoWidth && video.videoHeight) {
        isReadyLocal = true;
        
        // 1. The frame is decoded! Instantly pause playback.
        video.pause();
        
        // 2. Now that the media engine is fully running and the buffer is loaded, 
        //    seeking to 0 is perfectly safe and won't hang Android.
        video.currentTime = 0; 
        
        setVideoNativeDims({ w: video.videoWidth, h: video.videoHeight });
        setReady(true);
      }
    };

    const onTimeUpdate = () => {
      // If playback advances at all, we know it's decoding
      if (video.currentTime > 0) handleReady();
    };

    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("playing",    handleReady);
    video.addEventListener("timeupdate", onTimeUpdate);

    // THE FIX: Actually play the video sequentially to bypass the Blob range-request bug.
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // If strict autoplay policies blocked it, fallback to the standard seek
        console.warn("Autoplay blocked, falling back to seek", err);
        video.currentTime = 0.1;
      });
    }

    const fallback = setInterval(() => {
      if (video.readyState >= 2 && video.videoWidth) {
        handleReady();
        clearInterval(fallback);
      }
    }, 250);

    return () => {
      URL.revokeObjectURL(url);
      clearInterval(fallback);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("playing",    handleReady);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [file]);

  // ── Center Crosshair on Load ────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    
    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const cRect     = container.getBoundingClientRect();
      const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);
      updateCrosshair(displayed.w / 2, displayed.h / 2);
    }, 50);
  }, [ready, videoNativeDims, updateCrosshair]);

  // ── Coordinate Conversion ───────────────────────────────────────────────────
  const getEventToVideoCssCoords = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };

    const cRect     = container.getBoundingClientRect();
    const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);
    const xOffset   = (cRect.width  - displayed.w) / 2;
    const yOffset   = (cRect.height - displayed.h) / 2;

    return {
      x: Math.max(0, Math.min(displayed.w, clientX - cRect.left  - xOffset)),
      y: Math.max(0, Math.min(displayed.h, clientY - cRect.top   - yOffset)),
    };
  }, [videoNativeDims]);

  // ── Drag Handlers ───────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const c = getEventToVideoCssCoords(e.clientX, e.clientY);
    updateCrosshair(c.x, c.y);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const c = getEventToVideoCssCoords(e.clientX, e.clientY);
      updateCrosshair(c.x, c.y);
    };
    const onMouseUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [getEventToVideoCssCoords, updateCrosshair]);

  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const t = e.touches[0];
    const c = getEventToVideoCssCoords(t.clientX, t.clientY);
    updateCrosshair(c.x, c.y);
  };

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      const c = getEventToVideoCssCoords(t.clientX, t.clientY);
      updateCrosshair(c.x, c.y);
    };
    const onTouchEnd = () => { draggingRef.current = false; };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend",  onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend",  onTouchEnd);
    };
  }, [getEventToVideoCssCoords, updateCrosshair]);

  // ── Draw Confirmed Markers ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas    = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !ready) return;

    const ctx   = canvas.getContext("2d");
    if (!ctx) return;

    const cRect     = container.getBoundingClientRect();
    canvas.width    = cRect.width;
    canvas.height   = cRect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);
    const xOffset   = (cRect.width  - displayed.w) / 2;
    const yOffset   = (cRect.height - displayed.h) / 2;

    const nativeToCss = (pt: Point) => ({
      x: (pt.x / videoNativeDims.w) * displayed.w + xOffset,
      y: (pt.y / videoNativeDims.h) * displayed.h + yOffset,
    });

    const barCss = barPoint ? nativeToCss(barPoint) : null;
    const topCss = plateTop ? nativeToCss(plateTop) : null;
    const botCss = plateBot ? nativeToCss(plateBot) : null;

    if (topCss && botCss) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(topCss.x, topCss.y);
      ctx.lineTo(botCss.x, botCss.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      ctx.font      = "bold 13px monospace";
      ctx.fillText(`${diameter} cm`, (topCss.x + botCss.x) / 2 + 10, (topCss.y + botCss.y) / 2);
    }

    const drawMarker = (pt: Point, colour: string, label: string) => {
      const r = 12;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pt.x - r * 1.5, pt.y); ctx.lineTo(pt.x + r * 1.5, pt.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y - r * 1.5); ctx.lineTo(pt.x, pt.y + r * 1.5); ctx.stroke();
      ctx.fillStyle = colour; ctx.font = "bold 12px monospace";
      ctx.fillText(label, pt.x + r + 4, pt.y - 4);
    };

    if (topCss) drawMarker(topCss, "#3b82f6", "TOP");
    if (botCss) drawMarker(botCss, "#3b82f6", "BOT");
    if (barCss) drawMarker(barCss, "#f97316", "BAR");
  }, [barPoint, plateTop, plateBot, diameter, ready, videoNativeDims]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleConfirmPosition = () => {
    const container = containerRef.current;
    if (!container) return;

    const cRect     = container.getBoundingClientRect();
    const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);

    const nativePoint = {
      x: (crosshairPosRef.current.x / displayed.w) * videoNativeDims.w,
      y: (crosshairPosRef.current.y / displayed.h) * videoNativeDims.h,
    };

    if (step === "bar") {
      setBarPoint(nativePoint);
      setStep("plateTop");
    } else if (step === "plateTop") {
      setPlateTop(nativePoint);
      setStep("plateBottom");
    } else if (step === "plateBottom") {
      setPlateBot(nativePoint);
      setStep("done");
    }
  };

  const reset = () => {
    setBarPoint(null);
    setPlateTop(null);
    setPlateBot(null);
    setStep("bar");

    const container = containerRef.current;
    if (container) {
      const cRect     = container.getBoundingClientRect();
      const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);
      updateCrosshair(displayed.w / 2, displayed.h / 2);
    }
  };

  const handleSubmit = () => {
    if (!barPoint || !plateTop || !plateBot) return;
    const pixelDiameter = Math.abs(plateBot.y - plateTop.y);
    const pxPerCm       = pixelDiameter / diameter;
    onSeedSet(
      barPoint,
      { top: plateTop, bottom: plateBot, diameterCm: diameter, pxPerCm, pxPerM: pxPerCm * 100 },
      liftType          // ← pass lift type
    );
  };

  const config = STEP_CONFIG[step];

  // Crosshair absolute position
  let crosshairAbsoluteX = 0;
  let crosshairAbsoluteY = 0;
  if (containerRef.current) {
    const cRect     = containerRef.current.getBoundingClientRect();
    const displayed = getDisplayedVideoSize(cRect.width, cRect.height, videoNativeDims.w, videoNativeDims.h);
    crosshairAbsoluteX = crosshairPos.x + (cRect.width  - displayed.w) / 2;
    crosshairAbsoluteY = crosshairPos.y + (cRect.height - displayed.h) / 2;
  }

  return (
    <div className="flex flex-col items-center gap-5">

      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">Set Tracking Points</h2>
        <p className="text-white/40 text-sm mt-1">
          Select your lift, drag the crosshair, then tap Confirm — 3 points total
        </p>
      </div>

      {/* ── Lift Type Selector ── */}
      <div className="w-full max-w-3xl">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
          Lift Type
        </p>
        <div className="flex gap-2">
          {LIFTS.map((lift) => (
            <button
              key={lift.id}
              onClick={() => setLiftType(lift.id)}
              className={`
                flex-1 py-3 rounded-xl border-2 font-semibold text-sm
                transition-all flex flex-col items-center gap-1
                ${liftType === lift.id
                  ? "border-orange-500 bg-orange-500/20 text-orange-400"
                  : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/70"
                }
              `}
            >
              <span className="text-xl">{lift.icon}</span>
              <span>{lift.label}</span>
              <span className="text-xs font-normal opacity-60">{lift.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {(["bar", "plateTop", "plateBottom"] as ClickStep[]).map((s, i) => {
          const isDone = ["bar", "plateTop", "plateBottom", "done"].indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center
                text-xs font-bold border-2 transition-all
                ${step === s
                  ? "border-orange-500 bg-orange-500 text-white"
                  : isDone
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                  : "border-white/20 text-white/30"
                }
              `}>
                {isDone ? "✓" : i + 1}
              </div>
              {i < 2 && <div className="w-6 h-px bg-white/20" />}
            </div>
          );
        })}
      </div>

      {/* Instruction banner */}
      <div
        className="w-full max-w-3xl px-4 py-3 rounded-xl border text-sm font-medium text-center transition-all"
        style={{ borderColor: config.colour + "60", background: config.colour + "15", color: config.colour }}
      >
        {config.label}
        {config.hint && <p className="text-xs font-normal mt-0.5 opacity-70">{config.hint}</p>}
      </div>

      {/* Video Container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-3xl rounded-xl overflow-hidden border border-white/10 bg-black select-none"
        style={{ height: "65vh" }}
      >
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-white/40 text-sm">
            Loading first frame…
          </div>
        )}

        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-contain"
        />


        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        />

        {/* Draggable crosshair */}
        {ready && step !== "done" && (
          <div
            className="absolute z-20 pointer-events-auto"
            style={{
              left:        crosshairAbsoluteX,
              top:         crosshairAbsoluteY,
              transform:   "translate(-50%, -50%)",
              cursor:      "grab",
              touchAction: "none",
            }}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
          >
            <div
              className="rounded-full border-2 flex items-center justify-center"
              style={{ width: 32, height: 32, borderColor: config.colour, background: config.colour + "22" }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: config.colour }} />
            </div>
            <div className="absolute top-1/2 -translate-y-1/2" style={{ left: -16, width: 16, height: 2, background: config.colour }} />
            <div className="absolute top-1/2 -translate-y-1/2" style={{ right: -16, width: 16, height: 2, background: config.colour }} />
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: -16, width: 2, height: 16, background: config.colour }} />
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -16, width: 2, height: 16, background: config.colour }} />
          </div>
        )}
      </div>

      {/* Confirm button */}
      {ready && step !== "done" && (
        <button
          onClick={handleConfirmPosition}
          className="px-8 py-3 font-bold rounded-xl transition-colors text-white text-base shadow-lg"
          style={{ background: config.colour }}
        >
          ✓ Confirm {
            step === "bar"         ? "Bar Position" :
            step === "plateTop"    ? "Plate Top"    :
                                     "Plate Bottom"
          }
        </button>
      )}

      {/* Diameter input */}
      <div className="w-full max-w-3xl flex flex-wrap gap-4 items-center justify-between bg-white/5 border border-white/10 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3">
          <label className="text-white/50 text-sm whitespace-nowrap">Plate diameter:</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={diameter}
              onChange={(e) => setDiameter(Number(e.target.value))}
              min={10}
              max={100}
              step={0.5}
              className="w-20 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm font-mono text-center focus:outline-none focus:border-orange-500"
            />
            <span className="text-white/40 text-sm">cm</span>
          </div>
        </div>
        <button
          onClick={reset}
          className="text-xs text-white/30 hover:text-white/60 transition-colors underline underline-offset-2"
        >
          Reset all points
        </button>
      </div>

      {/* Start Analysis */}
      {step === "done" && barPoint && plateTop && plateBot && (
        <button
          onClick={handleSubmit}
          className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-lg shadow-lg shadow-orange-500/20"
        >
          Start Analysis →
        </button>
      )}

    </div>
  );
}