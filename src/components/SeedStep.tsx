"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Point, CalibrationPoints } from "@/types";

interface Props {
  file: File;
  onSeedSet: (point: Point, calibration: CalibrationPoints) => void;
}

type ClickStep = "bar" | "plateTop" | "plateBottom" | "done";

const STEP_CONFIG: Record<ClickStep, { label: string; colour: string; hint: string }> = {
  bar: {
    label:  "Step 1 of 3 — Position the crosshair on the bar end",
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

// ─── Helper: find the actual video content area inside the element ────────────
// The video element may have black bars (letterbox/pillarbox) because the
// video's aspect ratio doesn't match the element's CSS aspect ratio.
// object-fit: contain centres the content and pads with black bars.
function getVideoContentRect(
  video:     HTMLVideoElement,
  videoDims: { w: number; h: number }
): { left: number; top: number; width: number; height: number } {
  const rect        = video.getBoundingClientRect();
  const videoAspect = videoDims.w / videoDims.h;
  const elemAspect  = rect.width  / rect.height;

  if (videoAspect > elemAspect) {
    // Wider than element → letterbox (black bars top + bottom)
    const h = rect.width / videoAspect;
    return {
      left:   rect.left,
      top:    rect.top + (rect.height - h) / 2,
      width:  rect.width,
      height: h,
    };
  } else {
    // Taller than element → pillarbox (black bars left + right)
    const w = rect.height * videoAspect;
    return {
      left:   rect.left + (rect.width - w) / 2,
      top:    rect.top,
      width:  w,
      height: rect.height,
    };
  }
}

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [ready,     setReady]     = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1 });
  const [step,      setStep]      = useState<ClickStep>("bar");
  const [barPoint,  setBarPoint]  = useState<Point | null>(null);
  const [plateTop,  setPlateTop]  = useState<Point | null>(null);
  const [plateBot,  setPlateBot]  = useState<Point | null>(null);
  const [diameter,  setDiameter]  = useState<number>(45);

  // Crosshair position in CLIENT (viewport) pixels
  const [crosshairClient, setCrosshairClient] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  // ── Centre crosshair on actual video content area ─────────────────────────
  const centreOnVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const cr = getVideoContentRect(video, videoDims);
    setCrosshairClient({
      x: cr.left + cr.width  / 2,
      y: cr.top  + cr.height / 2,
    });
  }, [videoDims]);

  // ── Load video and show first frame ───────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url         = URL.createObjectURL(file);
    video.src         = url;
    video.muted       = true;
    video.preload     = "auto";
    video.playsInline = true;

    const onMeta   = () => { video.currentTime = 0; };
    const onSeeked = () => {
      setVideoDims({ w: video.videoWidth, h: video.videoHeight });
      setReady(true);
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked",         onSeeked);
    video.load();

    return () => {
      URL.revokeObjectURL(url);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked",         onSeeked);
    };
  }, [file]);

  // ── Centre crosshair once first frame is ready ────────────────────────────
  useEffect(() => {
    if (!ready) return;
    // Delay to let the video element finish painting and layout settle
    const t = setTimeout(centreOnVideo, 80);
    return () => clearTimeout(t);
  }, [ready, centreOnVideo]);

  // ── Clamp client position to actual video content area ───────────────────
  const clampToVideo = useCallback((clientX: number, clientY: number) => {
    const video = videoRef.current;
    if (!video) return { x: clientX, y: clientY };
    const cr = getVideoContentRect(video, videoDims);
    return {
      x: Math.max(cr.left, Math.min(cr.left + cr.width,  clientX)),
      y: Math.max(cr.top,  Math.min(cr.top  + cr.height, clientY)),
    };
  }, [videoDims]);

  // ── Convert crosshair CLIENT position → VIDEO pixel coords ───────────────
  const getCrosshairVideoPoint = useCallback((): Point => {
    const video = videoRef.current!;
    const cr    = getVideoContentRect(video, videoDims);
    return {
      x: Math.max(0, Math.min(videoDims.w,
        (crosshairClient.x - cr.left) * (videoDims.w / cr.width)
      )),
      y: Math.max(0, Math.min(videoDims.h,
        (crosshairClient.y - cr.top)  * (videoDims.h / cr.height)
      )),
    };
  }, [crosshairClient, videoDims]);

  // ── Mouse drag ────────────────────────────────────────────────────────────
  const onMouseDownCrosshair = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setCrosshairClient(clampToVideo(e.clientX, e.clientY));
    };
    const onMouseUp = () => { draggingRef.current = false; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [clampToVideo]);

  // ── Touch drag ────────────────────────────────────────────────────────────
  const onTouchStartCrosshair = (e: React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
  };

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      setCrosshairClient(clampToVideo(t.clientX, t.clientY));
    };
    const onTouchEnd = () => { draggingRef.current = false; };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend",  onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend",  onTouchEnd);
    };
  }, [clampToVideo]);

  // ── Draw confirmed markers on the overlay canvas ──────────────────────────
  const redrawOverlay = useCallback((
    bar: Point | null,
    top: Point | null,
    bot: Point | null
  ) => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    canvas.width  = videoDims.w;
    canvas.height = videoDims.h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calibration line between plate top and bottom
    if (top && bot) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth   = Math.max(2, videoDims.w / 400);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      ctx.font      = `bold ${Math.max(14, videoDims.w / 80)}px monospace`;
      ctx.fillText(`${diameter} cm`, (top.x + bot.x) / 2 + 16, (top.y + bot.y) / 2);
    }

    const r = Math.max(12, videoDims.w / 80);
    if (top) drawMarker(ctx, top, "#3b82f6", "TOP", r);
    if (bot) drawMarker(ctx, bot, "#3b82f6", "BOT", r);
    if (bar) drawMarker(ctx, bar, "#f97316", "BAR", r);
  }, [videoDims, diameter]);

  function drawMarker(
    ctx:    CanvasRenderingContext2D,
    pt:     Point,
    colour: string,
    label:  string,
    r:      number
  ) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth   = Math.max(2, r / 5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.strokeStyle = colour;
    ctx.lineWidth   = Math.max(1.5, r / 8);
    ctx.beginPath(); ctx.moveTo(pt.x - r * 1.6, pt.y); ctx.lineTo(pt.x + r * 1.6, pt.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt.x, pt.y - r * 1.6); ctx.lineTo(pt.x, pt.y + r * 1.6); ctx.stroke();

    ctx.fillStyle = colour;
    ctx.font      = `bold ${Math.max(12, r)}px monospace`;
    ctx.fillText(label, pt.x + r + 4, pt.y - r * 0.5);
  }

  useEffect(() => {
    if (ready) redrawOverlay(barPoint, plateTop, plateBot);
  }, [barPoint, plateTop, plateBot, ready, diameter, redrawOverlay]);

  // ── Confirm current crosshair position ────────────────────────────────────
  const handleConfirmPosition = () => {
    const pt = getCrosshairVideoPoint();

    // Do NOT re-centre — leave crosshair where the user placed it.
    // Re-centring caused a visual jump because layout may shift on re-render.

    if (step === "bar") {
      setBarPoint(pt);
      setStep("plateTop");
    } else if (step === "plateTop") {
      setPlateTop(pt);
      setStep("plateBottom");
    } else if (step === "plateBottom") {
      setPlateBot(pt);
      setStep("done");
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    centreOnVideo();
    setBarPoint(null);
    setPlateTop(null);
    setPlateBot(null);
    setStep("bar");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!barPoint || !plateTop || !plateBot) return;
    const pixelDiameter = Math.abs(plateBot.y - plateTop.y);
    const pxPerCm       = pixelDiameter / diameter;
    const pxPerM        = pxPerCm * 100;
    onSeedSet(barPoint, {
      top:        plateTop,
      bottom:     plateBot,
      diameterCm: diameter,
      pxPerCm,
      pxPerM,
    });
  };

  const config        = STEP_CONFIG[step];
  const pixelDiameter = plateTop && plateBot
    ? Math.round(Math.abs(plateBot.y - plateTop.y))
    : null;

  // Crosshair position relative to container div for absolute CSS positioning
  const containerRect = containerRef.current?.getBoundingClientRect();
  const crosshairRelX = containerRect ? crosshairClient.x - containerRect.left : 0;
  const crosshairRelY = containerRect ? crosshairClient.y - containerRect.top  : 0;

  return (
    <div className="flex flex-col items-center gap-5">

      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">Set Tracking Points</h2>
        <p className="text-white/40 text-sm mt-1">
          Drag the crosshair · tap Confirm — 3 points total
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {(["bar", "plateTop", "plateBottom"] as ClickStep[]).map((s, i) => {
          const isDone    = ["bar", "plateTop", "plateBottom", "done"].indexOf(step) > i;
          const isCurrent = step === s;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center
                text-xs font-bold border-2 transition-all
                ${isCurrent
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
        style={{
          borderColor: config.colour + "60",
          background:  config.colour + "15",
          color:       config.colour,
        }}
      >
        {config.label}
        {config.hint && (
          <p className="text-xs font-normal mt-0.5 opacity-70">{config.hint}</p>
        )}
      </div>

      {/* Video + overlay container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-3xl rounded-xl overflow-hidden border border-white/10 bg-black select-none"
      >
        {!ready && (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">
            Loading first frame…
          </div>
        )}

        {/*
          Video element shows the first frame.
          getVideoContentRect() accounts for letterbox/pillarbox so that
          coordinates map correctly to the video content, not the black bars.
        */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full block"
          style={{ display: ready ? "block" : "none" }}
        />

        {/*
          Overlay canvas for drawing confirmed marker positions.
          Covers the video exactly. pointer-events: none so the
          draggable crosshair underneath still receives events.
        */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        />

        {/* Draggable crosshair — hidden once all points are confirmed */}
        {ready && step !== "done" && (
          <div
            className="absolute z-20 pointer-events-auto"
            style={{
              left:        crosshairRelX,
              top:         crosshairRelY,
              transform:   "translate(-50%, -50%)",
              cursor:      "grab",
              touchAction: "none",
            }}
            onMouseDown={onMouseDownCrosshair}
            onTouchStart={onTouchStartCrosshair}
          >
            {/* Outer ring */}
            <div
              className="rounded-full border-2 flex items-center justify-center"
              style={{
                width:       32,
                height:      32,
                borderColor: config.colour,
                background:  config.colour + "22",
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: config.colour }}
              />
            </div>

            {/* Horizontal arms */}
            <div className="absolute top-1/2 -translate-y-1/2"
              style={{ left: -16, width: 16, height: 2, background: config.colour }} />
            <div className="absolute top-1/2 -translate-y-1/2"
              style={{ right: -16, width: 16, height: 2, background: config.colour }} />

            {/* Vertical arms */}
            <div className="absolute left-1/2 -translate-x-1/2"
              style={{ top: -16, width: 2, height: 16, background: config.colour }} />
            <div className="absolute left-1/2 -translate-x-1/2"
              style={{ bottom: -16, width: 2, height: 16, background: config.colour }} />
          </div>
        )}

        {/* BAR coordinate badge */}
        {barPoint && (
          <div className="absolute top-2 left-2 bg-orange-500/90 text-white text-xs font-mono px-2 py-1 rounded-md z-10">
            BAR ({Math.round(barPoint.x)}, {Math.round(barPoint.y)})
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

      {/* Diameter input + calibration info */}
      <div className="w-full max-w-3xl flex flex-wrap gap-4 items-center justify-between bg-white/5 border border-white/10 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3">
          <label className="text-white/50 text-sm whitespace-nowrap">
            Plate diameter:
          </label>
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

        {pixelDiameter !== null && (
          <div className="text-xs font-mono text-white/40">
            {pixelDiameter}px = {diameter}cm →{" "}
            <span className="text-emerald-400 font-semibold">
              {(pixelDiameter / diameter).toFixed(1)} px/cm
            </span>
          </div>
        )}

        <button
          onClick={reset}
          className="text-xs text-white/30 hover:text-white/60 transition-colors underline underline-offset-2"
        >
          Reset all points
        </button>
      </div>

      {/* Start Analysis button */}
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