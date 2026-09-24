import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    /** Per-session CSRF token; see middleware/csrf.ts. */
    csrfToken?: string;
  }
}
