// One sign-in, shared between the suites that talk to the API directly.
//
// The login limiter allows ten attempts per quarter of an hour, which is correct
// and which a full run of the suites trips: thirteen suites signing in
// separately is thirteen attempts. Weakening the limiter to suit the tests would
// be the wrong trade — it is the only thing between a guessable password and
// unlimited guesses — so the suites share a session instead.
//
// The cache is a file so it survives between processes. A stale or rejected one
// falls through to a fresh sign-in.
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = (process.env.MM_API || "http://127.0.0.1:4000") + "/api";
const USER = process.env.MM_USER || "khalid";
const PASS = process.env.MM_PASS || "correcthorsebattery9";
const CACHE = path.join(process.env.MM_SHOTS || os.tmpdir(), ".mm-session.json");

async function raw(method, pathname, body, state) {
  const headers = { "Content-Type": "application/json" };
  if (state.cookie) headers.Cookie = state.cookie;
  if (state.csrf) headers["X-CSRF-Token"] = state.csrf;
  const r = await fetch(BASE + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) state.cookie = sc.split(";")[0];
  const t = r.headers.get("x-csrf-token");
  if (t) state.csrf = t;
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

/**
 * Returns { cookie, csrf, req } with `req(method, path, body)` already
 * authenticated. Reuses a cached session where one still works.
 */
async function session() {
  const state = { cookie: "", csrf: "" };

  if (fs.existsSync(CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      state.cookie = cached.cookie || "";
      state.csrf = cached.csrf || "";
      const me = await raw("GET", "/auth/me", undefined, state);
      if (me.status === 200 && me.body?.user) {
        return { ...state, req: (m, p, b) => raw(m, p, b, state) };
      }
    } catch {
      // Unreadable cache is the same as none.
    }
    state.cookie = "";
    state.csrf = "";
  }

  // No usable session: create the first account, or sign in to the existing one.
  let r = await raw("POST", "/auth/setup", { username: USER, password: PASS }, state);
  if (r.status !== 201 && r.status !== 200) {
    r = await raw("POST", "/auth/login", { username: USER, password: PASS }, state);
  }
  if (r.status === 429) {
    throw new Error(
      "The login limiter has been tripped (ten attempts per fifteen minutes). " +
      "That is the limiter working. Wait, or run fewer suites at once — the shared " +
      "session in tests/session.js exists so a full run only signs in once."
    );
  }
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`could not sign in (${r.status}): ${JSON.stringify(r.body)}`);
  }
  await raw("GET", "/auth/me", undefined, state);
  try {
    fs.writeFileSync(CACHE, JSON.stringify({ cookie: state.cookie, csrf: state.csrf }));
  } catch {
    // A read-only scratch directory just means no sharing.
  }
  return { ...state, req: (m, p, b) => raw(m, p, b, state) };
}

module.exports = { session };
