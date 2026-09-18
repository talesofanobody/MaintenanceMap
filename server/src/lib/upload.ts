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

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_TYPES.has(file.mimetype) && !ALLOWED_EXTS.has(ext)) {
      cb(new Error("Unsupported file type. Use JPEG, PNG, WebP or HEIC photos."));
      return;
    }
    cb(null, true);
  },
});
