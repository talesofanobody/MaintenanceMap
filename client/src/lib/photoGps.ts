import exifr from "exifr";

export interface PhotoGps {
  latitude: number;
  longitude: number;
}

const MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function isTiffHeader(b: Uint8Array, at: number): boolean {
  if (at + 4 > b.length) return false;
  return (b[at] === 0x4d && b[at + 1] === 0x4d && b[at + 2] === 0x00 && b[at + 3] === 0x2a) ||
    (b[at] === 0x49 && b[at + 1] === 0x49 && b[at + 2] === 0x2a && b[at + 3] === 0x00);
}

// HEIC containers list an "Exif" item type before the payload, which exifr's HEIC
// reader trips over. Find the marker that is actually followed by a TIFF header.
function findEmbeddedTiff(bytes: Uint8Array): Uint8Array | null {
  outer: for (let i = 0; i <= bytes.length - MARKER.length - 4; i++) {
    for (let j = 0; j < MARKER.length; j++) {
      if (bytes[i + j] !== MARKER[j]) continue outer;
    }
    const at = i + MARKER.length;
    if (isTiffHeader(bytes, at)) return bytes.subarray(at);
  }
  return null;
}

export async function readPhotoGps(file: File): Promise<PhotoGps | null> {
  try {
    const direct = await exifr.gps(file).catch(() => null);
    if (direct) return direct;
  } catch {
    // fall through to the container scan
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tiff = findEmbeddedTiff(bytes);
    if (!tiff) return null;
    const gps = await exifr.gps(tiff.slice().buffer).catch(() => null);
    return gps ?? null;
  } catch {
    return null;
  }
}
