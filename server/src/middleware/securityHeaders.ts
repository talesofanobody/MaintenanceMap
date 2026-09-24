import { RequestHandler } from "express";

/**
 * The headers a browser needs to be told, because it assumes the worst otherwise.
 *
 * None of these stop a bug on their own — they limit what a bug is worth. React
 * escapes what it renders, so there is no known injection here to block; the point
 * of a policy is that it holds on the day somebody writes `dangerouslySetInnerHTML`
 * or a dependency does it for them.
 *
 * The map is the only thing this app loads from anywhere else, so it is the only
 * exception in the list. Everything else — the script bundle, the styles, the
 * photos, the API — comes from this origin.
 */

/** The one outside origin: satellite tiles, fetched by Leaflet as <img>. */
const TILES = "https://server.arcgisonline.com";

const POLICY = [
  "default-src 'self'",
  // The shell loads one module bundle and no inline scripts, so this needs no
  // escape hatch. 'unsafe-eval' is deliberately absent.
  "script-src 'self'",
  // React writes style attributes on elements and Leaflet injects its own, both
  // of which count as inline. Styles cannot execute, so this is the cheap one to
  // concede; scripts are where it matters.
  "style-src 'self' 'unsafe-inline'",
  // data: for the QR code and Leaflet's own markers, blob: for the preview of a
  // photo before it has been sent.
  `img-src 'self' data: blob: ${TILES}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nothing should ever frame this. Clickjacking a maintenance system is a thin
  // prize, but the header costs nothing.
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(isProduction: boolean): RequestHandler {
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", POLICY);
    // Uploads are re-encoded to JPEG and served with a .jpg name, so the type is
    // already honest. This stops a browser second-guessing it anyway.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // A maintenance app has no business being asked for any of these.
    res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()");

    // Only once we know the request really arrived over TLS. Sending this from a
    // plain-HTTP install — someone's mini PC on their own network — would lock
    // their browser out of reaching it at all.
    if (isProduction && req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
