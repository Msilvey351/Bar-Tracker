"use client";

import { useEffect, useRef, useState } from "react";
import type { Point, CalibrationPoints } from "@/types";

interface Props {
  file: File;
  onSeedSet: (point: Point, calibration: CalibrationPoints) => void;
}

type ClickStep = "bar" | "plateTop" | "plateBottom" | "done";

const STEP_CONFIG: Record<ClickStep, { label: string; colour: string; hint: string }> = {
  bar: {
    label:  "Step 1 of 3 — Click the centre of the barbell",
    colour: "#f97316",
    hint:   "Click exactly on the middle of the bar (the steel shaft, not the plate)",
  },
  plateTop: {
    label:  "Step 2 of 3 — Click the very top edge of the plate",
    colour: "#3b82f6",
    hint:   "Click the highest point of the weight plate visible in the frame",
  },
  plateBottom: {
    label:  "Step 3 of 3 — Click the very bottom edge of the plate",
    colour: "#3b82f6",
    hint:   "Click the lowest point of the same weight plate",
  },
  done: {
    label:  "All points set — ready to analyse",
    colour: "#10b981",
    hint:   "",
  },
};

export default function SeedStep({ file, onSeedSet }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [ready,     setReady]     = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1 });
  const [step,      setStep]      = useState<ClickStep>("bar");
  const [barPoint,  setBarPoint]  = useState<Point | null>(null);
  const [plateTop,  setPlateTop]  = useState<Point | null>(null);
  const [plateBot,  setPlateBot]  = useState<Point | null>(null);
  const [diameter,  setDiameter]  = useState<number>(45);

  // ── Load first frame ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const url = URL.createObjectURL(file);
    video.src     = url;
    video.muted   = true;
    video.preload = "auto";

    const onMeta = () => { video.currentTime = 0; };
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
    video.addEventListener("seeked", onSeeked);
    video.load();
    return () => {
      URL.revokeObjectURL(url);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [file]);

  // ── Redraw canvas whenever points change ──────────────────────────────────
  const redraw = (
    bar:  Point | null,
    top:  Point | null,
    bot:  Point | null
  ) => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Redraw base frame
    ctx.drawImage(video, 0, 0);

    // Draw plate calibration line
    if (top && bot) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance label
      const midX = (top.x + bot.x) / 2 + 12;
      const midY = (top.y + bot.y) / 2;
      ctx.fillStyle    = "#3b82f6";
      ctx.font         = "bold 14px monospace";
      ctx.fillText(`${diameter} cm`, midX, midY);
    }

    // Draw plate top point
    if (top) drawCrosshair(ctx, top, "#3b82f6", "TOP");

    // Draw plate bottom point
    if (bot) drawCrosshair(ctx, bot, "#3b82f6", "BOT");

    // Draw bar point (on top so it's always visible)
    if (bar) drawCrosshair(ctx, bar, "#f97316", "BAR");
  };

  function drawCrosshair(
    ctx:    CanvasRenderingContext2D,
    pt:     Point,
    colour: string,
    label:  string
  ) {
    // Circle
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 3;
    ctx.stroke();

    // Centre dot
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    // Crosshair lines
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(pt.x - 20, pt.y); ctx.lineTo(pt.x + 20, pt.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt.x, pt.y - 20); ctx.lineTo(pt.x, pt.y + 20); ctx.stroke();

    // Label
    ctx.fillStyle = colour;
    ctx.font      = "bold 12px monospace";
    ctx.fillText(label, pt.x + 16, pt.y - 8);
  }

  // ── Handle canvas click ───────────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step === "done") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = videoDims.w / rect.width;
    const scaleY = videoDims.h / rect.height;
    const pt: Point = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };

    if (step === "bar") {
      setBarPoint(pt);
      setStep("plateTop");
      redraw(pt, plateTop, plateBot);
    } else if (step === "plateTop") {
      setPlateTop(pt);
      setStep("plateBottom");
      redraw(barPoint, pt, plateBot);
    } else if (step === "plateBottom") {
      setPlateBot(pt);
      setStep("done");
      redraw(barPoint, plateTop, pt);
    }
  };

  // ── Redraw when any point updates ─────────────────────────────────────────
  useEffect(() => {
    if (ready) redraw(barPoint, plateTop, plateBot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barPoint, plateTop, plateBot, ready, diameter]);

  // ── Reset a specific point ────────────────────────────────────────────────
  const reset = () => {
    setBarPoint(null);
    setPlateTop(null);
    setPlateBot(null);
    setStep("bar");
  };

  // ── Calculate calibration and submit ─────────────────────────────────────
  const handleConfirm = () => {
    if (!barPoint || !plateTop || !plateBot) return;
    const pixelDiameter = Math.abs(plateBot.y - plateTop.y);
    const pxPerCm       = pixelDiameter / diameter;
    const pxPerM        = pxPerCm * 100;
    const calibration: CalibrationPoints = {
      top:        plateTop,
      bottom:     plateBot,
      diameterCm: diameter,
      pxPerCm,
      pxPerM,
    };
    onSeedSet(barPoint, calibration);
  };

  const config        = STEP_CONFIG[step];
  const pixelDiameter = plateTop && plateBot
    ? Math.round(Math.abs(plateBot.y - plateTop.y))
    : null;

  return (
    <div className="flex flex-col items-center gap-5">

      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold">Set Tracking Points</h2>
        <p className="text-white/40 text-sm mt-1">
          3 clicks to calibrate and track — bar point + plate top + plate bottom
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {(["bar", "plateTop", "plateBottom"] as ClickStep[]).map((s, i) => {
          const isDone    = ["bar","plateTop","plateBottom","done"].indexOf(step) > i;
          const isCurrent = step === s;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${isCurrent ? "border-orange-500 bg-orange-500 text-white"
                  : isDone  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                  :           "border-white/20 text-white/30"}
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

      {/* Canvas */}
      <div className="relative w-full max-w-3xl rounded-xl overflow-hidden border border-white/10 bg-black">
        <video ref={videoRef} className="hidden" playsInline />
        {!ready && (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">
            Loading first frame…
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className={`w-full ${ready ? "block" : "hidden"} ${step !== "done" ? "cursor-crosshair" : "cursor-default"}`}
        />

        {/* Point badges overlay */}
        {barPoint && (
          <div className="absolute top-2 left-2 bg-orange-500/90 text-white text-xs font-mono px-2 py-1 rounded-md">
            BAR ({Math.round(barPoint.x)}, {Math.round(barPoint.y)})
          </div>
        )}
      </div>

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

      {/* Confirm button */}
      {step === "done" && barPoint && plateTop && plateBot && (
        <button
          onClick={handleConfirm}
          className="px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-lg shadow-lg shadow-orange-500/20"
        >
          Start Analysis →
        </button>
      )}

      {step !== "done" && (
        <p className="text-white/25 text-sm italic">
          {step === "bar"         && "👆 Click on the barbell shaft"}
          {step === "plateTop"    && "👆 Click the top edge of the plate"}
          {step === "plateBottom" && "👆 Click the bottom edge of the plate"}
        </p>
      )}

    </div>
  );
}