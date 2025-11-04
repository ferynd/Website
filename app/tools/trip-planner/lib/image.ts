"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: client-side compression defaults              */
/* ------------------------------------------------------------ */
const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 0.8;

const ensureImageFile = (file: File) => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are supported');
  }
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Image compression failed'));
      }
    }, type, quality);
  });

export async function compressFile(
  file: File,
  maxWidth = DEFAULT_MAX_WIDTH,
  quality = DEFAULT_QUALITY,
): Promise<Blob> {
  ensureImageFile(file);

  const imageBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxWidth / imageBitmap.width);
  const width = Math.max(1, Math.round(imageBitmap.width * scale));
  const height = Math.max(1, Math.round(imageBitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    imageBitmap.close?.();
    throw new Error('Canvas 2D context is unavailable');
  }

  context.drawImage(imageBitmap, 0, 0, width, height);
  imageBitmap.close?.();

  const mimeType = file.type === 'image/png' ? 'image/jpeg' : file.type;
  return toBlob(canvas, mimeType, quality);
}

