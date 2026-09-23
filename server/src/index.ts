import express from "express";
import path from "path";
import fs from "fs";
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
import { computeDeadline } from "./lib/validation";
import { getSettings } from "./lib/settings";
import { settingsRouter } from "./routes/settings";
import { schedulesRouter } from "./routes/schedules";
import { contractorsRouter } from "./routes/contractors";
import { plannerRouter } from "./routes/planner";
import { calendarRouter } from "./routes/calendar";
import { insightsRouter } from "./routes/insights";
import { backupsRouter } from "./routes/backups";
import { tagsRouter } from "./routes/tags";
import { rotaRouter } from "./routes/rota";
import { seedTags } from "./lib/taxonomy";
import { seedTemplates, topUpTemplates } from "./lib/inspections";
import { startBackupSchedule } from "./lib/backup";
import { ADMIN_ONLY, attachUser, requireAuth } from "./middleware/requireAuth";
import { usersRouter } from "./routes/users";
import { activityRouter } from "./routes/activity";
import { PrismaSessionStore, purgeExpiredSessions } from "./lib/sessionStore";
import { notificationsRouter } from "./routes/notifications";
import { startScheduler } from "./lib/scheduler";
import { timeRouter } from "./routes/time";
import { intakeRouter } from "./routes/intake";
import { timeOffRouter } from "./routes/timeoff";
import { scheduleRouter } from "./routes/schedule";
import { inspectionsRouter } from "./routes/inspections";
import { projectsRouter } from "./routes/projects";
import { guestReportsRouter } from "./routes/guestReports";

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
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/schedules", requireAuth, schedulesRouter);
app.use("/api/contractors", requireAuth, contractorsRouter);
app.use("/api/planner", requireAuth, plannerRouter);
app.use("/api/insights", requireAuth, insightsRouter);
app.use("/api/backups", requireAuth, backupsRouter);
app.use("/api/tags", requireAuth, tagsRouter);
app.use("/api/rota", requireAuth, rotaRouter);
app.use("/api/timeoff", requireAuth, timeOffRouter);
app.use("/api/schedule", requireAuth, scheduleRouter);
app.use("/api/inspections", requireAuth, inspectionsRouter);
app.use("/api/projects", requireAuth, projectsRouter);
// Not behind requireAuth: the secret token in the feed URL is what authorises it, so a
// calendar app can subscribe. The router guards its own session-only endpoints.
app.use("/api/calendar", calendarRouter);
// Also public, and for the same reason: a guest scanning a QR code in their room has no
// login. The secret in the link is the credential, and the router is rate-limited and
// gives back nothing about the property beyond its name.
app.use("/api/intake", intakeRouter);
app.use("/api/properties", requireAuth, propertiesRouter);
app.use("/api/issues", requireAuth, issuesRouter);
app.use("/api/photos", requireAuth, photosRouter);
app.use("/api/technicians", requireAuth, techniciansRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/export", requireAuth, ADMIN_ONLY, exportRouter);
app.use("/api/guest-reports", requireAuth, ADMIN_ONLY, guestReportsRouter);

/**
 * Serve the built client from this same process when CLIENT_DIST points at it. That
 * puts the app and its API on one origin, which is what the session cookie wants and
 * what a self-hosted install gets by default — no CORS, no second service to run.
 */
const CLIENT_DIST = process.env.CLIENT_DIST ? path.resolve(process.env.CLIENT_DIST) : null;
if (CLIENT_DIST && fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
  app.use(
    express.static(CLIENT_DIST, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // Vite fingerprints everything under assets/, so those can be cached forever.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (name === "sw.js" || name === "index.html") {
          // A cached service worker or shell would pin people to an old release.
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // Everything else is the app shell. Routing is hash-based, so this mostly catches
  // people typing the bare address, but an unknown /api path must still 404 as JSON.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
  console.log(`Serving the client from ${CLIENT_DIST}`);
}

// Issues logged before deadlines existed get one from their priority's response window,
// counted from the moment they were logged.
async function backfillDueDates() {
  const missing = await prisma.issue.findMany({ where: { OR: [{ dueDate: null }, { dueAt: null }] }, select: { id: true, priority: true, createdAt: true, scheduledFor: true } });
  if (!missing.length) return;
  const { responseHours } = await getSettings();
  for (const issue of missing) {
    const { dueAt, dueDate } = computeDeadline(issue.priority, responseHours, { now: issue.createdAt, scheduledFor: issue.scheduledFor });
    await prisma.issue.update({ where: { id: issue.id }, data: { dueDate, dueAt } });
  }
  console.log(`Backfilled deadlines for ${missing.length} issue(s).`);
}
backfillDueDates().catch((err) => console.error("due date backfill failed", err));

// The starting inspection templates, created once on an empty install.
seedTemplates()
  .then((n) => n && console.log(`Seeded ${n} inspection template(s).`))
  // An install made before a checklist improvement gets the new points added.
  .then(() => topUpTemplates())
  .then((n) => n && console.log(`Added ${n} new checklist point(s) to the existing templates.`))
  .catch((err) => console.error("template seed failed", err));

// The hotel/tourism tag set, created once on an empty install.
seedTags()
  .then((n) => n && console.log(`Seeded ${n} default tags.`))
  .catch((err) => console.error("tag seed failed", err));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

// Turns due/start dates into reminders every 15 minutes.
startScheduler();

// One database + photos archive a day, kept for a fortnight.
startBackupSchedule();

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`MaintenanceMap API listening on http://localhost:${PORT}`);
});
