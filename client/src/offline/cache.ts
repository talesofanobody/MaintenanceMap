/**
 * A small last-known-good cache in localStorage, so the app can still show the property
 * you were just looking at when the connection drops. Never used while online.
 */

const PREFIX = "mm.cache.";

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Storage full or blocked (private mode): caching is a nicety, not a requirement.
  }
}

export function readCache<T>(key: string): { at: number; value: T } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== "number") return null;
    return parsed as { at: number; value: T };
  } catch {
    return null;
  }
}

export function clearCache(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** True when a failed request looks like a lost connection rather than a server refusal. */
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}
