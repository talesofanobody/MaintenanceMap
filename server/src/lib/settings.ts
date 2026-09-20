import { prisma } from "../db";
import { ValidationError } from "./validation";
import { DEFAULT_RESPONSE_HOURS, PRIORITY_ORDER, PRIORITY_WORDS, type PriorityKey } from "./workflow";

export { PRIORITY_ORDER, nextPriority, type PriorityKey } from "./workflow";

export interface AppSettings {
  /** Hours allowed to resolve an issue of each priority, counted from when it is logged. */
  responseHours: Record<PriorityKey, number>;
  /** Warn the technician once this share of the window has elapsed (0 disables). */
  warnAtPercent: number;
  escalation: {
    enabled: boolean;
    /** Raise the priority one level once an issue is overdue by this many hours, and again every N hours. */
    afterOverdueHours: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  responseHours: { ...DEFAULT_RESPONSE_HOURS },
  warnAtPercent: 80,
  escalation: { enabled: true, afterOverdueHours: 72 },
};

const ROW_ID = "app";
let cache: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const row = await prisma.setting.findUnique({ where: { id: ROW_ID } });
  let stored: Record<string, any> = {};
  if (row) {
    try {
      stored = JSON.parse(row.json);
    } catch {
      stored = {};
    }
  }
  cache = merge(stored);
  return cache;
}

export async function saveSettings(input: unknown): Promise<AppSettings> {
  const next = validate(input);
  await prisma.setting.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, json: JSON.stringify(next) },
    update: { json: JSON.stringify(next) },
  });
  cache = next;
  return next;
}

/** Clears the cached copy; only the tests and the settings route need this. */
export function forgetSettings(): void {
  cache = null;
}

/**
 * Reads whatever shape is on disk. Installs written before response windows were
 * measured in hours stored whole days per priority, so those are converted rather than
 * thrown away — and they had no "critical", which picks up the default.
 */
function merge(stored: Record<string, any>): AppSettings {
  const hours: Record<string, number> = { ...DEFAULT_SETTINGS.responseHours };
  if (stored.slaDays && typeof stored.slaDays === "object") {
    for (const [key, days] of Object.entries(stored.slaDays)) {
      if (typeof days === "number" && Number.isFinite(days)) hours[key] = Math.max(1, Math.round(days * 24));
    }
  }
  if (stored.responseHours && typeof stored.responseHours === "object") {
    for (const [key, value] of Object.entries(stored.responseHours)) {
      if (typeof value === "number" && Number.isFinite(value)) hours[key] = value;
    }
  }
  const esc = stored.escalation ?? {};
  return {
    responseHours: hours as Record<PriorityKey, number>,
    warnAtPercent: stored.warnAtPercent ?? DEFAULT_SETTINGS.warnAtPercent,
    escalation: {
      enabled: esc.enabled === undefined ? DEFAULT_SETTINGS.escalation.enabled : !!esc.enabled,
      afterOverdueHours:
        typeof esc.afterOverdueHours === "number"
          ? esc.afterOverdueHours
          : typeof esc.afterOverdueDays === "number"
            ? esc.afterOverdueDays * 24
            : DEFAULT_SETTINGS.escalation.afterOverdueHours,
    },
  };
}

function intIn(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

/** Full validation of a settings payload; unknown keys are dropped. */
export function validate(input: unknown): AppSettings {
  if (!input || typeof input !== "object") throw new ValidationError("settings must be an object");
  const body = input as Record<string, any>;
  const given = body.responseHours ?? {};
  const responseHours = {} as Record<PriorityKey, number>;
  for (const key of PRIORITY_ORDER) {
    responseHours[key] = intIn(given[key] ?? DEFAULT_SETTINGS.responseHours[key], `${PRIORITY_WORDS[key]} response window`, 1, 8760);
  }
  // Ascending priority must not get a longer window than the one below it.
  for (let i = 1; i < PRIORITY_ORDER.length; i++) {
    const lower = PRIORITY_ORDER[i - 1];
    const higher = PRIORITY_ORDER[i];
    if (responseHours[higher] > responseHours[lower]) {
      throw new ValidationError(
        `${PRIORITY_WORDS[higher]} can't have a longer window than ${PRIORITY_WORDS[lower]} — the more urgent the work, the less time there is.`
      );
    }
  }
  const esc = body.escalation ?? {};
  return {
    responseHours,
    warnAtPercent: intIn(body.warnAtPercent ?? DEFAULT_SETTINGS.warnAtPercent, "Warning threshold", 0, 100),
    escalation: {
      enabled: esc.enabled === undefined ? DEFAULT_SETTINGS.escalation.enabled : !!esc.enabled,
      afterOverdueHours: intIn(esc.afterOverdueHours ?? DEFAULT_SETTINGS.escalation.afterOverdueHours, "Escalate after", 1, 2160),
    },
  };
}
