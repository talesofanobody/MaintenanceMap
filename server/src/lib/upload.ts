import path from "path";
import multer from "multer";

export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

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
