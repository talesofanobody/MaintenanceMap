export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function durationMs(fromIso: string, to: string | Date = new Date()): number {
  const end = typeof to === "string" ? new Date(to) : to;
  return Math.max(0, end.getTime() - new Date(fromIso).getTime());
}

export function formatDurationMs(ms: number): string {
  if (ms < HOUR) return "under an hour";
  if (ms < 2 * DAY) {
    const hours = Math.round(ms / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(ms / DAY);
  if (days < 21) return `${days} days`;
  if (days < 90) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function formatDuration(fromIso: string, to: string | Date = new Date()): string {
  return formatDurationMs(durationMs(fromIso, to));
}

// <input type="date"> works in local calendar days; keep conversions symmetric so the
// day never shifts across timezones.
export function toDateInputValue(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateInputToIso(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
