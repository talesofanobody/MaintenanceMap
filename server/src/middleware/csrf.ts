import crypto from "crypto";
import { RequestHandler } from "express";

/**
 * Two independent reasons a forged request fails.
 *
 * The session cookie is already SameSite=Lax, which stops a browser attaching it
 * to a cross-site POST at all. That is the main defence and it is a good one. It
 * is also the only one, and it lives entirely in the browser's judgement of what
 * "same site" means — a judgement that has had exceptions before and will again.
 *
 * So, two more, both cheap:
 *
 *   1. Where the request says it came from must be this origin. Browsers always
 *      send Origin on a state-changing fetch, so a missing one is not a pass.
 *   2. A signed-in session must echo a secret only this origin can read. Another
 *      site can make your browser send a request; it cannot read the answer to
 *      one, which is what it would need to learn the token.
 *
 * The guest form is deliberately outside all of this. It has no session and no
 * credentials to ride on, so there is nothing for a forged request to abuse —
 * and requiring a token there would mean minting a session for every stranger
 * who scans a QR code, which is a cost with no benefit attached.
 */

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** The origins a request may legitimately claim to come from. */
function allowedOrigins(req: Parameters<RequestHandler>[0], configured: string[]): Set<string> {
  const host = req.get("host");
  const own = host ? [`https://${host}`, `http://${host}`] : [];
  return new Set([...configured, ...own]);
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

export function csrfGuard(configuredOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    // Hand the current token out on every response, so a client that has just
    // signed in — or one whose session predates this code — always has the
    // latest without asking for it.
    if (req.user) {
      if (!req.session.csrfToken) req.session.csrfToken = newToken();
      res.setHeader("X-CSRF-Token", req.session.csrfToken);
    }

    if (SAFE.has(req.method)) return next();

    // 1. Where it says it came from.
    const claimed = originOf(req.get("origin")) ?? originOf(req.get("referer"));
    if (claimed && !allowedOrigins(req, configuredOrigins).has(claimed)) {
      return res.status(403).json({ error: "That request came from somewhere else." });
    }

    // 2. The secret, for anyone signed in. Unauthenticated routes — the guest
    //    form — carry no credentials, so there is nothing to forge.
    if (req.user) {
      const sent = req.get("x-csrf-token");
      if (!sent || !req.session.csrfToken || sent !== req.session.csrfToken) {
        return res.status(403).json({
          error: "This page has been open a while and its security token has expired. Reload and try again.",
        });
      }
    }

    next();
  };
}

/** Called when a session is created, so the token never lags the login. */
export function mintCsrfToken(session: { csrfToken?: string }): string {
  if (!session.csrfToken) session.csrfToken = newToken();
  return session.csrfToken;
}
