import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import convert from "heic-convert";
import { UPLOADS_DIR } from "./upload";

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

export function isHeic(buffer: Buffer, originalName: string): boolean {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".heic" || ext === ".heif") return true;
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return HEIF_BRANDS.has(buffer.toString("ascii", 8, 12).toLowerCase());
  }
  return false;
}

export interface StoredImage {
  filename: string;
  thumbFilename: string;
}

// Normalises any accepted upload into web-friendly JPEGs: HEIC is decoded first,
// EXIF orientation is baked in, and a capped full-size + a thumbnail are written.
export async function storeImage(buffer: Buffer, originalName: string): Promise<StoredImage> {
  let source: Buffer = buffer;
  if (isHeic(buffer, originalName)) {
    source = Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.92 }));
  }

  const id = crypto.randomUUID();
  const filename = `${id}.jpg`;
  const thumbFilename = `${id}_thumb.jpg`;

  const base = sharp(source, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });

  await base
    .clone()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(path.join(UPLOADS_DIR, filename));

  await base
    .clone()
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(path.join(UPLOADS_DIR, thumbFilename));

  return { filename, thumbFilename };
}
