import type { Point } from "@/types";

const PATCH_RADIUS = 15;   // pixels around seed to sample
const MAX_ITERATIONS = 20;
const EPSILON = 0.01;

/**
 * Capture a patch of ImageData centered on `center` from `imageData`.
 */
function getPatch(
  imageData: ImageData,
  center: Point,
  radius: number
): Float32Array {
  const size = 2 * radius + 1;
  const patch = new Float32Array(size * size);
  const { width, height, data } = imageData;
  let i = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(center.x + dx);
      const py = Math.round(center.y + dy);
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        // Luminance
        patch[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }
      i++;
    }
  }
  return patch;
}

/**
 * Get bilinear-sampled luminance at a sub-pixel location.
 */
function sampleLuma(imageData: ImageData, x: number, y: number): number {
  const { width, height, data } = imageData;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const idx = (r: number, c: number) => (r * width + c) * 4;
  const luma = (r: number, c: number) => {
    const i = idx(r, c);
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  return (
    luma(y0, x0) * (1 - fx) * (1 - fy) +
    luma(y0, x1) * fx * (1 - fy) +
    luma(y1, x0) * (1 - fx) * fy +
    luma(y1, x1) * fx * fy
  );
}

/**
 * Lucas-Kanade single-level tracker.
 * Tracks `prevPoint` from `prevFrame` → `nextFrame`.
 * Returns the new estimated position.
 */
export function trackPoint(
  prevFrame: ImageData,
  nextFrame: ImageData,
  prevPoint: Point
): Point {
  let gx = prevPoint.x;
  let gy = prevPoint.y;

  const r = PATCH_RADIUS;
  const size = 2 * r + 1;

  // Spatial gradients from prev frame (constant)
  const Ix = new Float32Array(size * size);
  const Iy = new Float32Array(size * size);
  const It_base = new Float32Array(size * size);

  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = prevPoint.x + dx;
      const py = prevPoint.y + dy;
      Ix[i] = (sampleLuma(prevFrame, px + 1, py) - sampleLuma(prevFrame, px - 1, py)) / 2;
      Iy[i] = (sampleLuma(prevFrame, px, py + 1) - sampleLuma(prevFrame, px, py - 1)) / 2;
      It_base[i] = sampleLuma(prevFrame, px, py);
      i++;
    }
  }

  // Iterative LK
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1 = 0, b2 = 0;
    let A11 = 0, A12 = 0, A22 = 0;

    i = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const It = sampleLuma(nextFrame, gx + dx, gy + dy) - It_base[i];
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

    if (Math.abs(vx) < EPSILON && Math.abs(vy) < EPSILON) break;
  }

  return { x: gx, y: gy };
}