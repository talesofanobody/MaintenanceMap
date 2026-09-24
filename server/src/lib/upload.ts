import fs from "fs";
import path from "path";
import multer from "multer";

/**
 * Where uploaded photos are written. Configurable so a container can point it at a
 * mounted volume; otherwise it sits next to the source as it always has.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "..", "..", "uploads");

// A fresh volume starts empty, and sharp won't create the directory for us.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
// iPhone HEIC files often arrive as application/octet-stream, so also accept by extension.
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

function uploader(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_TYPES.has(file.mimetype) && !ALLOWED_EXTS.has(ext)) {
        cb(new Error("Unsupported file type. Use JPEG, PNG, WebP or HEIC photos."));
        return;
      }
      cb(null, true);
    },
  });
}

/** Staff uploads, behind a login. */
export const upload = uploader(30 * 1024 * 1024);

/**
 * What a guest may send, which is smaller on purpose.
 *
 * Nothing about this path is authenticated: anyone with the room's QR code can
 * hand the server images, and every one of them is decoded by sharp — or, for
 * HEIC, by a pure-JavaScript decoder — before anything else knows they exist.
 * Four thirty-megabyte files is a hundred and twenty megabytes of decoding per
 * request, which is a lot to offer a stranger on a container this size.
 *
 * Twelve is still roughly three times what a phone produces, so no real guest
 * notices, and the worst case drops by more than half. The hourly rate limit is
 * the other half of the answer.
 */
export const guestUpload = uploader(12 * 1024 * 1024);
