import * as ort from "onnxruntime-web";

// Next.js can be tricky with WASM files, so we pull the engine directly from a CDN
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

let session: ort.InferenceSession | null = null;

export async function loadModel() {
  if (!session) {
    // Load your custom AI brain!
    session = await ort.InferenceSession.create("/best.onnx", {
      executionProviders: ["wasm"],
    });
  }
  return session;
}

export async function detectBarbell(video: HTMLVideoElement) {
  if (!session) await loadModel();

  const size = 640; // The resolution you trained the model at

  // 1. Draw the current video frame to a hidden canvas
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  // 2. Preprocess: Convert image to a 3D Tensor array for the AI (RGB, normalized 0-1)
  const float32Data = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    float32Data[i] = data[i * 4] / 255.0; // R
    float32Data[size * size + i] = data[i * 4 + 1] / 255.0; // G
    float32Data[2 * size * size + i] = data[i * 4 + 2] / 255.0; // B
  }

  const tensor = new ort.Tensor("float32", float32Data, [1, 3, size, size]);

  // 3. Run Inference (Ask the AI where the plate is)
  const results = await session!.run({ images: tensor });
  const output = results[session!.outputNames[0]];

  // 4. Postprocess: Decode the YOLOv8 output
  const outData = output.data as Float32Array;
  const numColumns = 8400; // YOLOv8 splits the image into 8400 possible boxes

  let bestScore = 0;
  let bestBox = null;

  // YOLO output rows: [x, y, w, h, score_person, score_barbell]
  // Row 5 is the Barbell class confidence score
  for (let col = 0; col < numColumns; col++) {
    const scoreBarbell = outData[5 * numColumns + col];

    // If it's more than 50% confident it's a barbell, keep it
    if (scoreBarbell > bestScore && scoreBarbell > 0.5) {
      bestScore = scoreBarbell;
      bestBox = {
        x: outData[0 * numColumns + col],
        y: outData[1 * numColumns + col],
        w: outData[2 * numColumns + col],
        h: outData[3 * numColumns + col],
      };
    }
  }

  if (!bestBox) return null;

  // 5. Map the 640x640 box back to your actual phone camera dimensions
  const scaleX = video.videoWidth / size;
  const scaleY = video.videoHeight / size;

  return {
    x: bestBox.x * scaleX,
    y: bestBox.y * scaleY,
    width: bestBox.w * scaleX,
    height: bestBox.h * scaleY,
    score: bestScore,
  };
}