import { readPhotoMeta } from "./photoMeta";

/**
 * Getting a phone photo onto the server quickly.
 *
 * A modern phone camera produces a 3–5 MB file. The server only keeps 2048px
 * anyway, so sending the full thing is time the inspector spends standing in the
 * room waiting. Shrinking on the device first turns that into a few hundred KB.
 *
 * The catch is that drawing to a canvas throws the EXIF away, and the EXIF is
 * where the photo's GPS lives — which is what places the pin when the finding
 * becomes work. So the metadata is read off the original first and sent
 * alongside the smaller file.
 *
 * Anything the browser cannot decode — HEIC outside Safari, mostly — is sent
 * untouched and the server handles it exactly as before. So is anything whose
 * metadata could not be read: the server's reader is the reference one, and it
 * is better to spend the bandwidth than to shrink a photo's location away and
 * leave nobody able to recover it.
 */
export interface PreparedPhoto {
  file: File;
  /** Read off the original before the resize dropped it. Null when there was none. */
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: string | null;
  /** False when the original is being sent as-is. */
  shrunk: boolean;
}

const MAX_EDGE = 2048;
/** Below this there is nothing worth saving, so don't spend the time or the quality. */
const WORTH_SHRINKING = 900 * 1024;

function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.82
    );
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const untouched: PreparedPhoto = { file, gpsLat: null, gpsLng: null, takenAt: null, shrunk: false };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC on a browser that cannot read it, or something that isn't an image at
    // all. Either way the server is better placed to decide.
    return untouched;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_EDGE && file.size < WORTH_SHRINKING) {
    bitmap.close();
    return untouched;
  }

  const meta = await readPhotoMeta(file);
  // Could not read it, so do not destroy it. The server tries harder than we can.
  if (!meta.read) {
    bitmap.close();
    return untouched;
  }

  const scale = Math.min(1, MAX_EDGE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return untouched;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const shrunk = await canvasToFile(canvas, file.name || "photo.jpg");
  // A small original re-encoded can come out larger; keep whichever is smaller.
  if (!shrunk || shrunk.size >= file.size) return untouched;
  return { file: shrunk, gpsLat: meta.gpsLat, gpsLng: meta.gpsLng, takenAt: meta.takenAt, shrunk: true };
}
