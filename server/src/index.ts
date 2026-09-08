import express from "express";
import cors from "cors";
import session from "express-session";
import { propertiesRouter } from "./routes/properties";
import { issuesRouter } from "./routes/issues";
import { photosRouter } from "./routes/photos";
import { authRouter } from "./routes/auth";
import { requireAuth } from "./middleware/requireAuth";
import { PrismaSessionStore, purgeExpiredSessions } from "./lib/sessionStore";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const isProduction = process.env.NODE_ENV === "production";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (isProduction) {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  console.warn("SESSION_SECRET not set — using an insecure default for local development only.");
}

const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.use(cors({ origin: CLIENT_ORIGINS, credentials: true }));
app.use(express.json({ limit: "5mb" }));

app.use(
  session({
    name: "mm.sid",
    secret: SESSION_SECRET ?? "dev-only-insecure-secret",
    store: new PrismaSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/properties", requireAuth, propertiesRouter);
app.use("/api/issues", requireAuth, issuesRouter);
app.use("/api/photos", requireAuth, photosRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`MaintenanceMap API listening on http://localhost:${PORT}`);
});
