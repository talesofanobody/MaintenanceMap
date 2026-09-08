import exifr from "exifr";

export interface ExifResult {
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: Date | null;
}

const EMPTY: ExifResult = { hasGps: false, gpsLat: null, gpsLng: null, takenAt: null };
const EXIF_MARKER = Buffer.from("Exif\0\0", "latin1");

function isTiffHeader(buf: Buffer, at: number): boolean {
  if (at + 4 > buf.length) return false;
  const a = buf[at], b = buf[at + 1], c = buf[at + 2], d = buf[at + 3];
  return (a === 0x4d && b === 0x4d && c === 0x00 && d === 0x2a) || (a === 0x49 && b === 0x49 && c === 0x2a && d === 0x00);
}

// HEIF containers declare an "Exif" item type in their metadata boxes before the
// actual payload appears, which confuses exifr's HEIC reader. Locate the marker
// that is really followed by a TIFF header and hand that slice to exifr instead.
function extractEmbeddedTiff(buf: Buffer): Buffer | null {
  let from = 0;
  while (from < buf.length) {
    const idx = buf.indexOf(EXIF_MARKER, from);
    if (idx === -1) break;
    const tiffAt = idx + EXIF_MARKER.length;
    if (isTiffHeader(buf, tiffAt)) return buf.subarray(tiffAt);
    from = idx + 1;
  }
  return null;
}

async function parseWith(input: Buffer | string): Promise<ExifResult | null> {
  const gps = await exifr.gps(input).catch(() => null);
  const meta = await exifr.parse(input, { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null);
  if (!gps && !meta) return null;
  const takenAt = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;
  return {
    hasGps: !!gps,
    gpsLat: gps?.latitude ?? null,
    gpsLng: gps?.longitude ?? null,
    takenAt: takenAt ? new Date(takenAt) : null,
  };
}

export async function readExif(input: Buffer | string): Promise<ExifResult> {
  try {
    const direct = await parseWith(input);
    if (direct && (direct.hasGps || direct.takenAt)) return direct;

    if (Buffer.isBuffer(input)) {
      const tiff = extractEmbeddedTiff(input);
      if (tiff) {
        const fallback = await parseWith(tiff);
        if (fallback) return fallback;
      }
    }
    return direct ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
