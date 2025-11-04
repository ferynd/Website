"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: client-side compression defaults              */
/* ------------------------------------------------------------ */
const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 0.8;
const KB = 1024;
const MB = KB * 1024;

export interface PreparedImage {
  blob: Blob;
  contentType: string;
  extension: string;
  hash: string;
  normalizedName: string;
  originalName: string;
  size: number;
  width: number;
  height: number;
}

export const formatFileSize = (bytes: number): string => {
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(2)} MB`;
  }
  if (bytes >= KB) {
    return `${Math.round(bytes / KB)} KB`;
  }
  return `${bytes} B`;
};

const computeSha1 = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const normalizeBaseName = (fileName: string): string => {
  const base = fileName.replace(/\.[^/.]+$/, '').trim();
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'upload';
};

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

const readExifOrientation = async (file: File): Promise<number> => {
  if (!file.type.toLowerCase().includes('jpeg')) {
    return 1;
  }
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 2 || view.getUint16(0, false) !== 0xffd8) {
    return 1;
  }
  let offset = 2;
  while (offset + 1 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      if (offset + 2 > view.byteLength) {
        break;
      }
      const length = view.getUint16(offset, false);
      offset += 2;
      if (offset + length - 2 > view.byteLength) {
        break;
      }
      if (view.getUint32(offset, false) !== 0x45786966) {
        offset += length - 2;
        continue;
      }
      offset += 6;
      const littleEndian = view.getUint16(offset, false) === 0x4949;
      const ifdOffset = view.getUint32(offset + 4, littleEndian);
      offset += ifdOffset;
      if (offset + 2 > view.byteLength) {
        break;
      }
      const tags = view.getUint16(offset, littleEndian);
      offset += 2;
      for (let index = 0; index < tags; index += 1) {
        const tagOffset = offset + index * 12;
        if (tagOffset + 10 > view.byteLength) {
          continue;
        }
        if (view.getUint16(tagOffset, littleEndian) === 0x0112) {
          return view.getUint16(tagOffset + 8, littleEndian);
        }
      }
      break;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      if (offset + 2 > view.byteLength) {
        break;
      }
      const skip = view.getUint16(offset, false);
      offset += skip;
    }
  }
  return 1;
};

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };
    image.src = url;
  });

const applyOrientationTransform = (
  context: CanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number,
): void => {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
};

const extensionFromType = (type: string): string => {
  if (type === 'image/png') {
    return 'png';
  }
  if (type === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
};

export async function compressFile(
  file: File,
  maxWidth = DEFAULT_MAX_WIDTH,
  quality = DEFAULT_QUALITY,
): Promise<PreparedImage> {
  ensureImageFile(file);

  const [orientation, imageElement] = await Promise.all([
    readExifOrientation(file),
    loadImageElement(file),
  ]);

  const sourceWidth = imageElement.naturalWidth || imageElement.width;
  const sourceHeight = imageElement.naturalHeight || imageElement.height;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const swapsDimensions = orientation >= 5 && orientation <= 8;
  const canvas = document.createElement('canvas');
  canvas.width = swapsDimensions ? targetHeight : targetWidth;
  canvas.height = swapsDimensions ? targetWidth : targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable');
  }

  context.save();
  applyOrientationTransform(context, orientation, targetWidth, targetHeight);
  context.drawImage(imageElement, 0, 0, targetWidth, targetHeight);
  context.restore();

  const preferPng = file.type === 'image/png';
  const jpegBlob = await toBlob(canvas, 'image/jpeg', quality);
  let outputBlob = jpegBlob;
  let outputType = 'image/jpeg';

  if (preferPng) {
    const pngBlob = await toBlob(canvas, 'image/png', 1);
    if (pngBlob.size <= jpegBlob.size) {
      outputBlob = pngBlob;
      outputType = 'image/png';
    }
  }

  const hash = await computeSha1(outputBlob);
  const normalizedName = normalizeBaseName(file.name);
  const extension = extensionFromType(outputType);

  return {
    blob: outputBlob,
    contentType: outputType,
    extension,
    hash,
    normalizedName,
    originalName: file.name,
    size: outputBlob.size,
    width: canvas.width,
    height: canvas.height,
  };
}

