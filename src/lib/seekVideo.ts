/** How long to wait for a seek before giving up (ms) */
const SEEK_TIMEOUT_MS = 500;

/**
 * Seek a video element to `time` seconds and wait until it is actually ready
 * to have a frame captured (readyState >= 2).
 * Based on the fix in the barbell-tracker debugging session.
 */
export function seekVideo(
  video: HTMLVideoElement,
  time: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);

      if (video.readyState >= 2) {
        resolve();
      } else {
        // Haven't decoded enough — wait for canplay
        const onCanPlay = () => {
          video.removeEventListener("canplay", onCanPlay);
          resolve();
        };
        video.addEventListener("canplay", onCanPlay);
        // Hard fallback so we never hang forever
        setTimeout(resolve, 200);
      }
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
    // Fallback: if seeked never fires
    setTimeout(resolve, SEEK_TIMEOUT_MS);
  });
}

/**
 * Wait for a video to be "canplaythrough" before beginning analysis.
 * Resolves immediately if already ready enough (readyState >= 3).
 */
export function waitUntilReady(
  video: HTMLVideoElement,
  timeoutMs = 5000
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (video.readyState >= 3) {
      resolve();
      return;
    }
    const handler = () => resolve();
    video.addEventListener("canplaythrough", handler, { once: true });
    setTimeout(resolve, timeoutMs);
  });
}