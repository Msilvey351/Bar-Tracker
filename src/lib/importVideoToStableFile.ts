function guessVideoMimeType(file: File): string {
  const name = file.name.toLowerCase();

  if (file.type) return file.type;

  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".m4v")) return "video/x-m4v";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".webm")) return "video/webm";

  return "video/mp4";
}

export async function importVideoToStableFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<File> {
  if (!navigator.storage?.getDirectory) {
    throw new Error(
      "Browser storage API is unavailable. This usually means the app is not running over HTTPS."
    );
  }

  const root = await navigator.storage.getDirectory();

  const safeOriginalName = file.name || "video.mp4";

  const safeName = `imported-video-${Date.now()}-${safeOriginalName}`.replace(
    /[^\w.-]/g,
    "_"
  );

  const handle = await root.getFileHandle(safeName, { create: true });
  const writable = await handle.createWritable();

  const reader = file.stream().getReader();

  let written = 0;
  let closed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      if (value) {
        await writable.write(value);
        written += value.byteLength;

        if (file.size > 0 && onProgress) {
          onProgress(Math.min(1, written / file.size));
        }
      }
    }

    await writable.close();
    closed = true;

    const copiedFile = await handle.getFile();

    /**
     * Important:
     * OPFS may not preserve the MIME type, so wrap the copied file with
     * the original filename and a known video type.
     *
     * This does NOT read the whole video into RAM like arrayBuffer().
     */
    return new File([copiedFile], safeOriginalName, {
      type: guessVideoMimeType(file),
      lastModified: Date.now(),
    });
  } catch (err) {
    if (!closed) {
      try {
        await writable.abort();
      } catch {
        // Ignore abort errors.
      }
    }

    throw err;
  } finally {
    reader.releaseLock();
  }
}