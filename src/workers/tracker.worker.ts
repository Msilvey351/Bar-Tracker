/**
 * Tracker Web Worker — Priority 5
 *
 * Uses WASM optical flow compiled from Rust.
 * Falls back to TypeScript implementation if WASM fails to load.
 *
 * SharedArrayBuffer removed — replaced with transferable ImageData buffers
 * to fix the race condition where shared memory was overwritten before
 * the worker finished building its patch from the previous frame.
 */

// ─── Message types ────────────────────────────────────────────────────────────

interface InitMessage {
  type:     "init";
  width:    number;
  height:   number;
  isMobile: boolean;
}

interface SeedMessage {
  type:      "seed";
  x:         number;
  y:         number;
  imageData: ImageData;
}

interface TrackMessage {
  type:      "track";
  imageData: ImageData;
}

interface ResetMessage {
  type: "reset";
}

type IncomingMessage =
  | InitMessage
  | SeedMessage
  | TrackMessage
  | ResetMessage;

interface TrackResult {
  type:       "result";
  x:          number;
  y:          number;
  confidence: number;
  tracked:    boolean;
}

interface AckMessage {
  type: "ack";
}

interface LogMessage {
  type:  "log";
  level: "log" | "warn";
  args:  string[];
}

// ─── Console forwarding ───────────────────────────────────────────────────────

const origLog  = console.log.bind(console);
const origWarn = console.warn.bind(console);

console.log = (...args: unknown[]) => {
  origLog(...args);
  self.postMessage({
    type: "log", level: "log", args: args.map(String),
  } as LogMessage);
};

console.warn = (...args: unknown[]) => {
  origWarn(...args);
  self.postMessage({
    type: "log", level: "warn", args: args.map(String),
  } as LogMessage);
};

// ─── Tuning ───────────────────────────────────────────────────────────────────

const PATCH_RADIUS = 15;
const PATCH_SIZE   = (PATCH_RADIUS * 2 + 1) ** 2;
const MIN_CONFIDENCE = 0.28;
const EPSILON        = 0.01;

let MAX_ITERATIONS = 20;

// ─── WASM module ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any         = null;
let patchData:  Float32Array | null = null;
let outData:    Float32Array | null = null;

async function loadWasm(): Promise<boolean> {
  try {
    const wasmJsUrl  = `${self.location.origin}/wasm/tracker/tracker.js`;
    const wasmBinUrl = `${self.location.origin}/wasm/tracker/tracker_bg.wasm`;

    console.log(`Loading WASM from: ${wasmJsUrl}`);

    const mod = await import(/* webpackIgnore: true */ wasmJsUrl);
    await mod.default({ module_or_path: wasmBinUrl });

    wasmModule = mod;
    patchData  = new Float32Array(PATCH_SIZE * 3);
    outData    = new Float32Array(3);

    console.log("✅ WASM tracker loaded");
    return true;
  } catch (e) {
    console.warn("⚠️ WASM tracker failed to load, using TypeScript fallback:", String(e));
    return false;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

let frameWidth:   number = 0;
let frameHeight:  number = 0;
let currentPoint: { x: number; y: number } | null = null;

// ─── TypeScript optical flow fallback ─────────────────────────────────────────

function sampleLumaTS(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) return 0;

  const x0 = Math.floor(x);
  const y0  = Math.floor(y);
  const x1  = Math.min(x0 + 1, width  - 1);
  const y1  = Math.min(y0 + 1, height - 1);
  const fx  = x - x0;
  const fy  = y - y0;

  const luma = (px: number, py: number) => {
    const i = (py * width + px) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  return (
    luma(x0, y0) * (1 - fx) * (1 - fy) +
    luma(x1, y0) * fx       * (1 - fy) +
    luma(x0, y1) * (1 - fx) * fy       +
    luma(x1, y1) * fx       * fy
  );
}

let tsPatchData: Float32Array | null = null;
let tsIxData:    Float32Array | null = null;
let tsIyData:    Float32Array | null = null;

function buildPatchTS(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  cx:     number,
  cy:     number
): void {
  tsPatchData = new Float32Array(PATCH_SIZE);
  tsIxData    = new Float32Array(PATCH_SIZE);
  tsIyData    = new Float32Array(PATCH_SIZE);

  const r = PATCH_RADIUS;
  let i   = 0;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx;
      const py = cy + dy;

      tsPatchData[i] = sampleLumaTS(data, width, height, px,     py);
      tsIxData[i]    = (sampleLumaTS(data, width, height, px + 1, py) -
                        sampleLumaTS(data, width, height, px - 1, py)) / 2;
      tsIyData[i]    = (sampleLumaTS(data, width, height, px,     py + 1) -
                        sampleLumaTS(data, width, height, px,     py - 1)) / 2;
      i++;
    }
  }
}

function trackPointTS(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  startX: number,
  startY: number
): { x: number; y: number; confidence: number } {
  if (!tsPatchData || !tsIxData || !tsIyData) {
    return { x: startX, y: startY, confidence: 0 };
  }

  let gx  = startX;
  let gy  = startY;
  const r = PATCH_RADIUS;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1 = 0, b2 = 0, A11 = 0, A12 = 0, A22 = 0;
    let i  = 0;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const It =
          sampleLumaTS(data, width, height, gx + dx, gy + dy) -
          tsPatchData[i];

        b1  += -It * tsIxData[i];
        b2  += -It * tsIyData[i];
        A11 += tsIxData[i] * tsIxData[i];
        A12 += tsIxData[i] * tsIyData[i];
        A22 += tsIyData[i] * tsIyData[i];
        i++;
      }
    }

    const det = A11 * A22 - A12 * A12;
    if (Math.abs(det) < 1e-6) break;

    const vx = (A22 * b1 - A12 * b2) / det;
    const vy = (A11 * b2 - A12 * b1) / det;

    gx += vx;
    gy += vy;

    if (Math.abs(vx) < EPSILON && Math.abs(vy) < EPSILON) break;
  }

  gx = Math.max(0, Math.min(width  - 1, gx));
  gy = Math.max(0, Math.min(height - 1, gy));

  const newPatch = new Float32Array(PATCH_SIZE);
  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      newPatch[i++] = sampleLumaTS(data, width, height, gx + dx, gy + dy);
    }
  }

  let meanA = 0;
  let meanB = 0;
  for (let j = 0; j < PATCH_SIZE; j++) {
    meanA += tsPatchData[j];
    meanB += newPatch[j];
  }
  meanA /= PATCH_SIZE;
  meanB /= PATCH_SIZE;

  let num = 0, da2 = 0, db2 = 0;
  for (let j = 0; j < PATCH_SIZE; j++) {
    const da = tsPatchData[j] - meanA;
    const db = newPatch[j]    - meanB;
    num += da * db;
    da2 += da * da;
    db2 += db * db;
  }

  const denom      = Math.sqrt(da2 * db2);
  const confidence = denom < 1e-6
    ? 0
    : Math.max(0, Math.min(1, (num / denom + 1) / 2));

  return { x: gx, y: gy, confidence };
}

// ─── Unified patch + track ────────────────────────────────────────────────────

function buildPatch(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  cx:     number,
  cy:     number
): void {
  if (wasmModule && patchData) {
    wasmModule.build_patch(data, width, height, cx, cy, patchData);
  } else {
    buildPatchTS(data, width, height, cx, cy);
  }
}

function trackPoint(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  cx:     number,
  cy:     number
): { x: number; y: number; confidence: number } {
  if (wasmModule && patchData && outData) {
    wasmModule.track_point(data, width, height, cx, cy, patchData, outData);
    return { x: outData[0], y: outData[1], confidence: outData[2] };
  }
  return trackPointTS(data, width, height, cx, cy);
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  switch (msg.type) {

    case "init": {
      frameWidth  = msg.width;
      frameHeight = msg.height;

      MAX_ITERATIONS = msg.isMobile ? 12 : 20;

      console.log(
        `Worker init — ${msg.width}×${msg.height} — ` +
        `mobile: ${msg.isMobile} — maxIter: ${MAX_ITERATIONS}`
      );

      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }

    case "seed": {
      /**
       * imageData is transferred — worker has exclusive ownership.
       * No race condition possible.
       */
      const { imageData, x, y } = msg;
      const pixels = imageData.data;
      const w      = imageData.width;
      const h      = imageData.height;

      // Update dimensions from actual imageData in case init wasn't called
      frameWidth  = w;
      frameHeight = h;

      currentPoint = { x, y };
      buildPatch(pixels, w, h, x, y);

      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }

    case "track": {
      /**
       * imageData is transferred — worker has exclusive ownership.
       * Previous frame patch was built from a separately transferred buffer,
       * so there is no shared memory race.
       */
      const { imageData } = msg;
      const pixels = imageData.data;
      const w      = imageData.width;
      const h      = imageData.height;

      if (!currentPoint || !w || !h) {
        self.postMessage({
          type: "result", x: 0, y: 0, confidence: 0, tracked: false,
        } as TrackResult);
        break;
      }

      const { x, y, confidence } = trackPoint(
        pixels, w, h, currentPoint.x, currentPoint.y
      );

      const tracked = confidence >= MIN_CONFIDENCE;

      if (tracked) {
        /**
         * Build patch from the transferred imageData.
         * Safe: this buffer is exclusively ours for the duration
         * of this message handler.
         */
        buildPatch(pixels, w, h, x, y);
        currentPoint = { x, y };
      }

      self.postMessage({
        type:       "result",
        x:          tracked ? x : currentPoint.x,
        y:          tracked ? y : currentPoint.y,
        confidence,
        tracked,
      } as TrackResult);
      break;
    }

    case "reset": {
      currentPoint = null;
      tsPatchData  = null;
      tsIxData     = null;
      tsIyData     = null;
      patchData    = wasmModule ? new Float32Array(PATCH_SIZE * 3) : null;
      console.log("Worker reset");
      break;
    }
  }
};

// ─── Startup ──────────────────────────────────────────────────────────────────

loadWasm().then((success) => {
  console.log(`Worker startup complete — WASM: ${success ? "yes" : "no (TS fallback)"}`);
  self.postMessage({ type: "ack" } as AckMessage);
});