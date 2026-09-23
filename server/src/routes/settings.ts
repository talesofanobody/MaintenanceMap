import { Router } from "express";
import { requires } from "../middleware/requireAuth";
import { getSettings, saveSettings, DEFAULT_SETTINGS } from "../lib/settings";
import { ValidationError } from "../lib/validation";
import { describeWindow, PRIORITY_ORDER } from "../lib/workflow";
import { logActivity } from "../lib/activity";

export const settingsRouter = Router();

// Everyone signed in can read settings (the client needs the response windows to show
// a default deadline on the issue form).
settingsRouter.get("/", async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS });
});

settingsRouter.put("/", requires("settings.write"), async (req, res) => {
  try {
    const before = await getSettings();
    const settings = await saveSettings(req.body);
    const changes: string[] = [];
    for (const p of PRIORITY_ORDER) {
      if (before.responseHours[p] !== settings.responseHours[p]) {
        changes.push(`${p} window ${describeWindow(before.responseHours[p])} → ${describeWindow(settings.responseHours[p])}`);
      }
    }
    if (before.warnAtPercent !== settings.warnAtPercent) changes.push(`warning at ${before.warnAtPercent}% → ${settings.warnAtPercent}%`);
    if (before.escalation.enabled !== settings.escalation.enabled) changes.push(`escalation ${settings.escalation.enabled ? "on" : "off"}`);
    if (before.escalation.afterOverdueHours !== settings.escalation.afterOverdueHours) {
      changes.push(`escalate after ${describeWindow(before.escalation.afterOverdueHours)} → ${describeWindow(settings.escalation.afterOverdueHours)} overdue`);
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
