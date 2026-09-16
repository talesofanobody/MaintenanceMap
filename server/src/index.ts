import express from "express";
import cors from "cors";
import session from "express-session";
import { propertiesRouter } from "./routes/properties";
import { issuesRouter } from "./routes/issues";
import { photosRouter } from "./routes/photos";
import { authRouter } from "./routes/auth";
import { techniciansRouter } from "./routes/technicians";
import { dashboardRouter } from "./routes/dashboard";
import { exportRouter } from "./routes/export";
import { prisma } from "./db";
import { dayFrom, SLA_DAYS } from "./lib/validation";
import { ADMIN_ONLY, attachUser, requireAuth } from "./middleware/requireAuth";
import { usersRouter } from "./routes/users";
import { activityRouter } from "./routes/activity";
import { PrismaSessionStore, purgeExpiredSessions } from "./lib/sessionStore";
import { notificationsRouter } from "./routes/notifications";
import { startScheduler } from "./lib/scheduler";
import { timeRouter } from "./routes/time";

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

app.use(attachUser);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/users", requireAuth, ADMIN_ONLY, usersRouter);
app.use("/api/activity", requireAuth, activityRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/time", requireAuth, timeRouter);
app.use("/api/properties", requireAuth, propertiesRouter);
app.use("/api/issues", requireAuth, issuesRouter);
app.use("/api/photos", requireAuth, photosRouter);
app.use("/api/technicians", requireAuth, techniciansRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/export", requireAuth, ADMIN_ONLY, exportRouter);

// Issues created before due dates existed get one from their priority's turnaround,
// counted from the day they were logged.
async function backfillDueDates() {
  const missing = await prisma.issue.findMany({ where: { dueDate: null }, select: { id: true, priority: true, createdAt: true } });
  for (const issue of missing) {
    await prisma.issue.update({ where: { id: issue.id }, data: { dueDate: dayFrom(issue.createdAt, SLA_DAYS[issue.priority] ?? 14) } });
  }
  if (missing.length) console.log(`Backfilled due dates for ${missing.length} issue(s).`);
}
backfillDueDates().catch((err) => console.error("due date backfill failed", err));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

// Turns due/start dates into reminders every 15 minutes.
startScheduler();

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`MaintenanceMap API listening on http://localhost:${PORT}`);
});
