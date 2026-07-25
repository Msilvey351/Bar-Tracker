/**
 * Tracker Web Worker
 *
 * Receives ImageData frames from the main thread,
 * runs Lucas-Kanade optical flow,
 * returns tracked position + confidence.
 *
 * Stays completely off the main thread.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeedMessage {
  type: "seed";
  imageData: ImageData;
  x: number;
  y: number;
}

interface TrackMessage {
  type: "track";
  imageData: ImageData;
}

interface ResetMessage {
  type: "reset";
}

type IncomingMessage = SeedMessage | TrackMessage | ResetMessage;

interface TrackResult {
  type: "result";
  x: number;
  y: number;
  confidence: number;
  tracked: boolean;
}

interface ReadyMessage {
  type: "ready";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PATCH_RADIUS     = 15;
const MAX_ITERATIONS   = 20;
const EPSILON          = 0.01;
const MIN_CONFIDENCE   = 0.28;

// ─── State ────────────────────────────────────────────────────────────────────

let prevFrame:   ImageData | null = null;
let currentPoint: { x: number; y: number } | null = null;

// ─── Optical flow helpers ─────────────────────────────────────────────────────

function sampleLuma(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) return 0;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
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

function getPatch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number
): Float32Array {
  const size  = radius * 2 + 1;
  const patch = new Float32Array(size * size);
  let i = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      patch[i++] = sampleLuma(data, width, height, cx + dx, cy + dy);
    }
  }

  return patch;
}

function computeNCC(a: Float32Array, b: Float32Array): number {
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

  const ncc = numerator / denom;

  return Math.max(0, Math.min(1, (ncc + 1) / 2));
}

function lucasKanade(
  prevData:   Uint8ClampedArray,
  nextData:   Uint8ClampedArray,
  width:      number,
  height:     number,
  prevPoint:  { x: number; y: number }
): { x: number; y: number; confidence: number } {
  let gx = prevPoint.x;
  let gy = prevPoint.y;

  const r    = PATCH_RADIUS;
  const size = 2 * r + 1;

  const Ix       = new Float32Array(size * size);
  const Iy       = new Float32Array(size * size);
  const prevPatch = new Float32Array(size * size);

  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = prevPoint.x + dx;
      const py = prevPoint.y + dy;

      Ix[i] = (
        sampleLuma(prevData, width, height, px + 1, py) -
        sampleLuma(prevData, width, height, px - 1, py)
      ) / 2;

      Iy[i] = (
        sampleLuma(prevData, width, height, px, py + 1) -
        sampleLuma(prevData, width, height, px, py - 1)
      ) / 2;

      prevPatch[i] = sampleLuma(prevData, width, height, px, py);

      i++;
    }
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1  = 0;
    let b2  = 0;
    let A11 = 0;
    let A12 = 0;
    let A22 = 0;

    i = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nextVal = sampleLuma(nextData, width, height, gx + dx, gy + dy);
        const It      = nextVal - prevPatch[i];

        b1  += -It * Ix[i];
        b2  += -It * Iy[i];
        A11 += Ix[i] * Ix[i];
        A12 += Ix[i] * Iy[i];
        A22 += Iy[i] * Iy[i];

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

  const newPatch = getPatch(nextData, width, height, gx, gy, r);
  const conf     = computeNCC(prevPatch, newPatch);

  return { x: gx, y: gy, confidence: conf };
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  switch (msg.type) {

    case "seed": {
      prevFrame    = msg.imageData;
      currentPoint = { x: msg.x, y: msg.y };

      const result: ReadyMessage = { type: "ready" };
      self.postMessage(result);
      break;
    }

    case "track": {
      if (!prevFrame || !currentPoint) {
        const result: TrackResult = {
          type:       "result",
          x:          0,
          y:          0,
          confidence: 0,
          tracked:    false,
        };
        self.postMessage(result);
        break;
      }

      const { x, y, confidence } = lucasKanade(
        prevFrame.data,
        msg.imageData.data,
        msg.imageData.width,
        msg.imageData.height,
        currentPoint
      );

      const tracked = confidence >= MIN_CONFIDENCE;

      if (tracked) {
        currentPoint = { x, y };
      }

      // Always advance the frame reference
      prevFrame = msg.imageData;

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
      prevFrame    = null;
      currentPoint = null;
      break;
    }
  }
};

// Signal ready to main thread
const readyMsg: ReadyMessage = { type: "ready" };
self.postMessage(readyMsg);