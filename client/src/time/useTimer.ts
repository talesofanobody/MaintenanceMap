import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { TimeEntry } from "../types";

/** Fired after any clock in/out so every timer display refreshes at once. */
export const TIMER_EVENT = "mm:timer";

export function announceTimerChange(): void {
  window.dispatchEvent(new Event(TIMER_EVENT));
}

export function entryMs(entry: { startedAt: string; endedAt: string | null }, now = Date.now()): number {
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : now;
  return Math.max(0, end - new Date(entry.startedAt).getTime());
}

export function formatClock(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Re-renders once a second so running timers tick. */
export function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The running time entry for the signed-in technician (or a chosen one, for admins). */
export function useOpenEntry(technicianId?: string, pollMs = 30000) {
  const [entry, setEntry] = useState<TimeEntry | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      setEntry(await api.getOpenEntry(technicianId));
    } catch {
      /* keep the last known state */
    }
  }, [technicianId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    window.addEventListener(TIMER_EVENT, refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener(TIMER_EVENT, refresh);
    };
  }, [refresh, pollMs]);

  const clockIn = useCallback(
    async (issueId: string) => {
      const e = await api.clockIn(issueId, technicianId);
      setEntry(e);
      announceTimerChange();
      return e;
    },
    [technicianId]
  );

  const clockOut = useCallback(
    async (note?: string) => {
      const e = await api.clockOut(note, technicianId);
      setEntry(null);
      announceTimerChange();
      return e;
    },
    [technicianId]
  );

  return { entry, refresh, clockIn, clockOut };
}
