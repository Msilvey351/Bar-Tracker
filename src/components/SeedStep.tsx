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

/** Convert viewport CSS-pixel position to video pixel coords */
function cssToVideo(
  clientX:   number,
  clientY:   number,
  canvas:    HTMLCanvasElement,
  videoDims: { w: number; h: number }
): Point {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = videoDims.w / rect.width;
  const scaleY = videoDims.h / rect.height;
  return {
    x: Math.max(0, Math.min(videoDims.w, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(videoDims.h, (clientY - rect.top)  * scaleY)),
  };
}

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [ready,      setReady]      = useState(false);
  const [videoDims,  setVideoDims]  = useState({ w: 1, h: 1 });
  const [step,       setStep]       = useState<ClickStep>("bar");
  const [barPoint,   setBarPoint]   = useState<Point | null>(null);
  const [plateTop,   setPlateTop]   = useState<Point | null>(null);
  const [plateBot,   setPlateBot]   = useState<Point | null>(null);
  const [diameter,   setDiameter]   = useState<number>(45);

  /**
   * Crosshair position in CLIENT (viewport) pixels.
   * This is the raw clientX/Y from mouse or touch events.
   * cssToVideo() converts this to video pixel coords when needed.
   */
  const [crosshairClient, setCrosshairClient] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  // ── Load first frame ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url       = URL.createObjectURL(file);
    video.src       = url;
    video.muted     = true;
    video.preload   = "auto";
    video.playsInline = true;

    const onMeta   = () => { video.currentTime = 0; };
    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      setVideoDims({ w: video.videoWidth, h: video.videoHeight });
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);
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

  // ── Centre crosshair on canvas centre ────────────────────────────────────
  const centreCrosshair = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Use a small delay to ensure the canvas has finished layout
    setTimeout(() => {
      const rect = canvas.getBoundingClientRect();
      setCrosshairClient({
        x: rect.left + rect.width  / 2,
        y: rect.top  + rect.height / 2,
      });
    }, 50);
  }, []);

  useEffect(() => {
    if (ready) centreCrosshair();
  }, [ready, centreCrosshair]);

  // ── Clamp client position to canvas bounds ────────────────────────────────
  const clampToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(rect.left, Math.min(rect.right,  clientX)),
      y: Math.max(rect.top,  Math.min(rect.bottom, clientY)),
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
      setCrosshairClient(clampToCanvas(e.clientX, e.clientY));
    };
    const onMouseUp = () => { draggingRef.current = false; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [clampToCanvas]);

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
      setCrosshairClient(clampToCanvas(t.clientX, t.clientY));
    };
    const onTouchEnd = () => { draggingRef.current = false; };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend",  onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend",  onTouchEnd);
    };
  }, [clampToCanvas]);

  // ── Convert crosshair position to video pixel coords ─────────────────────
  const getCrosshairVideoPoint = useCallback((): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return cssToVideo(crosshairClient.x, crosshairClient.y, canvas, videoDims);
  }, [crosshairClient, videoDims]);

  // ── Redraw canvas with placed markers ────────────────────────────────────
  const redraw = useCallback((
    bar: Point | null,
    top: Point | null,
    bot: Point | null
  ) => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    if (top && bot) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      ctx.font      = "bold 14px monospace";
      ctx.fillText(`${diameter} cm`, (top.x + bot.x) / 2 + 12, (top.y + bot.y) / 2);
    }

    if (top) drawMarker(ctx, top, "#3b82f6", "TOP");
    if (bot) drawMarker(ctx, bot, "#3b82f6", "BOT");
    if (bar) drawMarker(ctx, bar, "#f97316", "BAR");
  }, [diameter]);

  function drawMarker(
    ctx:    CanvasRenderingContext2D,
    pt:     Point,
    colour: string,
    label:  string
  ) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(pt.x - 20, pt.y); ctx.lineTo(pt.x + 20, pt.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt.x, pt.y - 20); ctx.lineTo(pt.x, pt.y + 20); ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font      = "bold 12px monospace";
    ctx.fillText(label, pt.x + 16, pt.y - 8);
  }

  useEffect(() => {
    if (ready) redraw(barPoint, plateTop, plateBot);
  }, [barPoint, plateTop, plateBot, ready, diameter, redraw]);

  // ── Confirm current crosshair position ────────────────────────────────────
  const handleConfirmPosition = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect   = canvas.getBoundingClientRect();
    const scaleX = videoDims.w / rect.width;
    const scaleY = videoDims.h / rect.height;

    /**
     * Convert directly here rather than via getCrosshairVideoPoint()
     * so we can log intermediate values clearly.
     */
    const pt: Point = {
      x: Math.max(0, Math.min(videoDims.w, (crosshairClient.x - rect.left) * scaleX)),
      y: Math.max(0, Math.min(videoDims.h, (crosshairClient.y - rect.top)  * scaleY)),
    };

    console.log("Confirm position:", {
      crosshairClient,
      canvasRect: { left: rect.left, top: rect.top, w: rect.width, h: rect.height },
      videoDims,
      scaleX,
      scaleY,
      resultPoint: pt,
    });

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

    centreCrosshair();
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    setBarPoint(null);
    setPlateTop(null);
    setPlateBot(null);
    setStep("bar");
    centreCrosshair();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!barPoint || !plateTop || !plateBot) return;
    const pixelDiameter = Math.abs(plateBot.y - plateTop.y);
    const pxPerCm       = pixelDiameter / diameter;
    const pxPerM        = pxPerCm * 100;

    console.log("Submitting seed:", {
      barPoint,
      plateTop,
      plateBot,
      pixelDiameter,
      pxPerCm,
      pxPerM,
    });

    onSeedSet(barPoint, {
      top: plateTop, bottom: plateBot,
      diameterCm: diameter, pxPerCm, pxPerM,
    });
  };

  const config        = STEP_CONFIG[step];
  const pixelDiameter = plateTop && plateBot
    ? Math.round(Math.abs(plateBot.y - plateTop.y))
    : null;

  // Crosshair position relative to the container div for CSS positioning
  const containerRect = containerRef.current?.getBoundingClientRect();
  const crosshairRelX = containerRect ? crosshairClient.x - containerRect.left : 0;
  const crosshairRelY = containerRect ? crosshairClient.y - containerRect.top  : 0;

  return (
    <div className="flex flex-col items-center gap-5">

      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">Set Tracking Points</h2>
        <p className="text-white/40 text-sm mt-1">
          Drag the crosshair, then tap Confirm — 3 points total
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
        <video ref={videoRef} className="hidden" playsInline muted />

        {!ready && (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">
            Loading first frame…
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`w-full ${ready ? "block" : "hidden"}`}
        />

        {/* Draggable crosshair */}
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
            step === "bar"         ? "Bar Position"  :
            step === "plateTop"    ? "Plate Top"     :
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