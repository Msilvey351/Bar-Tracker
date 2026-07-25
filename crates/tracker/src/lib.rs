use wasm_bindgen::prelude::*;

const PATCH_RADIUS:   usize = 15;
const MAX_ITERATIONS: usize = 20;
const EPSILON:        f32   = 0.01;

#[inline(always)]
fn sample_luma(data: &[u8], width: usize, height: usize, x: f32, y: f32) -> f32 {
    if x < 1.0 || y < 1.0 || x >= (width - 2) as f32 || y >= (height - 2) as f32 {
        return 0.0;
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let luma = |px: usize, py: usize| -> f32 {
        let i = (py * width + px) * 4;
        0.299 * data[i] as f32 + 0.587 * data[i + 1] as f32 + 0.114 * data[i + 2] as f32
    };
    luma(x0, y0) * (1.0 - fx) * (1.0 - fy)
        + luma(x1, y0) * fx * (1.0 - fy)
        + luma(x0, y1) * (1.0 - fx) * fy
        + luma(x1, y1) * fx * fy
}

#[wasm_bindgen]
pub fn build_patch(data: &[u8], width: usize, height: usize, cx: f32, cy: f32, out: &mut [f32]) {
    let r    = PATCH_RADIUS as i32;
    let size = (2 * r + 1) as usize;
    let n    = size * size;
    let mut i = 0usize;
    for dy in -r..=r {
        for dx in -r..=r {
            let px = cx + dx as f32;
            let py = cy + dy as f32;
            out[i]         = sample_luma(data, width, height, px,       py);
            out[n + i]     = (sample_luma(data, width, height, px + 1.0, py)
                            - sample_luma(data, width, height, px - 1.0, py)) * 0.5;
            out[n * 2 + i] = (sample_luma(data, width, height, px,       py + 1.0)
                            - sample_luma(data, width, height, px,       py - 1.0)) * 0.5;
            i += 1;
        }
    }
}

#[wasm_bindgen]
pub fn track_point(
    next_data: &[u8], width: usize, height: usize,
    start_x: f32, start_y: f32,
    patch_data: &[f32], out: &mut [f32],
) {
    let r    = PATCH_RADIUS as i32;
    let size = (2 * r + 1) as usize;
    let n    = size * size;
    let patch = &patch_data[0..n];
    let ix    = &patch_data[n..n * 2];
    let iy    = &patch_data[n * 2..n * 3];
    let mut gx = start_x;
    let mut gy = start_y;
    for _ in 0..MAX_ITERATIONS {
        let (mut b1, mut b2, mut a11, mut a12, mut a22) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for i in 0..n {
            let dy = (i / size) as i32 - r;
            let dx = (i % size) as i32 - r;
            let it = sample_luma(next_data, width, height, gx + dx as f32, gy + dy as f32) - patch[i];
            b1  += -it * ix[i];
            b2  += -it * iy[i];
            a11 += ix[i] * ix[i];
            a12 += ix[i] * iy[i];
            a22 += iy[i] * iy[i];
        }
        let det = a11 * a22 - a12 * a12;
        if det.abs() < 1e-6 { break; }
        let vx = (a22 * b1 - a12 * b2) / det;
        let vy = (a11 * b2 - a12 * b1) / det;
        gx += vx;
        gy += vy;
        if vx.abs() < EPSILON && vy.abs() < EPSILON { break; }
    }
    gx = gx.max(0.0).min((width  - 1) as f32);
    gy = gy.max(0.0).min((height - 1) as f32);
    let mut new_patch = vec![0.0f32; n];
    for i in 0..n {
        let dy = (i / size) as i32 - r;
        let dx = (i % size) as i32 - r;
        new_patch[i] = sample_luma(next_data, width, height, gx + dx as f32, gy + dy as f32);
    }
    let mean_a = patch.iter().sum::<f32>() / n as f32;
    let mean_b = new_patch.iter().sum::<f32>() / n as f32;
    let (mut num, mut da2, mut db2) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..n {
        let da = patch[i] - mean_a;
        let db = new_patch[i] - mean_b;
        num += da * db;
        da2 += da * da;
        db2 += db * db;
    }
    let denom = (da2 * db2).sqrt();
    out[0] = gx;
    out[1] = gy;
    out[2] = if denom < 1e-6 { 0.0 } else { ((num / denom + 1.0) * 0.5).clamp(0.0, 1.0) };
}
