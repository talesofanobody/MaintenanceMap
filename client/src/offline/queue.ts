import type { Priority, Status } from "../types";

import { currentCsrfToken } from "../api";

/** The queue posts outside api.ts, so it carries the token itself. */
function csrfHeader(): Record<string, string> {
  const token = currentCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}

/**
 * Issues logged with no connection are kept in IndexedDB (photos included, as blobs)
 * and sent when the connection returns. Nothing is lost if the tab is closed or the
 * phone is locked in the meantime.
 */

const DB_NAME = "maintenancemap-offline";
const STORE = "queued-issues";
const DB_VERSION = 1;

export interface QueuedIssue {
  id?: number;
  createdAt: string;
  propertyId: string;
  propertyName?: string;
  payload: {
    title: string;
    description?: string | null;
    actionNeeded?: string | null;
    priority: Priority;
    status: Status;
    firstMessage?: string | null;
    category?: string | null;
    roomName?: string | null;
    tagIds?: string[];
    lat: number;
    lng: number;
    technicianId?: string | null;
    estimatedHours?: number | null;
    scheduledFor?: string | null;
    dueDate?: string | null;
  };
  photos: { name: string; type: string; blob: Blob }[];
  /** Set when a send failed for a reason retrying won't fix. */
  error?: string;
}

/** IndexedDB is missing in some private modes; the app must still work, just without queueing. */
export function offlineSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      })
  );
}

export async function queueIssue(entry: Omit<QueuedIssue, "id" | "createdAt">): Promise<number> {
  const id = await tx<IDBValidKey>("readwrite", (store) => store.add({ ...entry, createdAt: new Date().toISOString() }));
  notifyChange();
  return Number(id);
}

export async function queuedIssues(): Promise<QueuedIssue[]> {
  if (!offlineSupported()) return [];
  try {
    const all = await tx<QueuedIssue[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedIssue[]>);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function removeQueued(id: number): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
  notifyChange();
}

export async function markQueuedError(id: number, error: string): Promise<void> {
  const entry = await tx<QueuedIssue | undefined>("readonly", (store) => store.get(id) as IDBRequest<QueuedIssue | undefined>);
  if (!entry) return;
  await tx("readwrite", (store) => store.put({ ...entry, error }));
  notifyChange();
}

export const QUEUE_EVENT = "mm:queue";

export function notifyChange(): void {
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Sends everything queued, oldest first. A network failure stops the run and leaves the
 * rest queued; a rejection from the server (a deleted property, say) is recorded against
 * the entry so it can be shown rather than retried forever.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (!offlineSupported() || !navigator.onLine) {
    return { sent: 0, failed: 0, remaining: (await queuedIssues()).length };
  }
  const entries = await queuedIssues();
  let sent = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.id == null) continue;
    let response: Response;
    try {
      response = await fetch("/api/issues", {
        method: "POST",
        credentials: "include",
        // Queued work goes up through the same guard as anything else.
        headers: { "Content-Type": "application/json", ...csrfHeader() },
        body: JSON.stringify({ propertyId: entry.propertyId, ...entry.payload }),
      });
    } catch {
      break; // Still offline: keep this and everything after it for the next attempt.
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      // 401 means the session lapsed — that is worth retrying after signing in again.
      if (response.status === 401) break;
      await markQueuedError(entry.id, body.error || `Rejected (${response.status})`);
      failed += 1;
      continue;
    }

    const issue = await response.json();
    for (const photo of entry.photos) {
      const form = new FormData();
      form.append("photo", new File([photo.blob], photo.name, { type: photo.type }));
      try {
        await fetch(`/api/issues/${issue.id}/photos`, { method: "POST", credentials: "include", headers: csrfHeader(), body: form });
      } catch {
        // The issue is in; a missing photo shouldn't hold up the rest of the queue.
      }
    }
    await removeQueued(entry.id);
    sent += 1;
  }

  const remaining = (await queuedIssues()).length;
  notifyChange();
  return { sent, failed, remaining };
}
