/**
 * Asking the phone where it is.
 *
 * A photo's own GPS is the better answer when there is one — it says where the
 * camera was pointed, not where the person is standing now — but most photos
 * arrive without it. Phones strip location from anything shared or screenshotted,
 * Safari strips it from some library picks, and a photo taken indoors may never
 * have had a fix at all. So this is the fallback, asked for explicitly.
 *
 * Browsers only grant this over HTTPS (localhost aside) and only after the person
 * agrees, and a refusal is permanent until they change it in site settings — so
 * every failure here has to be explained rather than swallowed.
 */

export interface Fix {
  lat: number;
  lng: number;
  /** Metres. Indoors this is often 20–100m, which is fine for "which building". */
  accuracy: number;
}

export type LocationError =
  | { kind: "unsupported"; message: string }
  | { kind: "insecure"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "timeout"; message: string };

export function locationAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/** True where the browser will even offer location — HTTPS, or a local dev server. */
export function locationAllowedHere(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function getFix(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!locationAvailable()) {
      return reject({ kind: "unsupported", message: "This browser cannot report a location." } satisfies LocationError);
    }
    if (!locationAllowedHere()) {
      return reject({
        kind: "insecure",
        message: "Location needs a secure connection. Open the app over https and try again.",
      } satisfies LocationError);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject({
            kind: "denied",
            message: "Location is blocked for this site. Allow it in your browser's settings for this page, then try again.",
          } satisfies LocationError);
        } else if (err.code === err.TIMEOUT) {
          reject({ kind: "timeout", message: "Could not get a fix in time. Near a window or outside usually helps." } satisfies LocationError);
        } else {
          reject({ kind: "unavailable", message: "Your device could not work out where it is just now." } satisfies LocationError);
        }
      },
      // A fresh, accurate fix matters more than speed here: this is used once,
      // deliberately, to place a pin that somebody will later navigate to.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

/** Rounded the way a person reads coordinates off a screen. */
export function describeFix(fix: Fix): string {
  return `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} (±${Math.round(fix.accuracy)}m)`;
}

/**
 * Whether the browser will hand over a location without putting a prompt in
 * front of anyone. Used to pick up a free fix in the background; where the
 * answer is anything but "granted", the person taps the button instead.
 */
export async function locationAlreadyGranted(): Promise<boolean> {
  if (!locationAvailable() || !locationAllowedHere()) return false;
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return status?.state === "granted";
  } catch {
    // Safari has not always supported querying this. Do not guess — a wrong
    // guess here means an unexpected prompt mid-walk.
    return false;
  }
}
