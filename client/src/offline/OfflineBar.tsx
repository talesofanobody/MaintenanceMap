import { useCallback, useEffect, useState } from "react";
import { QUEUE_EVENT, flushQueue, offlineSupported, queuedIssues, removeQueued, type QueuedIssue } from "./queue";

/**
 * A strip under the header when the connection is down or work is waiting to be sent.
 * Flushes automatically when the connection returns; the button is for impatience.
 */
export default function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState<QueuedIssue[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    queuedIssues().then(setQueued);
  }, []);

  const sync = useCallback(
    async (automatic = false) => {
      if (syncing || !navigator.onLine) return;
      setSyncing(true);
      try {
        const result = await flushQueue();
        if (result.sent > 0) setNote(`${result.sent} issue${result.sent === 1 ? "" : "s"} sent.`);
        else if (!automatic && result.remaining > 0) setNote("Couldn't send yet — still trying.");
        if (result.sent > 0) setTimeout(() => setNote(null), 5000);
      } finally {
        setSyncing(false);
        refresh();
      }
    },
    [syncing, refresh]
  );

  useEffect(() => {
    if (!offlineSupported()) return;
    refresh();
    const onOnline = () => {
      setOnline(true);
      sync(true);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUE_EVENT, refresh);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUE_EVENT, refresh);
    };
  }, [refresh, sync]);

  // Send anything left over from a previous visit once the app is up.
  useEffect(() => {
    if (navigator.onLine) sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rejected = queued.filter((q) => q.error);
  if (online && queued.length === 0 && !note) return null;

  return (
    <div className={`offline-bar ${online ? "" : "is-offline"}`} role="status">
      <span className="offline-dot" aria-hidden="true" />
      <span className="offline-text">
        {!online && <strong>Offline.</strong>}{" "}
        {queued.length > 0 ? (
          <>
            {queued.length} issue{queued.length === 1 ? "" : "s"} waiting to be sent
            {rejected.length > 0 && ` · ${rejected.length} rejected`}
            {!online && " — keep logging, they'll go when you're back on"}
          </>
        ) : note ? (
          note
        ) : (
          "Working offline — the app still opens and you can log issues."
        )}
      </span>
      {queued.length > 0 && online && (
        <button type="button" className="btn btn-small btn-secondary" onClick={() => sync(false)} disabled={syncing}>
          {syncing ? "Sending…" : "Send now"}
        </button>
      )}
      {rejected.length > 0 && (
        <button
          type="button"
          className="btn btn-small btn-ghost"
          title={rejected.map((r) => `${r.payload.title}: ${r.error}`).join("\n")}
          onClick={() => {
            if (!confirm(`Discard ${rejected.length} rejected issue${rejected.length === 1 ? "" : "s"}?\n\n${rejected.map((r) => `${r.payload.title}: ${r.error}`).join("\n")}`)) return;
            Promise.all(rejected.map((r) => (r.id != null ? removeQueued(r.id) : null))).then(refresh);
          }}
        >
          Review rejected
        </button>
      )}
    </div>
  );
}
