// Every photo is shrunk in the browser before it is sent: 800 px on the long side, JPEG, about 100 KB.
// Drawing it again also turns it upright and drops EXIF data such as the GPS position.
import { MAX_PHOTO_BYTES, PHOTO_LONG_SIDE } from '../../server/photos/limits.ts';

export const UNREADABLE_PHOTO = "This photo couldn't be read. Take it again.";

export function targetSize(width: number, height: number, max = PHOTO_LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_PHOTO))), 'image/jpeg', quality),
  );
}

export async function shrinkPhoto(source: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(UNREADABLE_PHOTO);
  }
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(UNREADABLE_PHOTO);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.82, 0.6]) {
      const blob = await toJpeg(canvas, quality);
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
    }
    throw new Error(UNREADABLE_PHOTO);
  } finally {
    bitmap.close();
  }
}

/** The webcam's current frame as a JPEG (shrinkPhoto then brings it down to size). */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error(UNREADABLE_PHOTO));
  context.drawImage(video, 0, 0);
  return toJpeg(canvas, 0.92);
}
