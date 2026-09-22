import exifr from "exifr";

/**
 * Reading a photo's GPS in the browser.
 *
 * This mirrors `server/src/lib/exif.ts` and has to stay in step with it. The
 * reason it exists at all: once a photo is resized through a canvas its EXIF is
 * gone, so whatever we want to keep has to be read off the original first.
 *
 * Handing exifr a HEIC directly does not work. A HEIF container declares an
 * "Exif" item in its metadata boxes before the real payload turns up, which
 * throws exifr's reader off — a plain `exifr.gps()` on an iPhone photo returns
 * nothing at all. Since an iPhone photo is the common case, that silently cost
 * every iPhone user their location. So: locate the marker that is genuinely
 * followed by a TIFF header and parse that slice instead, exactly as the server
 * does.
 */

export interface PhotoMeta {
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: string | null;
  /** False when nothing could be read — which is not the same as "there is none". */
  read: boolean;
}

export const NO_META: PhotoMeta = { gpsLat: null, gpsLng: null, takenAt: null, read: false };

const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function isTiffHeader(buf: Uint8Array, at: number): boolean {
  if (at + 4 > buf.length) return false;
  const [a, b, c, d] = [buf[at], buf[at + 1], buf[at + 2], buf[at + 3]];
  return (a === 0x4d && b === 0x4d && c === 0x00 && d === 0x2a) || (a === 0x49 && b === 0x49 && c === 0x2a && d === 0x00);
}

function indexOfMarker(buf: Uint8Array, from: number): number {
  outer: for (let i = from; i <= buf.length - EXIF_MARKER.length; i++) {
    for (let j = 0; j < EXIF_MARKER.length; j++) {
      if (buf[i + j] !== EXIF_MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** The TIFF block inside a HEIF container, or null if there isn't a real one. */
function extractEmbeddedTiff(buf: Uint8Array): Uint8Array | null {
  let from = 0;
  while (from < buf.length) {
    const idx = indexOfMarker(buf, from);
    if (idx === -1) break;
    const tiffAt = idx + EXIF_MARKER.length;
    if (isTiffHeader(buf, tiffAt)) return buf.subarray(tiffAt);
    from = idx + 1;
  }
  return null;
}

async function parseWith(input: File | Uint8Array): Promise<PhotoMeta | null> {
  const [gps, meta] = await Promise.all([
    exifr.gps(input as any).catch(() => null),
    exifr.parse(input as any, { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null),
  ]);
  if (!gps && !meta) return null;
  const taken = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;
  const when = taken instanceof Date ? taken : taken ? new Date(taken) : null;
  return {
    gpsLat: typeof gps?.latitude === "number" ? gps.latitude : null,
    gpsLng: typeof gps?.longitude === "number" ? gps.longitude : null,
    takenAt: when && !isNaN(when.getTime()) ? when.toISOString() : null,
    read: true,
  };
}

export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const direct = await parseWith(file);
    if (direct && (direct.gpsLat !== null || direct.takenAt)) return direct;

    // Nothing useful came back, so try the HEIF path before giving up.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tiff = extractEmbeddedTiff(bytes);
    if (tiff) {
      const fallback = await parseWith(tiff);
      if (fallback) return fallback;
    }
    return direct ?? NO_META;
  } catch {
    return NO_META;
  }
}
