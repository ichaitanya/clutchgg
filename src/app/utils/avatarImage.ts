// avatarImage.ts — client-side avatar pipeline.
//
// We optimize in the browser (Canvas) because this is a Vite SPA with no Node
// server to run Sharp. The browser produces the final 512x512 WEBP; the
// `update-profile` edge function then RE-VALIDATES the bytes and runs moderation
// before anything is stored, so a tampered client cannot bypass the rules — the
// browser step is for UX/perf (small upload, instant preview), not security.
//
// Pipeline: validate file → decode → center-crop to square → draw 512x512 →
// encode WEBP q0.80 → (downscale quality if still over the size target).

export const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB raw upload cap
export const TARGET_DIM = 512;
export const TARGET_MAX_BYTES = 150 * 1024; // aim under 150 KB

export class AvatarError extends Error {}

// Reject obviously-bad files before doing any work. The animated-GIF / wrong-type
// rejection is enforced again server-side; this is the fast first gate.
export function validateAvatarFile(file: File): void {
  const type = (file.type || "").toLowerCase();
  if (type === "image/gif") {
    throw new AvatarError("GIFs and animated images aren't allowed. Please use a still photo.");
  }
  if (!ALLOWED_MIME.includes(type)) {
    throw new AvatarError("Unsupported format. Please upload a JPG, PNG, or WEBP image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AvatarError("That image is over 5 MB. Please choose a smaller file.");
  }
  if (file.size === 0) {
    throw new AvatarError("That file appears to be empty or corrupted.");
  }
}

// Load a File into an HTMLImageElement, rejecting decode failures (corrupted
// files surface here as an onerror).
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarError("This image is invalid or corrupted. Please try a different file."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new AvatarError("Could not process the image. Please try again.")),
      "image/webp",
      quality,
    );
  });
}

export interface OptimizedAvatar {
  blob: Blob;       // final WEBP bytes
  base64: string;   // bare base64 (no data: prefix) for the edge function
  width: number;
  height: number;
  bytes: number;
}

// Produce a 512x512 center-cropped (cover) WEBP under the size target.
export async function optimizeAvatar(file: File): Promise<OptimizedAvatar> {
  validateAvatarFile(file);
  const img = await loadImage(file);

  const sw = img.naturalWidth, sh = img.naturalHeight;
  if (!sw || !sh) throw new AvatarError("This image is invalid or corrupted. Please try a different file.");

  // Center-crop to a square (cover): take the largest centered square of the
  // source, then scale it to TARGET_DIM.
  const side = Math.min(sw, sh);
  const sx = Math.floor((sw - side) / 2);
  const sy = Math.floor((sh - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_DIM;
  canvas.height = TARGET_DIM;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("Your browser can't process images here. Please try another browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_DIM, TARGET_DIM);

  // Encode, stepping quality down if we overshoot the size target. Canvas
  // re-encode already strips EXIF/metadata, so the saved file is clean.
  let quality = 0.8;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > TARGET_MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }

  const base64 = await blobToBase64(blob);
  return { blob, base64, width: TARGET_DIM, height: TARGET_DIM, bytes: blob.size };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new AvatarError("Could not read the processed image."));
    reader.readAsDataURL(blob);
  });
}
