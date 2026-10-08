/**
 * Tracker Web Worker (v2)
 *
 * - Constant-velocity motion model: the search window follows the bar
 * - Grayscale ROI only (no full-frame luma conversion, no per-sample RGB maths)
 * - 3-level pyramid, inverse-compositional Lucas-Kanade
 *   (Hessian + Scharr gradients computed once per template, not per iteration)
 * - Zero-mean template matching (robust to brightness change)
 * - Coarse-level re-acquire search, only when confidence is low
 * - Forward-backward check on ambiguous frames
 * - Anti-poisoning kept: template only updates on a confident match
 *
 * Protocol is backwards compatible. Result gains optional fields:
 *   vx, vy, lost, needsRedetect, fbError, ms
 */

interface InitMessage { type: "init"; width: number; height: number; isMobile: boolean; }
interface SeedMessage { type: "seed"; x: number; y: number; imageData: ImageData; }
interface TrackMessage { type: "track"; imageData: ImageData; }
interface ResetMessage { type: "reset"; }
type IncomingMessage = InitMessage | SeedMessage | TrackMessage | ResetMessage;

interface TrackResult {
  type: "result";
  x: number;
  y: number;
  confidence: number;
  tracked: boolean;
  vx: number;
  vy: number;
  lost: number;
  needsRedetect: boolean;
  fbError: number; // -1 if the forward-backward check did not run
  ms: number;      // worker time for this frame
}

interface AckMessage { type: "ack"; }
interface LogMessage { type: "log"; level: "log" | "warn"; args: string[]; }

const origLog  = console.log.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...args: unknown[]) => { origLog(...args); self.postMessage({ type: "log", level: "log", args: args.map(String) } as LogMessage); };
console.warn = (...args: unknown[]) => { origWarn(...args); self.postMessage({ type: "log", level: "warn", args: args.map(String) } as LogMessage); };

// ─── Tuning ───────────────────────────────────────────────────────────────────

const LEVELS = 3;
/** Template radius per pyramid level (level 0 = full res). */
const TPL_RADIUS = [12, 9, 7];
/** Max distance (full-res px) from the predicted position that we will search. */
const SEARCH = 48;
/** ROI half-size: search range + coarsest template footprint + margin. */
const ROI_HALF = SEARCH + TPL_RADIUS[LEVELS - 1] * (1 << (LEVELS - 1)) + 4;
const ROI_MAX  = ROI_HALF * 2 + 1;

const MIN_CONFIDENCE             = 0.25;
const TEMPLATE_UPDATE_CONFIDENCE = 0.50;
/** Below this, run the coarse re-acquire search and keep whichever is better. */
const REACQUIRE_CONFIDENCE       = 0.65;
/** Forward-backward check only runs when confidence is below this (saves time). */
const FB_TRIGGER_CONFIDENCE      = 0.75;
const FB_MAX_ERROR               = 3.0;  // px
/** Velocity smoothing (alpha-beta style). Higher = reacts faster. */
const VEL_BETA                   = 0.7;
const MAX_SPEED                  = 60;   // px / frame
/** Consecutive failed frames before we ask the caller to re-run YOLO. */
const LOST_REDETECT              = 8;
const EPS                        = 0.01;

/** LK iterations per level, index = level. */
let ITERS = [12, 8, 6];

// ─── Image pyramid (grayscale ROI) ────────────────────────────────────────────

interface Level { w: number; h: number; data: Float32Array; }
interface Pyr   { ox: number; oy: number; ok: boolean; lv: Level[]; }

function makePyr(): Pyr {
  const lv: Level[] = [];
  for (let l = 0; l < LEVELS; l++) {
    const s = (ROI_MAX >> l) + 2;
    lv.push({ w: 0, h: 0, data: new Float32Array(s * s) });
  }
  return { ox: 0, oy: 0, ok: false, lv };
}

function fillPyr(p: Pyr, rgba: Uint8ClampedArray, W: number, H: number, cx: number, cy: number): void {
  const rx = Math.round(cx), ry = Math.round(cy);
  const x0 = Math.max(0, rx - ROI_HALF), y0 = Math.max(0, ry - ROI_HALF);
  const x1 = Math.min(W, rx + ROI_HALF + 1), y1 = Math.min(H, ry + ROI_HALF + 1);
  const w = x1 - x0, h = y1 - y0;
  p.ox = x0; p.oy = y0;

  const L0 = p.lv[0];
  L0.w = w; L0.h = h;
  if (w < 32 || h < 32) { p.ok = false; return; }

  const d = L0.data;
  let k = 0;
  for (let y = 0; y < h; y++) {
    let i = ((y0 + y) * W + x0) * 4;
    for (let x = 0; x < w; x++, i += 4) {
      d[k++] = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) * (1 / 256);
    }
  }

  for (let l = 1; l < LEVELS; l++) {
    const src = p.lv[l - 1], dst = p.lv[l];
    const nw = src.w >> 1, nh = src.h >> 1;
    dst.w = nw; dst.h = nh;
    const s = src.data, o = dst.data, sw = src.w;
    let q = 0;
    for (let y = 0; y < nh; y++) {
      let a = (y * 2) * sw;
      for (let x = 0; x < nw; x++, a += 2) {
        o[q++] = 0.25 * (s[a] + s[a + 1] + s[a + sw] + s[a + sw + 1]);
      }
    }
  }
  p.ok = p.lv[LEVELS - 1].w >= 4 && p.lv[LEVELS - 1].h >= 4;
}

/** Bilinear sample