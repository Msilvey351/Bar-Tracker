/**
 * Tracker Web Worker (v2)
 * - Constant-velocity motion model; the ROI and search follow the bar
 * - Grayscale ROI pyramid + inverse-compositional pyramidal LK (see trackerCore.ts)
 * - Coarse ZNCC re-acquire only when confidence is low
 * - Forward-backward check on ambiguous frames
 * - Anti-poisoning: template only updates on a confident match
 * Protocol is backwards compatible; the result gains vx, vy, lost, needsRedetect, fbError, ms.
 */
import {
  makePyr, makeTpl, fillPyr, buildTpl, pyrLK, zncc, coarseSearch, out, SEARCH,
  type Pyr, type Tpl,
} from "./trackerCore";

interface TrackResult {
  type: "result";
  x: number; y: number;
  confidence: number;
  tracked: boolean;
  vx: number; vy: number;
  lost: number;
  needsRedetect: boolean;
  fbError: number; // -1 if the forward-backward check did not run
  ms: number;
}
interface AckMessage { type: "ack"; }
interface LogMessage { type: "log"; level: "log" | "warn"; args: string[]; }

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...args: unknown[]) => { origLog(...args); self.postMessage({ type: "log", level: "log", args: args.map(String) } as LogMessage); };
console.warn = (...args: unknown[]) => { origWarn(...args); self.postMessage({ type: "log", level: "warn", args: args.map(String) } as LogMessage); };

// ─── Tuning ───────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 0.25;
const TEMPLATE_UPDATE_CONFIDENCE = 0.5;
const REACQUIRE_CONFIDENCE = 0.65;
const FB_TRIGGER_CONFIDENCE = 0.75;
const FB_MAX_ERROR = 3.0;   // px
const MAX_JUMP = 90;        // px from the last accepted point (grows while lost)
const MAX_SPEED = 60;       // px / frame
const VEL_BETA = 0.7;
const LOST_REDETECT = 8;
let ITERS = [12, 8, 6];

// ─── State ────────────────────────────────────────────────────────────────────

let pt: { x: number; y: number } | null = null;
let vx = 0, vy = 0, lost = 0;
let prevOk = false;

let cur: Pyr = makePyr();
let prev: Pyr = makePyr();
let tpl: Tpl = makeTpl();
let tplB: Tpl = makeTpl();
const fbTpl: Tpl = makeTpl();

function swapPyr(): void { const t = cur; cur = prev; prev = t; }
function swapTpl(): void { const t = tpl; tpl = tplB; tplB = t; }

function fail(ms: number, conf = 0, fb = -1): TrackResult {
  return {
    type: "result", x: pt ? pt.x : 0, y: pt ? pt.y : 0, confidence: conf, tracked: false,
    vx, vy, lost, needsRedetect: lost >= LOST_REDETECT, fbError: fb, ms,
  };
}

function trackFrame(rgba: Uint8ClampedArray, W: number, H: number): TrackResult {
  const t0 = performance.now();
  if (!pt || !tpl.ok) return fail(0);

  // 1. Predict
  const px = Math.max(0, Math.min(W - 1, pt.x + vx));
  const py = Math.max(0, Math.min(H - 1, pt.y + vy));

  // 2. Build the ROI pyramid around the prediction
  fillPyr(cur, rgba, W, H, px, py);
  if (!cur.ok) { lost++; return fail(performance.now() - t0); }

  // 3. Pyramidal LK from the prediction
  let x = px, y = py, conf = 0;
  if (pyrLK(tpl, cur, px, py, ITERS)) {
    x = out.x; y = out.y;
    conf = zncc(tpl, cur, x, y);
  }

  // 4. Coarse re-acquire when the match is weak
  if (conf < REACQUIRE_CONFIDENCE && coarseSearch(tpl, cur, px, py, SEARCH)) {
    if (pyrLK(tpl, cur, out.x, out.y, ITERS)) {
      const c2 = zncc(tpl, cur, out.x, out.y);
      if (c2 > conf) { conf = c2; x = out.x; y = out.y; }
    }
  }

  // 5. Forward-backward check (only on ambiguous frames right after a good frame)
  let fb = -1;
  if (conf >= MIN_CONFIDENCE && conf < FB_TRIGGER_CONFIDENCE && prevOk && lost === 0) {
    if (buildTpl(fbTpl, cur, x, y) && pyrLK(fbTpl, prev, x, y, ITERS)) {
      fb = Math.hypot(out.x - pt.x, out.y - pt.y);
    }
  }

  // 6. Accept or reject
  const jump = Math.hypot(x - pt.x, y - pt.y);
  const maxJump = MAX_JUMP + lost * 20;
  const tracked = conf >= MIN_CONFIDENCE && jump <= maxJump && (fb < 0 || fb <= FB_MAX_ERROR);

  if (!tracked) {
    lost++;
    vx *= 0.5; vy *= 0.5;
    swapPyr(); prevOk = true;
    return fail(performance.now() - t0, conf, fb);
  }

  // Velocity update (alpha-beta style)
  let nvx = VEL_BETA * (x - pt.x) + (1 - VEL_BETA) * vx;
  let nvy = VEL_BETA * (y - pt.y) + (1 - VEL_BETA) * vy;
  const sp = Math.hypot(nvx, nvy);
  if (sp > MAX_SPEED) { nvx *= MAX_SPEED / sp; nvy *= MAX_SPEED / sp; }
  vx = nvx; vy = nvy;
  lost = 0;
  pt = { x, y };

  // Anti-poisoning: only refresh the template on a confident match
  if (conf >= TEMPLATE_UPDATE_CONFIDENCE && buildTpl(tplB, cur, x, y)) swapTpl();

  swapPyr(); prevOk = true;
  return {
    type: "result", x, y, confidence: conf, tracked: true,
    vx, vy, lost: 0, needsRedetect: false, fbError: fb, ms: performance.now() - t0,
  };
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      ITERS = msg.isMobile ? [8, 6, 4] : [12, 8, 6];
      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }
    case "seed": {
      const { imageData, x, y } = msg;
      pt = { x, y };
      vx = 0; vy = 0; lost = 0; prevOk = false;
      fillPyr(cur, imageData.data, imageData.width, imageData.height, x, y);
      if (!buildTpl(tpl, cur, x, y)) console.warn("tracker: seed template invalid (flat or near edge)");
      swapPyr();          // the seed frame becomes "previous"
      prevOk = true;
      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }
    case "track": {
      const { imageData } = msg;
      const res = trackFrame(imageData.data, imageData.width, imageData.height);
      self.postMessage(res);
      break;
    }
    case "reset": {
      pt = null; vx = 0; vy = 0; lost = 0; prevOk = false;
      tpl.ok = false; tplB.ok = false; fbTpl.ok = false;
      break;
    }
  }
};

// END OF FILE