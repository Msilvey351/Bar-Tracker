"use client";

interface Props {
  onClose: () => void;
}

export default function HowItWorksModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏋️</span>
            <h2 className="text-lg font-bold text-white">How It Works</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 text-sm text-white/70 leading-relaxed">

          {/* Step 1 */}
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-xs">
              1
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Upload your video</p>
              <p>
                Film your lift so that the weight plates are entirely in frame. Side angles work best. 
                Upload any MP4, MOV or WebM video — any length.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-xs">
              2
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Mark the bar and calibrate</p>
              <p className="mb-2">
                You will make <span className="text-white font-medium">three taps</span> on the first frame of your video:
              </p>
              <ul className="flex flex-col gap-2 ml-1">
                <li className="flex gap-2">
                  <span className="text-orange-400 font-bold shrink-0">Tap 1 —</span>
                  <span>
                    Tap the <span className="text-white">middle of the plates</span> (close to the collar/shaft).
                    This is the point the app will track throughout the video.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-400 font-bold shrink-0">Tap 2 —</span>
                  <span>
                    Tap the <span className="text-white">very top edge</span> of the weight plate.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-400 font-bold shrink-0">Tap 3 —</span>
                  <span>
                    Tap the <span className="text-white">very bottom edge</span> of the same weight plate.
                  </span>
                </li>
              </ul>
              <div className="mt-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <p className="text-white/50 text-xs leading-relaxed">
                  <span className="text-emerald-400 font-semibold">📏 Why tap the plate?</span>
                  {" "}Taps 2 and 3 measure how many pixels tall the plate is in your video.
                  Since a standard calibrated weight plate is <span className="text-white">45 cm</span> in diameter,
                  this gives us a precise pixel-to-metre conversion — so all speeds are shown in
                  real-world <span className="text-white">m/s</span>, not arbitrary pixels.
                </p>
              </div>
              <p className="mt-2 text-white/40 text-xs">
                💡 If you are using a non-standard plate, you can change the diameter manually
                using the number input below the video frame.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-xs">
              3
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Analysis</p>
              <p>
                The app tracks the barbell frame-by-frame using optical flow — a technique that
                follows the visual pattern of pixels around the bar end through each frame of the video.
                This happens entirely in your browser. No video is ever uploaded to a server.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-xs">
              4
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Results</p>
              <p className="mb-2">
                Once tracking is complete, the app automatically detects reps, phases, and velocities.
                You get three views:
              </p>
              <ul className="flex flex-col gap-2 ml-1">
                <li className="flex gap-2">
                  <span className="text-orange-400 shrink-0">📊</span>
                  <span>
                    <span className="text-white font-medium">Rep Stats table</span> — avg concentric velocity,
                    avg eccentric velocity, peak concentric velocity (smoothed), concentric and eccentric
                    duration, pause duration (for pause bench), and % speed drop vs rep 1.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-400 shrink-0">📈</span>
                  <span>
                    <span className="text-white font-medium">Velocity chart</span> — a signed velocity trace
                    where <span className="text-orange-400">orange = concentric (up)</span> and{" "}
                    <span className="text-blue-400">blue = eccentric (down)</span>, with rep boundaries and
                    pause zones marked.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-400 shrink-0">🎬</span>
                  <span>
                    <span className="text-white font-medium">Video playback</span> — watch the tracked
                    bar path overlaid on your original video.
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Privacy note */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-xs text-emerald-400">
            🔒 <span className="font-semibold">100% private.</span> Your video never leaves your device.
            All processing happens locally in your browser.
          </div>

        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}