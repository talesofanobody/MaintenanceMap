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
 * untouched, because there is nothing else to be done with it and the server
 * handles it exactly as before. Everything it can decode is shrunk, whether or
 * not the metadata came out, and `metaRead` says which happened so the caller
 * can supply the phone's fix instead.
 */
export interface PreparedPhoto {
  file: File;
  /** Read off the original before the resize dropped it. Null when there was none. */
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: string | null;
  /** False when the original is being sent as-is. */
  shrunk: boolean;
  /**
   * Whether the photo's own metadata could be parsed. False means the location
   * has to come from somewhere else — the phone's fix — because the resize has
   * now thrown the original's away.
   */
  metaRead: boolean;
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
  const untouched: PreparedPhoto = { file, gpsLat: null, gpsLng: null, takenAt: null, shrunk: false, metaRead: false };

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

  /**
   * Read what we can, then shrink regardless.
   *
   * This used to send the original whenever the metadata could not be parsed, on
   * the grounds that the server's reader is better and it was worth the bandwidth
   * to keep a photo's location recoverable. Measured, that trade was far worse
   * than it looked: a 12MP phone photo is 8.7MB, which is fourteen seconds on a
   * hotel's uplink against two for the shrunk version. Nobody stands in a
   * corridor for fourteen seconds a photo, and on a walk of thirty that is seven
   * minutes of waiting to protect a location that the walk already knows.
   *
   * So: always shrink, and tell the caller whether anything was read. Where it
   * was not, the caller has the phone's own fix to fall back on, which is what
   * every screen that takes photos now holds anyway.
   */
  const meta = await readPhotoMeta(file);

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
  if (!shrunk || shrunk.size >= file.size) return { ...untouched, gpsLat: meta.gpsLat, gpsLng: meta.gpsLng, takenAt: meta.takenAt, metaRead: meta.read };
  return { file: shrunk, gpsLat: meta.gpsLat, gpsLng: meta.gpsLng, takenAt: meta.takenAt, shrunk: true, metaRead: meta.read };
}
