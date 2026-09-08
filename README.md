# MaintenanceMap

A self-hosted, single-user web app for tracking property maintenance issues on a map. Draw a
property's border over satellite imagery, drop pins for issues (or let the app place them from a
photo's GPS metadata), track priority/status/work orders, and generate a printable report.
Login-protected, so it's safe to expose beyond your local machine when you're ready to.

## Stack

- **Server**: Node.js, Express, TypeScript, Prisma ORM, SQLite, Multer (uploads), `exifr` (EXIF parsing)
- **Photos**: `heic-convert` (iPhone HEIC → JPEG) + `sharp` (auto-rotate, resize, thumbnails) — every upload is
  normalised to web-friendly JPEGs on the server
- **Auth**: `express-session` (Prisma-backed store) + `bcryptjs`, single account, cookie-based sessions
- **Client**: React, TypeScript, Vite, Leaflet + `leaflet-draw` (property border drawing), `react-leaflet`,
  `heic2any` (in-browser HEIC previews, loaded on demand)
- **Satellite imagery**: Esri World Imagery tiles — free, no API key or billing account required
- **Address search**: OpenStreetMap Nominatim — free, no API key required

No cloud accounts, API keys, or billing setup are needed to run this locally.

## Running locally

Requires Node.js 18+.

```bash
# 1. Server
cd server
npm install
npm run prisma:migrate   # creates server/prisma/dev.db and applies the schema
npm run dev               # http://localhost:4000

# 2. Client (in a second terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

Open http://localhost:5173. The client dev server proxies `/api` requests to the server on port
4000 (see `client/vite.config.ts`).

The first time you open the app, you'll be asked to create the one account it supports (username +
password). From then on you'll need to sign in. There's no "forgot password" flow — if you lose the
password, delete the `User` row from `server/prisma/dev.db` (or wipe the DB) and set up again.

Uploaded photos are stored on disk in `server/uploads/` (git-ignored) as a full-size JPEG (capped
at 2048px) plus a thumbnail — the original HEIC/PNG is not kept. The SQLite database file is
`server/prisma/dev.db` (also git-ignored) — back both up if you want to keep your data, since
nothing here is stored off-machine.

If you already have a database from an earlier version, run `npm run prisma:migrate` again in
`server/` to apply new migrations.

### Production-style build

```bash
cd server && npm run build && npm start   # compiles to dist/ and runs node
cd client && npm run build                # outputs static files to client/dist/
```

The client build is static and can be served by any static file host, as long as `/api/*`
requests are proxied or otherwise routed to the server process.

## Deploying remotely

The auth layer makes it reasonable to expose this beyond your local machine, but a few things
are on you as the deployer:

- **Set `SESSION_SECRET`** (see `server/.env.example` for how to generate one) and **`NODE_ENV=production`**.
  The server refuses to start in production without a session secret, and won't mark cookies
  `Secure` unless `NODE_ENV=production` is set.
- **Serve over HTTPS.** Session cookies are marked `Secure` in production, so the browser won't
  send them over plain HTTP — put this behind a reverse proxy (Caddy, nginx, Cloudflare Tunnel,
  etc.) that terminates TLS.
- **Put the client and API on the same origin** if you can (reverse-proxy `/api/*` to the Node
  process alongside the static client build). This sidesteps CORS and cross-site cookie rules
  entirely — the recommended setup. If they must be on different origins, set `CLIENT_ORIGIN` in
  `server/.env` to the client's exact origin and expect to also loosen the session cookie's
  `sameSite` setting (`server/src/index.ts`), which weakens CSRF protection somewhat.
- **Set `TRUST_PROXY=1`** in `server/.env` if you're behind a reverse proxy, so Express reads the
  real client IP and secure cookies behave correctly.
- Login attempts are rate-limited (10 per 15 minutes per IP) but there's no account lockout or
  2FA — reasonable for a single personal account, not for anything more sensitive.

## Using the app

### 1. Sign in

The first time anyone opens the app, they land on a **Create your account** form instead of a
login form — that's how the app knows no account exists yet. Pick a username and password (8+
characters) and submit; you're signed in immediately. Every time after that, opening the app
shows a plain **Sign in** form. Sessions last 30 days, so you generally won't be asked again on
the same browser. Sign out with the button in the top-right corner of the header at any time.

There's no "forgot password" recovery flow (see [Running locally](#running-locally) above for what
to do if you lose it).

### 2. Create a property

You land on the **Properties** list (`/`) after signing in. On a fresh install this is a welcome
screen explaining the three steps; otherwise click **+ Add property**. Give it a name (required)
and an address (optional — it's a label for the report, not geocoded automatically), and click
**Create property**. It appears as a card showing whether a border has been drawn yet and how
many issues it has. Tap the card to open its map. Each card also has **Report** and **Delete**
(which asks you to confirm, and deletes all of that property's issues and photos with it — this
cannot be undone).

### 3. Follow the getting-started guide

A new property opens with a **Getting started** card on the map that walks you through the next
three steps and ticks them off as you go: find the property, draw the border, log the first issue.
Each step has a button that does the right thing (start drawing, save the border, add an issue).
Close it with ✕ whenever you like — the **? Guide** button in the toolbar brings it back — and
once the property is set up it stops appearing on its own.

### 4. Find the property on the map

The map opens zoomed out by default (or fitted to the property once a border is saved). Either:

- type into the **address search** box and pick a result (OpenStreetMap's free Nominatim geocoder —
  no account needed, but it's a courtesy service, so it isn't for rapid-fire searching), or
- tap the **◎ locate** button to jump to where you're standing — the natural choice on a phone at
  the property (your browser will ask for location permission; this needs HTTPS or localhost).

You can also just drag and pinch/scroll the satellite imagery by hand. Zooming in close is enough
for the guide to count this step as done.

### 5. Draw the property border

Three small icon buttons sit in the top-right corner of the map itself (they belong to the map's
drawing toolbar, not the app toolbar above it). The polygon button pulses while the guide is on
this step:

- **Pentagon icon** — start drawing. Tap each corner of the property, then tap the first corner
  again (or double-tap the last one) to close the shape.
- **Pencil icon** — reshape the border: drag its corners, then tap the tick to confirm.
- **Trash icon** — select and remove the shape.

Only one border is kept per property — drawing a new one replaces the old. Nothing is saved
automatically: after any draw/edit/delete a floating **Border changed — not saved yet** banner
appears with a **Save border** button. Once saved, everything outside the border is shaded so the
property stands out, and the map opens fitted to it from then on.

### 6. Add an issue

Tap **+ Add issue**. A banner asks you to tap the map where the issue is; on a phone the form
slides up as a bottom sheet, on a desktop it opens on the right. You can also skip the tap and
add a photo first — if it was taken on-site (iPhone photos carry GPS data), the pin is placed
from the photo and the map flies there. The form has:

- **Location** — the pin's coordinates, with **Move pin** / **Place pin** to tap a new spot at any
  time (on a phone the sheet gets out of the way while you tap).
- **Title** (required), **Description**, **What needs to be done**
- **Priority** — Low / Medium / High / Urgent, as tappable chips. The priority sets the pin's
  shape and colour: green circle **i** (low), yellow circle **!** (medium), orange triangle **!**
  (high), red octagon **!!** (urgent).
- **Status** — Pending / In Progress / Completed. In-progress and completed pins carry a small
  blue or green badge.
- **Timeline** — when the issue was logged; while it's open, how long it has been open. Marking it
  **Completed** records a **Closed on** date (today by default, adjustable if you're logging it
  after the fact) and shows the time it took to resolve. Reopening clears the close date.
- **Work order created**, which reveals a **Work order number** field and an optional **EAM link**
  — paste the work order's page from your EAM (Maximo, HxGN, SAP PM, …) and an
  **Open in EAM ↗** link appears, which opens the work order in a new tab. Only `http(s)` links
  are accepted.
- **Comments**
- **📷 Add photos** — JPEG, PNG, WebP and iPhone **HEIC** are all accepted. HEIC photos are
  converted to JPEG on the server so they display everywhere (and show a preview in the form
  while you're still filling it in), sideways photos are rotated upright automatically, and each
  photo gets a thumbnail so pages with many photos stay fast. Tap any thumbnail to view it
  full-size.

Tap **Create issue**. The pin appears immediately, numbered in the order issues were logged — the
same numbers appear in the report.

### 7. Edit or remove an issue

Tap any pin to reopen the same form pre-filled as **Edit issue**. Change anything and tap
**Save changes**. Extra photos added here upload straight away; remove one with the ✕ on its
thumbnail. **Delete** removes the issue and its photos (with a confirmation prompt).

### 8. Filter the map

The status and priority dropdowns filter which pins are shown; a small banner tells you how many
are hidden. It's a view-only filter — the report always includes every issue.

### 9. Generate the report

**Report** (toolbar, property card, or the guide's final step) opens `/properties/:id/report`,
laid out as an A4 document:

- **Page 1** — property name and address, issue counts by priority, and the map fitted to the
  property with everything outside the border shaded out, every issue pinned and numbered, and a
  legend explaining the pin shapes and status badges.
- **Following pages** — one card per issue, most severe first: number, title, priority and
  status, description, what needs to be done, work order (linked to the EAM when a link was
  added — the link survives in the saved PDF), comments, when it was logged, and either how long
  it has been open or when it was closed and how long it took to resolve. Photo thumbnails follow.
- The header also gives the average time to resolve across closed issues and the age of the
  oldest open one.

**Print / Save as PDF** opens the browser's print dialog already set to A4 — pick "Save as PDF"
for a file. Tip: give the map a second to finish loading imagery before printing.

## Data model

- `User`: username, bcrypt password hash — there is ever only one row
- `Session`: server-side session store backing the login cookie (housekept automatically)
- `Property`: name, address, notes, boundary (GeoJSON polygon), center lat/lng
- `Issue`: title, description, action needed, priority, status, work order flag/number/EAM link,
  comments, lat/lng, closed-at timestamp (managed from the status), belongs to a property
- `Photo`: filename, GPS presence/lat/lng, taken-at timestamp (from EXIF), belongs to an issue

## Notes on swapping in Google Maps later

This app currently uses Esri World Imagery tiles via Leaflet, which needs no API key. If you later
want Google's satellite tiles specifically, note that Google does not allow pulling raw tile URLs
into a third-party map library (that violates their terms) — using Google Maps means swapping the
map library itself (Leaflet → `@react-google-maps/api` or the Google Maps JavaScript API directly)
and requires a Google Cloud project with billing enabled. That's a meaningful rework of
`PropertyWorkspace.tsx` and `Report.tsx`, not a one-line config change — worth doing only if Esri's
imagery resolution isn't sufficient for your properties.

## Known limitations (MVP scope)

- Single account by design — one username/password for the whole app, no per-user data
  separation. If you later need multiple people with separate logins, that's a real rework
  (a `User` foreign key on `Property`, scoped queries throughout), not a config change.
- No automated tests yet.
- Property boundary/centroid are simple averages, not projected-CRS calculations — fine at
  building/lot scale, not for large or high-latitude parcels.
