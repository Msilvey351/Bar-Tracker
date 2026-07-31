/**
 * Tracker Web Worker
 *
 * Adds Pre-Search (Block Matching) to catch fast movements without prediction.
 * Adds Anti-Poisoning to prevent template drift on blurry frames.
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
}

interface AckMessage { type: "ack"; }
interface LogMessage { type: "log"; level: "log" | "warn"; args: string[]; }

const origLog  = console.log.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...args: unknown[]) => { origLog(...args); self.postMessage({ type: "log", level: "log", args: args.map(String) } as LogMessage); };
console.warn = (...args: unknown[]) => { origWarn(...args); self.postMessage({ type: "log", level: "warn", args: args.map(String) } as LogMessage); };

// ─── Tuning ───────────────────────────────────────────────────────────────────

const PATCH_RADIUS   = 12; 
const PATCH_SIZE     = (PATCH_RADIUS * 2 + 1) ** 2;

/** Only accept the tracked point if it looks somewhat like the bar */
const MIN_CONFIDENCE = 0.35; 

/** 
 * ANTI-POISONING: Only update the reference template if it looks ALMOST EXACTLY 
 * like the original bar. If it's blurry/lagging, we track it but don't save it. 
 */
const TEMPLATE_UPDATE_CONFIDENCE = 0.85;

const MAX_PIXEL_JUMP = 60; // Allowed to jump further now because of pre-search
const EPSILON        = 0.01;
let MAX_ITERATIONS   = 20;

// ─── State ────────────────────────────────────────────────────────────────────

let frameWidth:   number = 0;
let frameHeight:  number = 0;
let currentPoint: { x: number; y: number } | null = null;

// ─── TypeScript fallback optical flow ─────────────────────────────────────────

function sampleLumaTS(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
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
  return luma(x0, y0) * (1 - fx) * (1 - fy) + luma(x1, y0) * fx * (1 - fy) +
         luma(x0, y1) * (1 - fx) * fy + luma(x1, y1) * fx * fy;
}

let tsPatchData: Float32Array | null = null;
let tsIxData:    Float32Array | null = null;
let tsIyData:    Float32Array | null = null;

function buildPatchTS(data: Uint8ClampedArray, width: number, height: number, cx: number, cy: number): void {
  tsPatchData = new Float32Array(PATCH_SIZE);
  tsIxData    = new Float32Array(PATCH_SIZE);
  tsIyData    = new Float32Array(PATCH_SIZE);
  const r = PATCH_RADIUS;
  let i   = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx; const py = cy + dy;
      tsPatchData[i] = sampleLumaTS(data, width, height, px,     py);
      tsIxData[i]    = (sampleLumaTS(data, width, height, px + 1, py) - sampleLumaTS(data, width, height, px - 1, py)) / 2;
      tsIyData[i]    = (sampleLumaTS(data, width, height, px,     py + 1) - sampleLumaTS(data, width, height, px,     py - 1)) / 2;
      i++;
    }
  }
}

function trackPointTS(data: Uint8ClampedArray, width: number, height: number, startX: number, startY: number): { x: number; y: number; confidence: number } {
  if (!tsPatchData || !tsIxData || !tsIyData) return { x: startX, y: startY, confidence: 0 };
  
  const r = PATCH_RADIUS;

  // ─── 1. WIDER PRE-SEARCH (BLOCK MATCHING) ──────────────────────────────────
  // Scans a grid around the last known point to catch fast movements that outrun LK.
  // Expanded to +/- 32 pixels. If the bar drops heavily, we will find it here first.
  let bestX = startX;
  let bestY = startY;
  let minSAD = Infinity;

  // Search a +/- 32 pixel box in steps of 4 pixels
  for (let sy = -32; sy <= 32; sy += 4) {
    for (let sx = -32; sx <= 32; sx += 4) {
      
      // Bounds check so we don't sample off screen
      if (startX + sx < r || startY + sy < r || startX + sx >= width - r || startY + sy >= height - r) {
        continue;
      }

      let sad = 0;
      let i = 0;
      
      // We don't need to sample every pixel for the rough search. 
      // Striding by 2 makes it 4x faster without losing accuracy.
      for (let dy = -r; dy <= r; dy += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          const val = sampleLumaTS(data, width, height, startX + sx + dx, startY + sy + dy);
          // Find the corresponding index in the stored patch
          const patchIdx = (dy + r) * (2 * r + 1) + (dx + r);
          sad += Math.abs(val - tsPatchData[patchIdx]);
          i++;
        }
      }
      
      if (sad < minSAD) {
        minSAD = sad;
        bestX = startX + sx;
        bestY = startY + sy;
      }
    }
  }

  // ─── 2. LUCAS-KANADE REFINEMENT ─────────────────────────────────────────────
  // Start LK from the best grid match to get sub-pixel accuracy
  let gx  = bestX; 
  let gy  = bestY; 

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let b1 = 0, b2 = 0, A11 = 0, A12 = 0, A22 = 0; let i  = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const It = sampleLumaTS(data, width, height, gx + dx, gy + dy) - tsPatchData[i];
        b1  += -It * tsIxData[i]; b2  += -It * tsIyData[i];
        A11 += tsIxData[i] * tsIxData[i]; A12 += tsIxData[i] * tsIyData[i]; A22 += tsIyData[i] * tsIyData[i];
        i++;
      }
    }
    const det = A11 * A22 - A12 * A12;
    if (Math.abs(det) < 1e-6) break;
    const vx = (A22 * b1 - A12 * b2) / det; const vy = (A11 * b2 - A12 * b1) / det;
    gx += vx; gy += vy;
    if (Math.abs(vx) < EPSILON && Math.abs(vy) < EPSILON) break;
  }
  gx = Math.max(0, Math.min(width  - 1, gx)); gy = Math.max(0, Math.min(height - 1, gy));
  
  // ─── 3. CONFIDENCE SCORING (NCC) ────────────────────────────────────────────
  const newPatch = new Float32Array(PATCH_SIZE);
  let j = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) newPatch[j++] = sampleLumaTS(data, width, height, gx + dx, gy + dy);
  }
  let meanA = 0; let meanB = 0;
  for (let k = 0; k < PATCH_SIZE; k++) { meanA += tsPatchData[k]; meanB += newPatch[k]; }
  meanA /= PATCH_SIZE; meanB /= PATCH_SIZE;
  let num = 0, da2 = 0, db2 = 0;
  for (let k = 0; k < PATCH_SIZE; k++) {
    const da = tsPatchData[k] - meanA; const db = newPatch[k] - meanB;
    num += da * db; da2 += da * da; db2 += db * db;
  }
  const denom      = Math.sqrt(da2 * db2);
  const confidence = denom < 1e-6 ? 0 : Math.max(0, Math.min(1, (num / denom + 1) / 2));
  
  return { x: gx, y: gy, confidence };
}


// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init": {
      frameWidth  = msg.width;
      frameHeight = msg.height;
      MAX_ITERATIONS = msg.isMobile ? 12 : 20;
      
      // Auto-ack on load since we bypassed WASM
      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }
    case "seed": {
      const { imageData, x, y } = msg;
      const pixels = imageData.data;
      const w      = imageData.width;
      const h      = imageData.height;

      frameWidth  = w;
      frameHeight = h;
      currentPoint = { x, y };
      
      buildPatchTS(pixels, w, h, msg.x, msg.y);

      self.postMessage({ type: "ack" } as AckMessage);
      break;
    }
    case "track": {
      const { imageData } = msg;
      const pixels = imageData.data;
      const w      = imageData.width;
      const h      = imageData.height;

      if (!currentPoint || !w || !h) {
        self.postMessage({ type: "result", x: 0, y: 0, confidence: 0, tracked: false } as TrackResult);
        break;
      }

      const { x, y, confidence } = trackPointTS(pixels, w, h, currentPoint.x, currentPoint.y);

      const jump = Math.sqrt(Math.pow(x - currentPoint.x, 2) + Math.pow(y - currentPoint.y, 2));

      // Worker is now the sole decider of what is a valid track.
      // Must have high confidence AND not teleport across the screen.
      const tracked = confidence >= MIN_CONFIDENCE && jump <= MAX_PIXEL_JUMP;

      if (tracked) {
        // Anti-Poisoning check: Only update the template if it's a nearly perfect match.
        // If it's blurry/lagging but > MIN_CONFIDENCE, we keep the old, crisp template.
        if (confidence >= TEMPLATE_UPDATE_CONFIDENCE) {
          buildPatchTS(pixels, w, h, x, y);
        }
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
      break;
    }
  }
};