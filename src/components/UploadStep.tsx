"use client";

import { useCallback, useEffect, useState } from "react";
import HowItWorksModal from "./HowItWorksModal";
import {
  canUseOpfs,
  importVideoToStableFile,
} from "@/lib/importVideoToStableFile";

interface UploadStepProps {
  onFileAccepted: (file: File) => void;
  onStartLive?: () => void;
}

const ACCEPTED_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
];

const ACCEPTED_EXTENSIONS = /\.(mp4|webm|mov|m4v)$/i;

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;

  return /Android/i.test(navigator.userAgent);
}

export default function UploadStep({ onFileAccepted, onStartLive }: UploadStepProps) {
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isUnsupported, setIsUnsupported] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  useEffect(() => {
    const isFirefox = /Firefox/i.test(navigator.userAgent);
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(
      navigator.userAgent
    );

    if (isFirefox && isMobile) {
      setIsUnsupported(true);
    }
  }, []);

  const validateFile = (file: File) => {
    const hasAcceptedExtension = ACCEPTED_EXTENSIONS.test(file.name);
    const hasAcceptedMime = ACCEPTED_MIME_TYPES.includes(file.type);

    if (!hasAcceptedMime && !hasAcceptedExtension) {
      if (file.type && !file.type.startsWith("video/")) {
        return `Unsupported file type: ${
          file.type || "unknown"
        }. Please upload an MP4, MOV, M4V, or WebM video.`;
      }

      return "Unsupported video format. Please upload an MP4, MOV, M4V, or WebM video.";
    }

    return null;
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (importing) return;

      console.log("Selected file details:", {
        name: file.name,
        type: file.type,
        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        rawSize: file.size,
        lastModified: file.lastModified,
        userAgent: navigator.userAgent,
        opfsAvailable: canUseOpfs(),
      });

      const validationError = validateFile(file);

      if (validationError) {
        setErr(validationError);
        setNotice(null);
        return;
      }

      setErr(null);
      setNotice(null);
      setImporting(true);
      setImportProgress(0);

      const ios = isIOSDevice();
      const android = isAndroidDevice();

      try {
        let fileToUse: File = file;

        if (canUseOpfs()) {
          try {
            fileToUse = await importVideoToStableFile(file, setImportProgress);

            console.log("Stable imported file details:", {
              name: fileToUse.name,
              type: fileToUse.type,
              size: `${(fileToUse.size / 1024 / 1024).toFixed(2)} MB`,
              rawSize: fileToUse.size,
              lastModified: fileToUse.lastModified,
            });
          } catch (opfsErr) {
            console.warn("OPFS import failed, falling back to original file:", opfsErr);

            fileToUse = file;

            if (android) {
              setNotice(
                "Using the selected file directly. On Android, this works best when you choose the video from Files → Internal Storage → DCIM → Camera, not Google Photos."
              );
            }
          }
        } else {
          fileToUse = file;

          if (android) {
            setNotice(
              "Browser storage import is unavailable. On Android, choose the video from Files → Internal Storage → DCIM → Camera instead of Google Photos."
            );
          }

          if (ios) {
            setNotice(
              "Using the selected iOS video directly. For best results, use Most Compatible format and turn HDR off."
            );
          }
        }

        setErr(null);
        onFileAccepted(fileToUse);
      } catch (error) {
        console.error("Video import failed:", error);

        setErr(
          "Could not import this video. On Android, go back from the Google Photos picker and choose Files → Internal Storage → DCIM → Camera. On iPhone, make sure the video is downloaded locally and recorded in Most Compatible format."
        );
      } finally {
        setImporting(false);
        setImportProgress(0);
      }
    },
    [importing, onFileAccepted]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();

    if (isUnsupported || importing) return;

    setDragging(false);

    const file = e.dataTransfer.files[0];

    if (file) {
      handleFile(file);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUnsupported || importing) return;

    const file = e.target.files?.[0];

    if (file) {
      handleFile(file);
    }

    e.currentTarget.value = "";
  };

  return (
    <>
      {showModal && <HowItWorksModal onClose={() => setShowModal(false)} />}

      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Upload Your Lift Video</h2>
          <p className="text-white/50 text-center mt-1 text-sm">
            MP4, MOV, M4V or WebM · Filmed from the side works best
          </p>
        </div>

        {isUnsupported && (
          <div className="w-full max-w-lg bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 text-center">
            <h3 className="text-red-400 font-bold mb-1">
              Browser Not Supported ⚠️
            </h3>
            <p className="text-white/70 text-sm">
              Firefox on mobile devices blocks the hardware acceleration required
              to analyze video locally. Please open this app in{" "}
              <strong>Chrome</strong>, <strong>Safari</strong>, or{" "}
              <strong>Edge</strong> to continue.
            </p>
          </div>
        )}

        <label
          htmlFor="video-upload"
          onDragOver={(e) => {
            e.preventDefault();
            if (!isUnsupported && !importing) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`
            w-full max-w-lg h-56 rounded-2xl border-2 flex flex-col items-center
            justify-center gap-4 transition-all select-none
            ${
              isUnsupported || importing
                ? "border-white/10 bg-white/5 opacity-50 cursor-not-allowed"
                : dragging
                ? "border-orange-400 bg-orange-500/10 border-dashed cursor-pointer"
                : "border-white/20 bg-white/5 hover:border-orange-500/60 hover:bg-white/10 border-dashed cursor-pointer"
            }
          `}
        >
          <span className="text-5xl">
            {importing ? "⏳" : dragging ? "📥" : "🎥"}
          </span>

          <div className="text-center">
            <p className="font-semibold text-white/90">
              {isUnsupported
                ? "Upload Disabled"
                : importing
                ? "Importing video..."
                : "Drag & drop video here"}
            </p>

            <p className="text-white/40 text-sm mt-1">
              {isUnsupported
                ? "Please switch browsers"
                : importing
                ? "Please wait"
                : "or choose from Files / Photo Library"}
            </p>

            <p className="text-white/30 text-xs mt-2 max-w-sm px-4 leading-relaxed">
              Android: if Google Photos opens, tap Back or the menu and choose{" "}
              <span className="text-white/50">Files</span> instead.
            </p>
          </div>

          <input
            id="video-upload"
            type="file"
            accept=".mp4,.mov,.m4v,.webm"
            className="hidden"
            onChange={onInputChange}
            disabled={isUnsupported || importing}
          />
        </label>

        {importing && (
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
            <p>Importing video into app storage…</p>

            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{ width: `${Math.round(importProgress * 100)}%` }}
              />
            </div>

            <p className="mt-1 text-xs text-white/40">
              {Math.round(importProgress * 100)}%
            </p>
          </div>
        )}

        {notice && (
          <p className="w-full max-w-lg text-yellow-300 text-sm bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 rounded-lg">
            {notice}
          </p>
        )}

        {err && (
          <p className="w-full max-w-lg text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-lg">
            {err}
          </p>
        )}

        {/* 🔥 Live Camera Trigger */}
        {onStartLive && (
          <div className="w-full max-w-lg flex flex-col items-center gap-4 my-2">
            <div className="flex items-center gap-4 w-full">
              <div className="h-px bg-white/10 flex-1" />
              <span className="text-xs text-white/40 font-semibold uppercase tracking-wider">OR</span>
              <div className="h-px bg-white/10 flex-1" />
            </div>
            
            <button
              onClick={onStartLive}
              className="bg-zinc-800 hover:bg-orange-600 border border-zinc-700 hover:border-orange-500 text-white font-bold py-4 px-8 rounded-xl transition-all flex items-center gap-3 w-full justify-center shadow-lg group"
            >
              <span className="text-xl group-hover:scale-110 transition-transform">📷</span> 
              <span>Track Lift in Real-Time</span>
            </button>
          </div>
        )}

        {/* How It Works Section */}
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
                desc: "Choose an MP4, MOV, M4V, or WebM video filmed side-on. Trim the video to include only the set.",
              },
              {
                step: "2",
                title: "Mark bar + calibrate",
                desc: "Tap the bar end to track it, then tap the top and bottom of the weight plate to set the scale.",
              },
              {
                step: "3",
                title: "Analysis",
                desc: "The app tracks the bar frame-by-frame using optical flow — entirely in your browser.",
              },
              {
                step: "4",
                title: "Results",
                desc: "Auto-detected reps with avg velocity, peak velocity, speed drop %, eccentric time, and a signed velocity chart.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 font-bold text-xs">
                  {item.step}
                </div>

                <div>
                  <p className="text-white/80 font-semibold text-sm">
                    {item.title}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-emerald-400">
            <span>🔒</span>
            <span>100% private — your video never leaves your device.</span>
          </div>

          <div className="mt-3 text-xs text-white/30 leading-relaxed">
            Android: choose from{" "}
            <span className="text-white/50">
              Files → Internal Storage → DCIM → Camera
            </span>{" "}
            if Google Photos causes loading issues.
            <br />
            iPhone: Photo Library usually works. For best results, use{" "}
            <span className="text-white/50">Most Compatible</span> video format
            and turn HDR off.
          </div>
        </div>
      </div>
    </>
  );
}