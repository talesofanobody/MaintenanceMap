import { prisma } from "../db";
import { ValidationError } from "./validation";

export type PriorityKey = "urgent" | "high" | "medium" | "low";
export const PRIORITY_ORDER: PriorityKey[] = ["low", "medium", "high", "urgent"];

export interface AppSettings {
  /** Calendar days allowed to resolve an issue of each priority (0 = same day). */
  slaDays: Record<PriorityKey, number>;
  /** Warn the technician once this share of the turnaround has elapsed (0 disables). */
  warnAtPercent: number;
  escalation: {
    enabled: boolean;
    /** Raise the priority one level once an issue is overdue by this many days, and again every N days. */
    afterOverdueDays: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  slaDays: { urgent: 0, high: 3, medium: 14, low: 30 },
  warnAtPercent: 80,
  escalation: { enabled: true, afterOverdueDays: 3 },
};

const ROW_ID = "app";
let cache: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const row = await prisma.setting.findUnique({ where: { id: ROW_ID } });
  let stored: Partial<AppSettings> = {};
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

function merge(stored: Partial<AppSettings>): AppSettings {
  return {
    slaDays: { ...DEFAULT_SETTINGS.slaDays, ...(stored.slaDays ?? {}) },
    warnAtPercent: stored.warnAtPercent ?? DEFAULT_SETTINGS.warnAtPercent,
    escalation: { ...DEFAULT_SETTINGS.escalation, ...(stored.escalation ?? {}) },
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
  const sla = body.slaDays ?? {};
  const slaDays = {
    urgent: intIn(sla.urgent ?? DEFAULT_SETTINGS.slaDays.urgent, "Urgent turnaround", 0, 365),
    high: intIn(sla.high ?? DEFAULT_SETTINGS.slaDays.high, "High turnaround", 0, 365),
    medium: intIn(sla.medium ?? DEFAULT_SETTINGS.slaDays.medium, "Medium turnaround", 0, 365),
    low: intIn(sla.low ?? DEFAULT_SETTINGS.slaDays.low, "Low turnaround", 0, 365),
  };
  if (!(slaDays.urgent <= slaDays.high && slaDays.high <= slaDays.medium && slaDays.medium <= slaDays.low)) {
    throw new ValidationError("Turnaround must not get shorter as priority goes down (urgent ≤ high ≤ medium ≤ low).");
  }
  const esc = body.escalation ?? {};
  return {
    slaDays,
    warnAtPercent: intIn(body.warnAtPercent ?? DEFAULT_SETTINGS.warnAtPercent, "Warning threshold", 0, 100),
    escalation: {
      enabled: esc.enabled === undefined ? DEFAULT_SETTINGS.escalation.enabled : !!esc.enabled,
      afterOverdueDays: intIn(esc.afterOverdueDays ?? DEFAULT_SETTINGS.escalation.afterOverdueDays, "Escalate after", 1, 90),
    },
  };
}

export function nextPriority(priority: string): PriorityKey | null {
  const idx = PRIORITY_ORDER.indexOf(priority as PriorityKey);
  if (idx < 0 || idx === PRIORITY_ORDER.length - 1) return null;
  return PRIORITY_ORDER[idx + 1];
}
