export class ValidationError extends Error {}

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseOptionalString(value: unknown, field: string, max = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`invalid ${field}`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed === "" ? null : trimmed;
}

export function parseOptionalHours(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10000) {
    throw new ValidationError(`invalid ${field}`);
  }
  return Math.round(n * 4) / 4;
}

export function parseOptionalDay(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_ONLY.test(value)) throw new ValidationError(`invalid ${field} (expected YYYY-MM-DD)`);
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ValidationError(`invalid ${field}`);
  }
  return value;
}

// Default turnaround per priority, used when an issue is saved without a due date.
export const SLA_DAYS: Record<string, number> = { urgent: 0, high: 3, medium: 14, low: 30 };

export function dayFrom(date: Date, offsetDays: number): string {
  const d = new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86_400_000);
}

export function defaultDueDate(priority: string, baseDay?: string | null, slaDays: Record<string, number> = SLA_DAYS): string {
  const offset = slaDays[priority] ?? 14;
  if (baseDay && DATE_ONLY.test(baseDay)) {
    const [y, m, d] = baseDay.split("-").map(Number);
    return dayFrom(new Date(Date.UTC(y, m - 1, d)), offset);
  }
  return dayFrom(new Date(), offset);
}

export function parseWeeklyHours(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 7) throw new ValidationError("weeklyHours must have 7 entries (Monday first)");
  return value.map((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 24) throw new ValidationError("weeklyHours entries must be 0-24");
    return Math.round(n * 4) / 4;
  });
}

const COLOR = /^#[0-9a-f]{6}$/i;

export function parseColor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !COLOR.test(value)) throw new ValidationError("color must be a hex value like #2563eb");
  return value.toLowerCase();
}
