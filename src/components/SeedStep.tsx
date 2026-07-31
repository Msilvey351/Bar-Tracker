"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Point, CalibrationPoints } from "@/types";
import { getStandardDims, stdToVideo, type StdDims } from "@/lib/videoUtils";

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

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const displayRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [ready,     setReady]     = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1 });
  const [stdDims,   setStdDims]   = useState<StdDims>({ width: 640, height: 360 });
  const [step,      setStep]      = useState<ClickStep>("bar");
  const [barPoint,  setBarPoint]  = useState<Point | null>(null);
  const [plateTop,  setPlateTop]  = useState<Point | null>(null);
  const [plateBot,  setPlateBot]  = useState<Point | null>(null);
  const [diameter,  setDiameter]  = useState<number>(45);

  /**
   * Crosshair position in STANDARD CANVAS pixels.
   * e.g. if stdDims = { width: 360, height: 640 },
   * crosshairStd = { x: 180, y: 320 } means dead centre.
   *
   * No fractions needed — the canvas IS the video at this exact resolution.
   * CSS display scaling is handled separately in getCssPos().
   */
  const crosshairStdRef = useRef({ x: 320, y: 320 });
  const [crosshairStd, setCrosshairStdState] = useState({ x: 320, y: 320 });

  const setCrosshairStd = useCallback((pos: { x: number; y: number }) => {
    crosshairStdRef.current = pos;
    setCrosshairStdState(pos);
  }, []);

  const draggingRef = useRef(false);

  // ── Load video, draw first frame to standardised canvas ───────────────────
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
      const vw  = video.videoWidth;
      const vh  = video.videoHeight;
      const std = getStandardDims(vw, vh);

      setVideoDims({ w: vw, h: vh });
      setStdDims(std);

      const canvas = displayRef.current;
      if (!canvas) return;
      canvas.width  = std.width;
      canvas.height = std.height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, std.width, std.height);

      // Centre crosshair in standard canvas pixels
      const centre = { x: std.width / 2, y: std.height / 2 };
      setCrosshairStd(centre);
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
  }, [file, setCrosshairStd]);

  /**
   * Convert CLIENT pixel (from mouse/touch) → STANDARD CANVAS pixel.
   *
   * The canvas is displayed at CSS size via width:100%.
   * We scale from CSS display pixels back to internal canvas pixels.
   * This is the ONLY coordinate conversion in the whole component.
   */
  const clientToStd = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = displayRef.current;
    if (!canvas) return crosshairStdRef.current;

    const rect   = canvas.getBoundingClientRect();

    // Scale factor: internal canvas pixels / CSS display pixels
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: Math.max(0, Math.min(canvas.width,  (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (clientY - rect.top)  * scaleY)),
    };
  }, []);

  /**
   * Convert STANDARD CANVAS pixel → CSS pixel relative to container.
   * Used only for positioning the crosshair DOM element.
   */
  const getCssPos = useCallback((stdX: number, stdY: number): { x: number; y: number } => {
    const canvas    = displayRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return { x: 0, y: 0 };

    const canvasRect    = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Scale from internal canvas pixels to CSS display pixels
    const cssScaleX = canvasRect.width  / canvas.width;
    const cssScaleY = canvasRect.height / canvas.height;

    return {
      x: (canvasRect.left - containerRect.left) + stdX * cssScaleX,
      y: (canvasRect.top  - containerRect.top)  + stdY * cssScaleY,
    };
  }, []);

  // ── Mouse drag ────────────────────────────────────────────────────────────
  const onMouseDownCrosshair = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setCrosshairStd(clientToStd(e.clientX, e.clientY));
    };
    const onMouseUp = () => { draggingRef.current = false; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [clientToStd, setCrosshairStd]);

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
      setCrosshairStd(clientToStd(t.clientX, t.clientY));
    };
    const onTouchEnd = () => { draggingRef.current = false; };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend",  onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend",  onTouchEnd);
    };
  }, [clientToStd, setCrosshairStd]);

  // ── Redraw display canvas with confirmed markers ───────────────────────────
  const redraw = useCallback((
    bar: Point | null,
    top: Point | null,
    bot: Point | null
  ) => {
    const canvas = displayRef.current;
    const video  = videoRef.current;
    if (!canvas || !video || !ready) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Redraw video frame at standard size
    ctx.drawImage(video, 0, 0, stdDims.width, stdDims.height);

    /**
     * Confirmed points are stored in NATIVE VIDEO pixels.
     * Convert to standard canvas pixels for drawing.
     */
    const toStd = (pt: Point) => ({
      x: pt.x * (stdDims.width  / videoDims.w),
      y: pt.y * (stdDims.height / videoDims.h),
    });

    const barStd = bar ? toStd(bar) : null;
    const topStd = top ? toStd(top) : null;
    const botStd = bot ? toStd(bot) : null;

    if (topStd && botStd) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(topStd.x, topStd.y);
      ctx.lineTo(botStd.x, botStd.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      ctx.font      = "bold 13px monospace";
      ctx.fillText(
        `${diameter} cm`,
        (topStd.x + botStd.x) / 2 + 10,
        (topStd.y + botStd.y) / 2
      );
    }

    const r = 12;
    if (topStd) drawMarker(ctx, topStd, "#3b82f6", "TOP", r);
    if (botStd) drawMarker(ctx, botStd, "#3b82f6", "BOT", r);
    if (barStd) drawMarker(ctx, barStd, "#f97316", "BAR", r);
  }, [stdDims, videoDims, diameter, ready]);

  function drawMarker(
    ctx:    CanvasRenderingContext2D,
    pt:     { x: number; y: number },
    colour: string,
    label:  string,
    r:      number
  ) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.strokeStyle = colour;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(pt.x - r * 1.5, pt.y); ctx.lineTo(pt.x + r * 1.5, pt.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt.x, pt.y - r * 1.5); ctx.lineTo(pt.x, pt.y + r * 1.5); ctx.stroke();

    ctx.fillStyle = colour;
    ctx.font      = "bold 12px monospace";
    ctx.fillText(label, pt.x + r + 4, pt.y - 4);
  }

  useEffect(() => {
    redraw(barPoint, plateTop, plateBot);
  }, [barPoint, plateTop, plateBot, diameter, redraw]);

  // ── Confirm ───────────────────────────────────────────────────────────────
  const handleConfirmPosition = () => {
    /**
     * Read from ref — guaranteed to be the latest value.
     * crosshairStdRef.current = position in standard canvas pixels.
     * stdToVideo converts that to native video pixels.
     */
    const pos        = crosshairStdRef.current;
    const videoPoint = stdToVideo(pos.x, pos.y, stdDims, videoDims.w, videoDims.h);

    if (step === "bar") {
      setBarPoint(videoPoint);
      setStep("plateTop");
    } else if (step === "plateTop") {
      setPlateTop(videoPoint);
      setStep("plateBottom");
    } else if (step === "plateBottom") {
      setPlateBot(videoPoint);
      setStep("done");
    }
    // Crosshair stays exactly where it is
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    const centre = { x: stdDims.width / 2, y: stdDims.height / 2 };
    setCrosshairStd(centre);
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

  // CSS position of crosshair relative to container
  const crosshairCssPos = getCssPos(crosshairStd.x, crosshairStd.y);

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

      {/* Canvas + crosshair container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-3xl rounded-xl overflow-hidden border border-white/10 bg-black select-none"
      >
        {/* Hidden video — source only */}
        <video ref={videoRef} className="hidden" playsInline muted />

        {!ready && (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">
            Loading first frame…
          </div>
        )}

        {/*
          Canvas is always stdDims wide × stdDims tall internally.
          CSS width:100% scales it to fit container.
          maxHeight caps very tall portrait videos.
          No black bars — canvas = video content exactly.
        */}
        <canvas
          ref={displayRef}
          className="w-full block"
          style={{
            display:   ready ? "block" : "none",
            maxHeight: "65vh",
          }}
        />

        {/* Draggable crosshair */}
        {ready && step !== "done" && (
          <div
            className="absolute z-20 pointer-events-auto"
            style={{
              left:        crosshairCssPos.x,
              top:         crosshairCssPos.y,
              transform:   "translate(-50%, -50%)",
              cursor:      "grab",
              touchAction: "none",
            }}
            onMouseDown={onMouseDownCrosshair}
            onTouchStart={onTouchStartCrosshair}
          >
            <div
              className="rounded-full border-2 flex items-center justify-center"
              style={{
                width:       32,
                height:      32,
                borderColor: config.colour,
                background:  config.colour + "22",
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: config.colour }} />
            </div>

            <div className="absolute top-1/2 -translate-y-1/2"
              style={{ left: -16, width: 16, height: 2, background: config.colour }} />
            <div className="absolute top-1/2 -translate-y-1/2"
              style={{ right: -16, width: 16, height: 2, background: config.colour }} />
            <div className="absolute left-1/2 -translate-x-1/2"
              style={{ top: -16, width: 2, height: 16, background: config.colour }} />
            <div className="absolute left-1/2 -translate-x-1/2"
              style={{ bottom: -16, width: 2, height: 16, background: config.colour }} />
          </div>
        )}

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

      {/* Diameter input */}
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