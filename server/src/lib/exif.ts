import exifr from "exifr";

export interface ExifResult {
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: Date | null;
}

export async function readExif(filePath: string): Promise<ExifResult> {
  try {
    const gps = await exifr.gps(filePath).catch(() => null);
    const meta = await exifr.parse(filePath, { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null);
    const takenAt = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;

    return {
      hasGps: !!gps,
      gpsLat: gps?.latitude ?? null,
      gpsLng: gps?.longitude ?? null,
      takenAt: takenAt ? new Date(takenAt) : null,
    };
  } catch {
    return { hasGps: false, gpsLat: null, gpsLng: null, takenAt: null };
  }
}
