/**
 * The vocabulary the whole app agrees on: what states a job moves through, and how
 * urgently each priority has to be answered.
 */

/**
 * Job states. "pending" is the value on the wire and in the database — it reads as
 * "Requested" everywhere a person sees it, and keeping the stored value put means no
 * filter, export or saved link had to be rewritten to gain the rest of the workflow.
 */
export const STATUSES = ["pending", "accepted", "in_progress", "on_hold", "needs_parts", "completed", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_SET = new Set<string>(STATUSES);

/** Still someone's problem. Everything that isn't finished or called off. */
export const OPEN_STATUSES: Status[] = ["pending", "accepted", "in_progress", "on_hold", "needs_parts"];
/** Off the board. Cancelled counts as closed, but never as resolved. */
export const CLOSED_STATUSES: Status[] = ["completed", "cancelled"];
/** Work that is in someone's hands right now rather than waiting on something. */
export const ACTIVE_STATUSES: Status[] = ["accepted", "in_progress"];
/** Open, but parked on something outside the technician's control. */
export const BLOCKED_STATUSES: Status[] = ["on_hold", "needs_parts"];

/** Prisma `where` fragment for "not finished". Use this rather than `not: completed`,
 *  which would quietly include cancelled work. */
export const OPEN_WHERE = { status: { in: OPEN_STATUSES } } as const;

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as string[]).includes(status);
}

export function isClosed(status: string): boolean {
  return (CLOSED_STATUSES as string[]).includes(status);
}

export const STATUS_WORDS: Record<Status, string> = {
  pending: "requested",
  accepted: "accepted",
  in_progress: "in progress",
  on_hold: "on hold",
  needs_parts: "waiting on parts",
  completed: "completed",
  cancelled: "cancelled",
};

/** Priorities, least to most urgent. */
export const PRIORITIES = ["low", "medium", "high", "urgent", "critical"] as const;
export type PriorityKey = (typeof PRIORITIES)[number];
export const PRIORITY_SET = new Set<string>(PRIORITIES);
/** Ascending, so the next one up is the next index. */
export const PRIORITY_ORDER: PriorityKey[] = ["low", "medium", "high", "urgent", "critical"];

export const PRIORITY_WORDS: Record<PriorityKey, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  critical: "Critical",
};

/**
 * How long there is to resolve each priority, in hours from the moment it is logged.
 * Anything under a day is a response window measured from now; anything longer is
 * really a number of days and is shown that way.
 */
export const DEFAULT_RESPONSE_HOURS: Record<PriorityKey, number> = {
  critical: 2,
  urgent: 5,
  high: 72,
  medium: 336,
  low: 720,
};

export const SHORT_FUSE_HOURS = 24;

/** True when this priority is counted in hours rather than days. */
export function isShortFuse(hours: number): boolean {
  return hours < SHORT_FUSE_HOURS;
}

/** "2 hours" / "5 hours" / "3 days" — however the window is most naturally read. */
export function describeWindow(hours: number): string {
  if (hours <= 0) return "same day";
  if (isShortFuse(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function nextPriority(priority: string): PriorityKey | null {
  const idx = PRIORITY_ORDER.indexOf(priority as PriorityKey);
  if (idx < 0 || idx === PRIORITY_ORDER.length - 1) return null;
  return PRIORITY_ORDER[idx + 1];
}
