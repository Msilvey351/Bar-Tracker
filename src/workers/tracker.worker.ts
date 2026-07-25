/**
 * Tracker Web Worker — Priority 4 update
 *
 * Uses SharedArrayBuffer for zero-copy frame sharing.
 * Main thread writes pixels into the shared buffer.
 * Worker reads directly — no ArrayBuffer transfer or copy.
 */

// ─── Message types ────────────────────────────────────────────────────────────

interface InitMessage {
  type:         "init";
  sharedBuffer: SharedArrayBuffer;  // pixel data shared with main thread
  signalBuffer: SharedArrayBuffer;  // Atomics signalling channel
  width:        number;
  height:       number;
}

interface SeedMessage {
  type: "seed";
  x:    number;
  y:    number;
}

interface TrackMessage {
  type: "track";
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

// ─── Tuning ───────────────────────────────────────────────────────────────────

const PATCH_RADIUS   = 15;
const MAX_ITERATIONS = 20;
const EPSILON        = 0.01;
const MIN_CONFIDENCE = 0.28;

/**
 * Signal values used with Atomics.
 * Main thread writes FRAME_READY when pixels are written.
 * Worker resets to IDLE after reading.
 */
const SIGNAL_IDLE        = 0;
const SIGNAL_FRAME_READY = 1;

// ─── State ────────────────────────────────────────────────────────────────────

let sharedPixels:   Uint8ClampedArray | null = null;
let signalArray:    Int32Array        | null = null;
let frameWidth:     number = 0;
let frameHeight:    number = 0;
let prevPatch:      Float32Array | null = null;
let prevIx:         Float32Array | null = null;
let prevIy:         Float32Array | null = null;
let currentPoint:   { x: number; y: number } | null = null;

// ─── Optical flow helpers ─────────────────────────────────────────────────────

function sampleLuma(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  x:      number,
  y:      number
): number {
  if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) return 0;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width  - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

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

function buildPrevPatchAndGradients(
  data:   Uint8ClampedArray,
  width:  number,
  height: number,
  cx:     number,
  cy:     number,
  radius: number
): void {
  const size = radius * 2 + 1;

  prevPatch = new Float32Array(size * size);
  prevIx    = new Float32Array(size * size);
  prevIy    = new Float32Array(size * size);

  let i = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx;
      const py = cy + dy;

      prevPatch[i] = sampleLuma(data, width, height, px,     py);
      prevIx[i]    = (sampleLuma(data, width, height, px + 1, py) -
                      sampleLuma(data, width, height, px - 1, py)) / 2;
      prevIy[i]    = (sampleLuma(data, width, height, px,     py + 1) -
                      sampleLuma(data, width, height, px,     py - 1)) / 2;
      i++;
    }
  }
}

function computeNCC(
  a: Float32Array,
  b: Float32Array
): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let meanA = 0;
  let meanB = 0;

  for (let i = 0; i < a.length; i++) {
    meanA += a[i];
    meanB += b[i];
  }

  meanA /= a.length;
  meanB /= b.length;

  let numerator = 0;
  let denomA    = 0;
  let denomB    = 0;

  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA    += da * da;
    denomB    += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  if (denom < 1e-6) return 0;

  return Math.max(0, Math.min(1, (numerator / denom + 1) / 2));
}

function runLucasKanade(
  nextData: Uint8ClampedArray,
  width:    number,
  height:   number,
  startX:   number,
  startY:   number
): { x: number; y: number; confidence: number } {
  if (!prevPatch || !prevIx || !prevIy) {
    return { x: startX, y: startY, confidence: 0 };
  }

  let gx = startX;
  let gy = startY;

  const r    = PATCH_RADIUS;
  const size = 2 * r + 1;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1 = 0, b2 = 0;
    let A11 = 0, A12 = 0, A22 = 0;

    let i = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nextVal = sampleLuma(nextData, width, height, gx + dx, gy + dy);
        const It      = nextVal - prevPatch[i];

        b1  += -It * prevIx[i];
        b2  += -It * prevIy[i];
        A11 += prevIx[i] * prevIx[i];
        A12 += prevIx[i] * prevIy[i];
        A22 += prevIy[i] * prevIy[i];

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

  // Compute new patch for NCC confidence
  const newPatch = new Float32Array(size * size);
  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      newPatch[i++] = sampleLuma(nextData, width, height, gx + dx, gy + dy);
    }
  }

  const confidence = computeNCC(prevPatch, newPatch);

  return { x: gx, y: gy, confidence };
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  switch (msg.type) {

    case "init": {
      /**
       * Receive shared buffers from main thread.
       * No copy — both threads access the same memory.
       */
      sharedPixels = new Uint8ClampedArray(msg.sharedBuffer);
      signalArray  = new Int32Array(msg.signalBuffer);
      frameWidth   = msg.width;
      frameHeight  = msg.height;

      const ack: AckMessage = { type: "ack" };
      self.postMessage(ack);
      break;
    }

    case "seed": {
      if (!sharedPixels || !frameWidth || !frameHeight) break;

      currentPoint = { x: msg.x, y: msg.y };

      /**
       * Pre-compute and cache the patch and gradients from the seed frame.
       * This avoids recomputing them on every subsequent track call.
       */
      buildPrevPatchAndGradients(
        sharedPixels,
        frameWidth,
        frameHeight,
        msg.x,
        msg.y,
        PATCH_RADIUS
      );

      const ack: AckMessage = { type: "ack" };
      self.postMessage(ack);
      break;
    }

    case "track": {
      if (!sharedPixels || !currentPoint || !prevPatch) {
        const result: TrackResult = {
          type: "result", x: 0, y: 0, confidence: 0, tracked: false,
        };
        self.postMessage(result);
        break;
      }

      /**
       * Read directly from shared memory — zero copy.
       * Main thread has already written the new frame pixels here.
       */
      const { x, y, confidence } = runLucasKanade(
        sharedPixels,
        frameWidth,
        frameHeight,
        currentPoint.x,
        currentPoint.y
      );

      const tracked = confidence >= MIN_CONFIDENCE;

      if (tracked) {
        /**
         * Update cached patch and gradients for next frame.
         * Only do this when confidence is good — prevents drift accumulation.
         */
        buildPrevPatchAndGradients(
          sharedPixels,
          frameWidth,
          frameHeight,
          x,
          y,
          PATCH_RADIUS
        );

        currentPoint = { x, y };
      }

      const result: TrackResult = {
        type:       "result",
        x:          tracked ? x : currentPoint.x,
        y:          tracked ? y : currentPoint.y,
        confidence,
        tracked,
      };

      self.postMessage(result);
      break;
    }

    case "reset": {
      prevPatch    = null;
      prevIx       = null;
      prevIy       = null;
      currentPoint = null;
      break;
    }
  }
};