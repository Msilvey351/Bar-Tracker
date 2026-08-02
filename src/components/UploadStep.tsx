"use client";

import { useCallback, useState } from "react";
import HowItWorksModal from "./HowItWorksModal";

interface Props {
  onFileAccepted: (file: File) => void;
}

const ACCEPTED = ["video/mp4", "video/webm", "video/quicktime", "video/avi"];

export default function UploadStep({ onFileAccepted }: Props) {
  const [dragging,   setDragging]   = useState(false);
  const [err,        setErr]        = useState<string | null>(null);
  const [showModal,  setShowModal]  = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const hasVideoExt = file.name.match(/\.(mp4|webm|mov|avi)$/i);
      
      if (!ACCEPTED.includes(file.type) && !hasVideoExt) {
        if (file.type && !file.type.startsWith("video/")) {
           setErr(`Unsupported file type: ${file.type || "unknown"}. Please upload a video file. Trim the video to include only the lift.`);
           return;
        }
      }
      
      setErr(null);
      onFileAccepted(file);
    },
    [onFileAccepted]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <>
      {showModal && <HowItWorksModal onClose={() => setShowModal(false)} />}

      <div className="flex flex-col items-center gap-6">

        {/* Title */}
        <div className="text-center">
          <h2 className="text-2xl font-bold">Upload Your Lift Video</h2>
          <p className="text-white/50 text-center mt-1 text-sm">
            MP4, WebM, MOV or AVI · Any length · Filmed from the side works best
          </p>
        </div>

        {/* Drop zone */}
        <label
          htmlFor="video-upload"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`
            w-full max-w-lg h-56 rounded-2xl border-2 flex flex-col items-center
            justify-center gap-4 transition-all select-none
            ${dragging
                ? "border-orange-400 bg-orange-500/10 border-dashed cursor-pointer"
                : "border-white/20 bg-white/5 hover:border-orange-500/60 hover:bg-white/10 border-dashed cursor-pointer"
            }
          `}
        >
          <span className="text-5xl">{dragging ? "📥" : "🎥"}</span>
          <div className="text-center">
            <p className="font-semibold text-white/90">
              Drag &amp; drop video here
            </p>
            <p className="text-white/40 text-sm mt-1">
              or click to browse
            </p>
          </div>
          <input
            id="video-upload"
            type="file"
            accept="video/*,.mp4,.mov,.webm,.avi"
            className="hidden"
            onChange={onInputChange}
          />
        </label>

        {err && (
          <p className="text-red-400 text-sm bg-red-500/10 px-4 py-2 rounded-lg">{err}</p>
        )}

        {/* ── How it works section ── */}
        <div className="w-full max-w-lg bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white/80 text-sm uppercase tracking-wider">
              How it works
            </h3>
            <button
              onClick={() => setShowModal(true)}
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors underline underline-offset-2"
            >
              Full guide
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {[
              {
                step: "1",
                title: "Upload",
                desc:  "Drop any MP4 or MOV video filmed side-on. Trim the video to include only the set.",
              },
              {
                step: "2",
                title: "Mark bar + calibrate",
                desc:  "Tap the bar end to track it, then tap the top and bottom of the weight plate to set the scale (45 cm = real-world m/s).",
              },
              {
                step: "3",
                title: "Analysis",
                desc:  "The app tracks the bar frame-by-frame using optical flow — entirely in your browser.",
              },
              {
                step: "4",
                title: "Results",
                desc:  "Auto-detected reps with avg velocity, peak velocity, speed drop %, eccentric time, and a signed velocity chart.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 font-bold text-xs">
                  {item.step}
                </div>
                <div>
                  <p className="text-white/80 font-semibold text-sm">{item.title}</p>
                  <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-emerald-400">
            <span>🔒</span>
            <span>100% private — your video never leaves your device.</span>
          </div>
        </div>

      </div>
    </>
  );
}