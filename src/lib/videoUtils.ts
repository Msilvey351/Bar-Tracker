/**
 * Standardised video display dimensions.
 *
 * All videos are normalised to fit within a MAX_DIM × MAX_DIM box
 * while preserving aspect ratio. This eliminates letterbox/pillarbox
 * issues and makes coordinate conversion trivial.
 */

const MAX_DIM = 640;

export interface StdDims {
  width:  number;
  height: number;
}

export function getStandardDims(
  videoWidth:  number,
  videoHeight: number
): StdDims {
  const aspect = videoWidth / videoHeight;

  if (aspect >= 1) {
    // Landscape or square
    return {
      width:  MAX_DIM,
      height: Math.round(MAX_DIM / aspect),
    };
  } else {
    // Portrait
    return {
      width:  Math.round(MAX_DIM * aspect),
      height: MAX_DIM,
    };
  }
}

/**
 * Convert a point in standard display coords → native video coords
 */
export function stdToVideo(
  stdX:     number,
  stdY:     number,
  std:      StdDims,
  videoW:   number,
  videoH:   number
): { x: number; y: number } {
  return {
    x: stdX * (videoW / std.width),
    y: stdY * (videoH / std.height),
  };
}

/**
 * Convert a point in native video coords → standard display coords
 */
export function videoToStd(
  videoX:   number,
  videoY:   number,
  std:      StdDims,
  videoW:   number,
  videoH:   number
): { x: number; y: number } {
  return {
    x: videoX * (std.width  / videoW),
    y: videoY * (std.height / videoH),
  };
}