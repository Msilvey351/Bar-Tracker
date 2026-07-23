"use client";

import { useCallback, useState } from "react";

interface Props {
  onFileAccepted: (file: File) => void;
}

const ACCEPTED = ["video/mp4", "video/webm", "video/quicktime", "video/avi"];

export default function UploadStep({ onFileAccepted }: Props) {
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi)$/i)) {
        setErr("Please upload a video file (MP4, WebM, MOV, AVI).");
        return;
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
    <div className="flex flex-col items-center gap-6">
      <div>
        <h2 className="text-2xl font-bold text-center">Upload Your Lift Video</h2>
        <p className="text-white/50 text-center mt-1 text-sm">
          MP4, WebM, MOV or AVI · Any length · Filmed from the side works best
        </p>
      </div>

      <label
        htmlFor="video-upload"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`
          w-full max-w-lg h-64 rounded-2xl border-2 border-dashed flex flex-col items-center
          justify-center gap-4 cursor-pointer transition-all select-none
          ${dragging
            ? "border-orange-400 bg-orange-500/10"
            : "border-white/20 bg-white/5 hover:border-orange-500/60 hover:bg-white/10"
          }
        `}
      >
        <span className="text-5xl">{dragging ? "📥" : "🎥"}</span>
        <div className="text-center">
          <p className="font-semibold text-white/90">
            Drag &amp; drop video here
          </p>
          <p className="text-white/40 text-sm mt-1">or click to browse</p>
        </div>
        <input
          id="video-upload"
          type="file"
          accept="video/*"
          className="hidden"
          onChange={onInputChange}
        />
      </label>

      {err && (
        <p className="text-red-400 text-sm bg-red-500/10 px-4 py-2 rounded-lg">{err}</p>
      )}
    </div>
  );
}