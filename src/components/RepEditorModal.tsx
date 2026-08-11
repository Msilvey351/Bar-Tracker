"use client";

import { useEffect, useRef, useState } from "react";
import type { VelocityFrame, RepStats } from "@/types";

export interface ManualRep {
  id: string;
  start: number;   // start of eccentric
  bottom: number;  // turnaround point
  end: number;     // end of concentric
}

interface Props {
  file: File;
  vFrames: VelocityFrame[];
  repStats: RepStats[];
  onClose: () => void;
  onSave: (manualReps: ManualRep[]) => void;
}

export default function RepEditorModal({ file, vFrames, repStats, onClose, onSave }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string>("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1);
  const [playing, setPlaying] = useState(false);

  // 1. Initialize manual reps from the AI's repStats
  const [reps, setReps] = useState<ManualRep[]>(() => {
    return repStats.map((rep, i) => {
      const repFrames = vFrames.filter((f) => f.repIndex === i);
      const ecc = repFrames.filter((f) => f.phase === "eccentric");
      const con = repFrames.filter((f) => f.phase === "concentric");

      const start = ecc[0]?.timeSeconds ?? repFrames[0]?.timeSeconds ?? 0;
      const bottom = con[0]?.timeSeconds ?? start;
      const end = con[con.length - 1]?.timeSeconds ?? bottom;

      return { id: Math.random().toString(), start, bottom, end };
    });
  });

  // 2. Setup Video
  useEffect(() => {
    const objUrl = URL.createObjectURL(file);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [file]);

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration || 1);
  };

  // 3. Video Controls
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setPlaying(true);
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  };

  const scrub = (val: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const nudge = (seconds: number) => {
    if (videoRef.current) {
      const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // 4. Rep Editing Handlers
  const updateRep = (id: string, field: keyof ManualRep, val: number) => {
    setReps((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  const addRep = () => {
    setReps([...reps, { id: Math.random().toString(), start: currentTime, bottom: currentTime + 1, end: currentTime + 2 }]);
  };

  const deleteRep = (id: string) => {
    setReps(reps.filter((r) => r.id !== id));
  };

  return (
    // Outer overlay: prevents background scrolling and perfectly centers the modal
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in">
      
      {/* 
        Modal Container: 
        max-h-[90vh] ensures it never goes off screen.
        flex-col ensures children stack correctly.
      */}
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header (Fixed Height) */}
        <div className="shrink-0 px-4 py-3 border-b border-white/5 flex justify-between items-center bg-zinc-950">
          <h2 className="font-bold text-lg text-white">Edit Reps</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white p-2">✕</button>
        </div>

        {/* 
          Video Player Area (Flexible, but with a hard max-height) 
          This prevents vertical videos from pushing the controls off-screen!
        */}
        <div className="shrink-0 w-full bg-black flex items-center justify-center" style={{ maxHeight: "35vh" }}>
          {url && (
            <video
              ref={videoRef}
              src={url}
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setPlaying(false)}
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: "35vh" }}
            />
          )}
        </div>

        {/* Scrubber & Controls (Fixed Height) */}
        <div className="shrink-0 p-4 bg-zinc-950 border-y border-white/5 space-y-4">
          {/* Slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/50 font-mono w-10 text-right">{currentTime.toFixed(2)}s</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={currentTime}
              onChange={(e) => scrub(parseFloat(e.target.value))}
              className="flex-1 accent-orange-500 cursor-ew-resize"
            />
            <span className="text-xs text-white/50 font-mono w-10">{duration.toFixed(2)}s</span>
          </div>

          {/* Nudge Buttons */}
          <div className="flex justify-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button onClick={() => nudge(-0.1)} className="shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-mono">-0.1s</button>
            <button onClick={() => nudge(-0.03)} className="shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-mono">-1 frame</button>
            <button onClick={togglePlay} className="shrink-0 px-6 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-bold w-24">
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => nudge(0.03)} className="shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-mono">+1 frame</button>
            <button onClick={() => nudge(0.1)} className="shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-mono">+0.1s</button>
          </div>
        </div>

        {/* Rep List (Scrollable Area) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-900 min-h-0">
          {reps.length === 0 && (
            <p className="text-center text-white/40 text-sm py-4">No reps tracked yet. Add one below!</p>
          )}

          {reps.map((rep, idx) => (
            <div key={rep.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="font-bold text-orange-400">Rep {idx + 1}</span>
                <button onClick={() => deleteRep(rep.id)} className="text-red-400 hover:text-red-300 text-sm">🗑️ Remove</button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-white/40 uppercase">Start (Top)</span>
                  <button
                    onClick={() => updateRep(rep.id, "start", currentTime)}
                    className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs font-mono text-blue-400 transition-colors"
                  >
                    {rep.start.toFixed(2)}s
                  </button>
                </div>
                
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-white/40 uppercase">Bottom</span>
                  <button
                    onClick={() => updateRep(rep.id, "bottom", currentTime)}
                    className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs font-mono text-purple-400 transition-colors"
                  >
                    {rep.bottom.toFixed(2)}s
                  </button>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-white/40 uppercase">End (Top)</span>
                  <button
                    onClick={() => updateRep(rep.id, "end", currentTime)}
                    className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs font-mono text-orange-400 transition-colors"
                  >
                    {rep.end.toFixed(2)}s
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button onClick={addRep} className="w-full py-3 border border-dashed border-white/20 text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-colors text-sm">
            + Add Missing Rep
          </button>
        </div>

        {/* Footer Actions (Fixed Height) */}
        <div className="shrink-0 p-4 border-t border-white/5 bg-zinc-950">
          <button
            onClick={() => onSave(reps)}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-[0.98]"
          >
            Save & Recalculate 🚀
          </button>
        </div>

      </div>
    </div>
  );
}