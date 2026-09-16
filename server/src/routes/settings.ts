import { Router } from "express";
import { ADMIN_ONLY } from "../middleware/requireAuth";
import { getSettings, saveSettings, DEFAULT_SETTINGS } from "../lib/settings";
import { ValidationError } from "../lib/validation";
import { logActivity } from "../lib/activity";

export const settingsRouter = Router();

// Everyone signed in can read settings (the client needs turnaround days for due-date defaults).
settingsRouter.get("/", async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS });
});

settingsRouter.put("/", ADMIN_ONLY, async (req, res) => {
  try {
    const before = await getSettings();
    const settings = await saveSettings(req.body);
    const changes: string[] = [];
    for (const p of ["urgent", "high", "medium", "low"] as const) {
      if (before.slaDays[p] !== settings.slaDays[p]) changes.push(`${p} turnaround ${before.slaDays[p]} → ${settings.slaDays[p]} days`);
    }
    if (before.warnAtPercent !== settings.warnAtPercent) changes.push(`warning at ${before.warnAtPercent}% → ${settings.warnAtPercent}%`);
    if (before.escalation.enabled !== settings.escalation.enabled) changes.push(`escalation ${settings.escalation.enabled ? "on" : "off"}`);
    if (before.escalation.afterOverdueDays !== settings.escalation.afterOverdueDays) {
      changes.push(`escalate after ${before.escalation.afterOverdueDays} → ${settings.escalation.afterOverdueDays} overdue days`);
    }
    await logActivity(req, {
      action: "settings.updated",
      entityType: "system",
      entityId: "settings",
      summary: changes.length ? `Settings: ${changes.join(" · ")}` : "Settings saved (no changes)",
    });
    res.json({ settings, defaults: DEFAULT_SETTINGS });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});
