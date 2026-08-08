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

  ctx.drawImage(video, 0, 0, size, size);
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
  const numColumns = 8400; 

  let bestScore = 0;
  let bestBox = null;

  for (let col = 0; col < numColumns; col++) {
    // Row 5 is the barbell class (Row 4 is person)
    const scoreBarbell = outData[5 * numColumns + col];

    if (scoreBarbell > bestScore) {
      bestScore = scoreBarbell;
      bestBox = {
        x: outData[0 * numColumns + col],
        y: outData[1 * numColumns + col],
        w: outData[2 * numColumns + col],
        h: outData[3 * numColumns + col],
      };
    }
  }

  console.log(`🧠 AI Best Confidence Score: ${(bestScore * 100).toFixed(1)}%`);

  // Lowered threshold to 25% to guarantee a catch
  if (bestScore < 0.25 || !bestBox) return null;

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