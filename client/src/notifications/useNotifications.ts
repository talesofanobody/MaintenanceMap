import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AppNotification } from "../types";

export type DesktopAlertState = "unsupported" | "default" | "granted" | "denied";

export function desktopAlertState(): DesktopAlertState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as DesktopAlertState;
}

export async function requestDesktopAlerts(): Promise<DesktopAlertState> {
  if (desktopAlertState() === "unsupported") return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as DesktopAlertState;
  } catch {
    return desktopAlertState();
  }
}

// Desktop alerts only fire when the app isn't the thing being looked at; while the
// tab is focused the bell badge already shows the change.
function showDesktopAlerts(fresh: AppNotification[]) {
  if (desktopAlertState() !== "granted") return;
  if (!document.hidden && document.hasFocus()) return;
  const batch = fresh.slice(0, 3);
  for (const n of batch) {
    try {
      const alert = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: "/favicon.svg" });
      alert.onclick = () => {
        window.focus();
        if (n.propertyId) window.location.hash = n.issueId ? `#/properties/${n.propertyId}?issue=${n.issueId}` : `#/properties/${n.propertyId}`;
        alert.close();
      };
    } catch {
      // Some browsers throw when constructing notifications outside a service worker.
    }
  }
  if (fresh.length > batch.length) {
    try {
      new Notification(`${fresh.length - batch.length} more notification(s)`, { tag: "mm-more" });
    } catch {
      /* ignore */
    }
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Polls the signed-in person's notifications, keeps the tab title in sync and raises desktop alerts for new ones. */
export function useNotifications(pollMs = 30000) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.listNotifications();
      setItems(r.items);
      setUnread(r.unread);
      if (seen.current) {
        const fresh = r.items.filter((n) => !n.readAt && !seen.current!.has(n.id));
        if (fresh.length) showDesktopAlerts(fresh);
      }
      seen.current = new Set(r.items.map((n) => n.id));
    } catch {
      // Keep whatever we had; the next poll will retry.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) MaintenanceMap` : "MaintenanceMap";
    return () => {
      document.title = "MaintenanceMap";
    };
  }, [unread]);

  const markRead = useCallback(async (id: string) => {
    setItems((list) => list.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api.markNotificationRead(id);
    } catch {
      /* the next poll corrects the optimistic update */
    }
  }, []);

  const markAll = useCallback(async () => {
    const stamp = new Date().toISOString();
    setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: stamp })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* ignore */
    }
  }, []);

  return { items, unread, refresh, markRead, markAll };
}
