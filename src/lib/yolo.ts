import * as ort from "onnxruntime-web";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

let session: ort.InferenceSession | null = null;

export async function loadModel() {
  if (!session) {
    session = await ort.InferenceSession.create("/best.onnx", {
      executionProviders: ["wasm"],
    });
  }
  return session;
}

export async function detectBarbell(video: HTMLVideoElement) {
  if (!session) await loadModel();

  const size = 640; 
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // 1. Letterboxing (Padding)
  // Fill the canvas with neutral gray (YOLO's default padding color)
  ctx.fillStyle = "#7f7f7f"; 
  ctx.fillRect(0, 0, size, size);

  // Calculate scaling to preserve the aspect ratio perfectly
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const scale = Math.min(size / videoWidth, size / videoHeight);
  
  const scaledWidth = videoWidth * scale;
  const scaledHeight = videoHeight * scale;
  
  // Center the image on the canvas
  const dx = (size - scaledWidth) / 2;
  const dy = (size - scaledHeight) / 2;

  // Draw the image without squashing it!
  ctx.drawImage(video, dx, dy, scaledWidth, scaledHeight);

  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  const float32Data = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    float32Data[i] = data[i * 4] / 255.0; 
    float32Data[size * size + i] = data[i * 4 + 1] / 255.0; 
    float32Data[2 * size * size + i] = data[i * 4 + 2] / 255.0; 
  }

  const tensor = new ort.Tensor("float32", float32Data, [1, 3, size, size]);
  const results = await session!.run({ images: tensor });
  const output = results[session!.outputNames[0]];

  const outData = output.data as Float32Array;
  
  // ✨ THE FIX: Dynamically read the rows and columns from the model output
  const numRows = output.dims[1];    // e.g., 5 (for 1 class) or 6 (for 2 classes)
  const numColumns = output.dims[2]; // e.g., 8400

  let bestScore = 0;
  let bestBox = null;

  for (let col = 0; col < numColumns; col++) {
    
    // Check all available classes (starts at index 4)
    let maxConfForThisCell = 0;
    for (let row = 4; row < numRows; row++) {
      const conf = outData[row * numColumns + col];
      if (conf > maxConfForThisCell) {
        maxConfForThisCell = conf;
      }
    }

    // If this cell has a better score than our current best, save it!
    if (maxConfForThisCell > bestScore) {
      bestScore = maxConfForThisCell;
      bestBox = {
        x: outData[0 * numColumns + col],
        y: outData[1 * numColumns + col],
        w: outData[2 * numColumns + col],
        h: outData[3 * numColumns + col],
      };
    }
  }

  console.log(`🧠 AI Best Confidence Score: ${(bestScore * 100).toFixed(1)}%`);

  // Lowered threshold to 0.4 since the new model is young
  if (bestScore < 0.4 || !bestBox) return null;

  // 2. Reverse the Letterboxing Math
  // Convert the box from the padded 640x640 space BACK to the original video pixels
  const originalX = (bestBox.x - dx) / scale;
  const originalY = (bestBox.y - dy) / scale;
  const originalW = bestBox.w / scale;
  const originalH = bestBox.h / scale;

  return {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
    score: bestScore,
  };
}