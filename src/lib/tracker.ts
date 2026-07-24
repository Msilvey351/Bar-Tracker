import type { Point } from "@/types";

const PATCH_RADIUS = 15;
const MAX_ITERATIONS = 20;
const EPSILON = 0.01;

export interface TrackQualityResult {
  point: Point;
  confidence: number; // 0–1, higher = better
  error: number;      // lower = better
}

/**
 * Bilinear-sampled luminance at sub-pixel location.
 */
function sampleLuma(imageData: ImageData, x: number, y: number): number {
  const { width, height, data } = imageData;

  if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) return 0;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const fx = x - x0;
  const fy = y - y0;

  const luma = (px: number, py: number) => {
    const i = (py * width + px) * 4;
    return (
      0.299 * data[i] +
      0.587 * data[i + 1] +
      0.114 * data[i + 2]
    );
  };

  return (
    luma(x0, y0) * (1 - fx) * (1 - fy) +
    luma(x1, y0) * fx * (1 - fy) +
    luma(x0, y1) * (1 - fx) * fy +
    luma(x1, y1) * fx * fy
  );
}

/**
 * Extract a luminance patch around a point.
 */
function getPatch(
  imageData: ImageData,
  center: Point,
  radius: number
): Float32Array {
  const size = radius * 2 + 1;
  const patch = new Float32Array(size * size);

  let i = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      patch[i++] = sampleLuma(imageData, center.x + dx, center.y + dy);
    }
  }

  return patch;
}

/**
 * Normalised patch similarity.
 * 1 = identical, 0 = very poor.
 */
function patchConfidence(a: Float32Array, b: Float32Array): {
  confidence: number;
  error: number;
} {
  if (a.length !== b.length || a.length === 0) {
    return { confidence: 0, error: Infinity };
  }

  let meanA = 0;
  let meanB = 0;

  for (let i = 0; i < a.length; i++) {
    meanA += a[i];
    meanB += b[i];
  }

  meanA /= a.length;
  meanB /= b.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  let mse = 0;

  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;

    numerator += da * db;
    denomA += da * da;
    denomB += db * db;

    const diff = a[i] - b[i];
    mse += diff * diff;
  }

  mse /= a.length;

  const denom = Math.sqrt(denomA * denomB);

  if (denom < 1e-6) {
    return { confidence: 0, error: mse };
  }

  const ncc = numerator / denom;

  // Convert [-1, 1] → [0, 1]
  const confidence = Math.max(0, Math.min(1, (ncc + 1) / 2));

  return {
    confidence,
    error: mse,
  };
}

/**
 * Lucas-Kanade single-level point tracking.
 */
export function trackPoint(
  prevFrame: ImageData,
  nextFrame: ImageData,
  prevPoint: Point
): Point {
  return trackPointWithQuality(prevFrame, nextFrame, prevPoint).point;
}

/**
 * Lucas-Kanade point tracking with quality/confidence output.
 */
export function trackPointWithQuality(
  prevFrame: ImageData,
  nextFrame: ImageData,
  prevPoint: Point
): TrackQualityResult {
  let gx = prevPoint.x;
  let gy = prevPoint.y;

  const r = PATCH_RADIUS;
  const size = 2 * r + 1;

  const Ix = new Float32Array(size * size);
  const Iy = new Float32Array(size * size);
  const prevPatch = new Float32Array(size * size);

  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = prevPoint.x + dx;
      const py = prevPoint.y + dy;

      Ix[i] =
        (sampleLuma(prevFrame, px + 1, py) -
          sampleLuma(prevFrame, px - 1, py)) /
        2;

      Iy[i] =
        (sampleLuma(prevFrame, px, py + 1) -
          sampleLuma(prevFrame, px, py - 1)) /
        2;

      prevPatch[i] = sampleLuma(prevFrame, px, py);

      i++;
    }
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1 = 0;
    let b2 = 0;
    let A11 = 0;
    let A12 = 0;
    let A22 = 0;

    i = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nextVal = sampleLuma(nextFrame, gx + dx, gy + dy);
        const It = nextVal - prevPatch[i];

        b1 += -It * Ix[i];
        b2 += -It * Iy[i];

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

    if (Math.abs(vx) < EPSILON && Math.abs(vy) < EPSILON) {
      break;
    }
  }

  // Clamp to frame boundaries
  gx = Math.max(0, Math.min(nextFrame.width - 1, gx));
  gy = Math.max(0, Math.min(nextFrame.height - 1, gy));

  const newPatch = getPatch(nextFrame, { x: gx, y: gy }, r);
  const quality = patchConfidence(prevPatch, newPatch);

  return {
    point: { x: gx, y: gy },
    confidence: quality.confidence,
    error: quality.error,
  };
}