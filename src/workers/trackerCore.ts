/**
 * Tracker core: grayscale ROI pyramid, template building (Scharr + inverse Hessian),
 * inverse-compositional pyramidal Lucas-Kanade, ZNCC scoring and coarse re-acquire search.
 * All public functions take and return FULL-FRAME coordinates.
 */

export const LEVELS = 3;
/** Template radius per pyramid level (level 0 = full resolution). */
export const TPL_RADIUS = [12, 9, 7];
/** Re-acquire search range in full-res px around the predicted position. */
export const SEARCH = 48;
export const ROI_HALF = SEARCH + TPL_RADIUS[LEVELS - 1] * (1 << (LEVELS - 1)) + 4;
const ROI_MAX = ROI_HALF * 2 + 1;
const SZ = (2 * TPL_RADIUS[0] + 1) ** 2;
const BIG_SZ = (2 * TPL_RADIUS[0] + 3) ** 2;
const EPS = 0.01;

export interface Level { w: number; h: number; data: Float32Array; }
export interface Pyr { ox: number; oy: number; ok: boolean; lv: Level[]; }
export interface Tpl {
  ok: boolean;
  z: Float32Array[];
  ix: Float32Array[];
  iy: Float32Array[];
  i11: number[]; i12: number[]; i22: number[];
  zz: number[];
}

/** Shared result slot (avoids allocating per frame). */
export const out = { x: 0, y: 0, score: 0 };

const bigScratch = new Float32Array(BIG_SZ);
const scratch = new Float32Array(SZ);
let lx = 0, ly = 0;

// ─── Pyramid ──────────────────────────────────────────────────────────────────

export function makePyr(): Pyr {
  const lv: Level[] = [];
  for (let l = 0; l < LEVELS; l++) {
    const s = (ROI_MAX >> l) + 2;
    lv.push({ w: 0, h: 0, data: new Float32Array(s * s) });
  }
  return { ox: 0, oy: 0, ok: false, lv };
}

/** Crop an ROI around (cx, cy), convert it to gray, and build the pyramid. */
export function fillPyr(p: Pyr, rgba: Uint8ClampedArray, W: number, H: number, cx: number, cy: number): void {
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
      let a = y * 2 * sw;
      for (let x = 0; x < nw; x++, a += 2) {
        o[q++] = 0.25 * (s[a] + s[a + 1] + s[a + sw] + s[a + sw + 1]);
      }
    }
  }
  p.ok = p.lv[LEVELS - 1].w >= 4 && p.lv[LEVELS - 1].h >= 4;
}

function inside(lv: Level, x: number, y: number, R: number): boolean {
  return x - R >= 0 && y - R >= 0 && x + R <= lv.w - 2 && y + R <= lv.h - 2;
}

/** Bilinear-sample a (2R+1)^2 patch centred at (x, y). Caller must check inside(). */
function samplePatch(lv: Level, x: number, y: number, R: number, o: Float32Array): void {
  const bx = x - R, by = y - R;
  const x0 = bx | 0, y0 = by | 0;
  const fx = bx - x0, fy = by - y0;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy, w11 = fx * fy;
  const d = lv.data, lw = lv.w, n2 = 2 * R + 1;
  let k = 0;
  for (let j = 0; j < n2; j++) {
    let idx = (y0 + j) * lw + x0;
    for (let i = 0; i < n2; i++, idx++) {
      o[k++] = d[idx] * w00 + d[idx + 1] * w10 + d[idx + lw] * w01 + d[idx + lw + 1] * w11;
    }
  }
}

// ─── Template ─────────────────────────────────────────────────────────────────

export function makeTpl(): Tpl {
  const arr = () => Array.from({ length: LEVELS }, () => new Float32Array(SZ));
  const zeros = () => new Array<number>(LEVELS).fill(0);
  return { ok: false, z: arr(), ix: arr(), iy: arr(), i11: zeros(), i12: zeros(), i22: zeros(), zz: zeros() };
}

/** Build a template centred at full-frame (cx, cy) from pyramid p. Returns false on failure. */
export function buildTpl(t: Tpl, p: Pyr, cx: number, cy: number): boolean {
  t.ok = false;
  if (!p.ok) return false;
  for (let l = 0; l < LEVELS; l++) {
    const lv = p.lv[l], r = TPL_RADIUS[l], s = 1 << l;
    const tx = (cx - p.ox) / s, ty = (cy - p.oy) / s;
    if (!inside(lv, tx, ty, r + 1)) return false;

    samplePatch(lv, tx, ty, r + 1, bigScratch);
    const b = bigScratch, nb = 2 * r + 3, n = (2 * r + 1) ** 2;
    const z = t.z[l], gxA = t.ix[l], gyA = t.iy[l];
    let k = 0, sum = 0, a11 = 0, a12 = 0, a22 = 0;
    for (let j = 1; j <= 2 * r + 1; j++) {
      for (let i = 1; i <= 2 * r + 1; i++) {
        const c = j * nb + i;
        // Scharr derivatives
        const gx = (3 * (b[c - nb + 1] - b[c - nb - 1]) + 10 * (b[c + 1] - b[c - 1]) + 3 * (b[c + nb + 1] - b[c + nb - 1])) / 32;
        const gy = (3 * (b[c + nb - 1] - b[c - nb - 1]) + 10 * (b[c + nb] - b[c - nb]) + 3 * (b[c + nb + 1] - b[c - nb + 1])) / 32;
        z[k] = b[c];
        gxA[k] = gx; gyA[k] = gy;
        sum += b[c];
        a11 += gx * gx; a12 += gx * gy; a22 += gy * gy;
        k++;
      }
    }
    const mean = sum / n;
    let zz = 0;
    for (let q = 0; q < n; q++) { z[q] -= mean; zz += z[q] * z[q]; }
    const det = a11 * a22 - a12 * a12;
    if (det < 1e-3 || zz < 1e-6) return false; // flat / degenerate template
    t.i11[l] = a22 / det; t.i12[l] = -a12 / det; t.i22[l] = a11 / det;
    t.zz[l] = zz;
  }
  t.ok = true;
  return true;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/** Raw ZNCC in [-1, 1] at a level, in that level's ROI coordinates. */
function znccLevel(t: Tpl, lv: Level, l: number, x: number, y: number): number {
  const r = TPL_RADIUS[l], n = (2 * r + 1) ** 2;
  if (!inside(lv, x, y, r)) return -1;
  samplePatch(lv, x, y, r, scratch);
  let m = 0;
  for (let k = 0; k < n; k++) m += scratch[k];
  m /= n;
  const z = t.z[l];
  let num = 0, dd = 0;
  for (let k = 0; k < n; k++) {
    const v = scratch[k] - m;
    num += z[k] * v; dd += v * v;
  }
  const den = Math.sqrt(t.zz[l] * dd);
  return den < 1e-6 ? -1 : num / den;
}

/** Confidence in [0, 1] at level 0, same mapping as the old tracker: (ncc + 1) / 2. */
export function zncc(t: Tpl, p: Pyr, fx: number, fy: number): number {
  if (!t.ok || !p.ok) return 0;
  const v = znccLevel(t, p.lv[0], 0, fx - p.ox, fy - p.oy);
  return Math.max(0, Math.min(1, (v + 1) * 0.5));
}

/** One LK level (inverse compositional). Writes lx/ly. */
function lkLevel(t: Tpl, lv: Level, l: number, x: number, y: number, iters: number): boolean {
  const r = TPL_RADIUS[l], n = (2 * r + 1) ** 2;
  const z = t.z[l], ix = t.ix[l], iy = t.iy[l];
  const h11 = t.i11[l], h12 = t.i12[l], h22 = t.i22[l];
  for (let it = 0; it < iters; it++) {
    if (!inside(lv, x, y, r)) return false;
    samplePatch(lv, x, y, r, scratch);
    let m = 0;
    for (let k = 0; k < n; k++) m += scratch[k];
    m /= n;
    let b1 = 0, b2 = 0;
    for (let k = 0; k < n; k++) {
      const e = scratch[k] - m - z[k];
      b1 += ix[k] * e; b2 += iy[k] * e;
    }
    let dx = h11 * b1 + h12 * b2;
    let dy = h12 * b1 + h22 * b2;
    dx = Math.max(-r, Math.min(r, dx));
    dy = Math.max(-r, Math.min(r, dy));
    x -= dx; y -= dy; // inverse compositional update
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) break;
  }
  if (!inside(lv, x, y, r)) return false;
  lx = x; ly = y;
  return true;
}

/** Pyramidal LK from a full-frame start point. Result in out.x / out.y (full-frame). */
export function pyrLK(t: Tpl, p: Pyr, fx: number, fy: number, iters: number[]): boolean {
  if (!t.ok || !p.ok) return false;
  let x = fx - p.ox, y = fy - p.oy;
  for (let l = LEVELS - 1; l >= 0; l--) {
    const s = 1 << l;
    if (!lkLevel(t, p.lv[l], l, x / s, y / s, iters[l])) return false;
    x = lx * s; y = ly * s;
  }
  out.x = x + p.ox; out.y = y + p.oy;
  return true;
}

/** Coarse ZNCC search on the top pyramid level. Result in out.x / out.y / out.score. */
export function coarseSearch(t: Tpl, p: Pyr, fx: number, fy: number, range: number): boolean {
  if (!t.ok || !p.ok) return false;
  const l = LEVELS - 1, s = 1 << l, lv = p.lv[l];
  const cx = Math.round((fx - p.ox) / s), cy = Math.round((fy - p.oy) / s);
  const R = Math.max(1, Math.round(range / s));
  let best = -2, bx = 0, by = 0;
  for (let dy = -R; dy <= R; dy += 2) {
    for (let dx = -R; dx <= R; dx += 2) {
      const v = znccLevel(t, lv, l, cx + dx, cy + dy);
      if (v > best) { best = v; bx = cx + dx; by = cy + dy; }
    }
  }
  if (best <= -1) return false;
  out.x = bx * s + p.ox; out.y = by * s + p.oy; out.score = best;
  return true;
}

// END OF FILE