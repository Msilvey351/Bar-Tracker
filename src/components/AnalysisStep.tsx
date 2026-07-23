"use client";

interface Props {
  progress: number;
  error: string | null;
}

export default function AnalysisStep({ progress, error }: Props) {
  return (
    <div className="flex flex-col items-center gap-8 py-16">
      <div className="text-6xl animate-pulse">🔬</div>
      <div>
        <h2 className="text-2xl font-bold text-center">Analysing Video</h2>
        <p className="text-white/40 text-center mt-1 text-sm">
          Tracking barbell frame-by-frame using optical flow…
        </p>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-6 py-4 text-red-400 text-sm max-w-md text-center">
          ❌ {error}
        </div>
      ) : (
        <div className="w-full max-w-md">
          <div className="flex justify-between text-sm text-white/50 mb-2">
            <span>Progress</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-white/30 text-xs text-center mt-3">
            Please keep this tab open — processing happens in your browser
          </p>
        </div>
      )}
    </div>
  );
}