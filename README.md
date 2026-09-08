# MaintenanceMap

A self-hosted, single-user web app for tracking property maintenance issues on a map. Draw a
property's border over satellite imagery, drop pins for issues (or let the app place them from a
photo's GPS metadata), track priority/status/work orders, and generate a printable report.
Login-protected, so it's safe to expose beyond your local machine when you're ready to.

## Stack

- **Server**: Node.js, Express, TypeScript, Prisma ORM, SQLite, Multer (uploads), `exifr` (EXIF parsing)
- **Auth**: `express-session` (Prisma-backed store) + `bcryptjs`, single account, cookie-based sessions
- **Client**: React, TypeScript, Vite, Leaflet + `leaflet-draw` (property border drawing), `react-leaflet`
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

Uploaded photos are stored on disk in `server/uploads/` (git-ignored). The SQLite database file
is `server/prisma/dev.db` (also git-ignored) — back it up if you want to keep your data, since
nothing here is stored off-machine.

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

You land on the **Properties** list (`/`) after signing in. Click **+ Add Property**, give it a
name (required) and an address (optional, just a label — it isn't geocoded automatically here),
and click **Create Property**. It appears as a card in the list, showing whether a border has
been drawn yet and how many issues it has. Click the card (not the buttons) to open its workspace.
Each property card also has a **Report** shortcut and a **Delete** button (which asks you to
confirm, and deletes all of that property's issues and photos with it — this cannot be undone).

### 3. Find the property on the map

Inside a property's workspace, the map opens zoomed out over the middle of the US by default (or
wherever the property was last centered, once you've saved a border). Use the **address search
box** in the toolbar: type an address and press **Search** (or Enter), pick a result from the
dropdown, and the map flies there. This uses OpenStreetMap's free Nominatim geocoder — no account
needed, but it's a courtesy service, so don't rely on it for rapid repeated searches. You can also
just scroll/drag/zoom the satellite imagery manually.

### 4. Draw the property border

Three small icon buttons sit in the top-right of the map itself (these come from the map's drawing
toolbar, not the app's toolbar above it):

- **Pentagon icon** — start drawing a polygon. Click to place each corner, then click the first
  point again (or double-click the last point) to close the shape.
- **Pencil icon** — edit the shape you already drew: drag its corners, then click the checkmark
  that appears to confirm.
- **Trash icon** — select and remove the shape.

Only one border polygon is kept per property — drawing a new one replaces whatever was there
before. None of this is saved automatically: as soon as you draw, edit, or delete the shape, a
blue banner appears at the top saying **"Border changed and not yet saved"** with a **Save
Border** button. Click it to persist the change (or reload the page to discard it).

### 5. Add an issue

Click **+ Add Issue** in the toolbar. A banner tells you to click the map to place a pin — do
that first, or upload a geotagged photo (see below) and let it set the location for you. Either
way, a panel slides in on the right with:

- **Location** — shows the current pin coordinates, with a **Reposition on map** /
  **Click map to place pin** button that lets you click a new spot at any time, even after the
  panel is already open.
- **Title** (required), **Description**, **What needs to be done**
- **Priority** — Low / Medium / High / Urgent
- **Status** — Pending / In Progress / Completed
- **Work order created** checkbox, which reveals a **Work order number** field when checked
- **Comments**
- **Photos** — attach one or more. If you haven't set a location yet and the first photo you add
  has GPS data in its EXIF metadata, the pin is placed there automatically (you'll see a note
  confirming it) — you can still drag it elsewhere afterward with **Reposition on map**. Photos
  without GPS data, or added after a location is already set, just attach normally.

Click **Create Issue** to save. The pin appears on the map immediately, colored by priority (green
= low, yellow = medium, orange = high, red = urgent) with a small glyph showing status (`!`
pending, `…` in progress, `✓` completed).

### 6. Edit or remove an issue

Click any existing pin to reopen the same panel, pre-filled, now titled **Edit Issue**. Change any
field and click **Save Changes**. You can reposition it the same way as during creation, add more
photos (these upload immediately, no separate save step), or remove a photo with the small ✕ on
its thumbnail. **Delete Issue** at the bottom removes the issue and all its photos (with a
confirmation prompt).

### 7. Filter the map

The **All statuses** / **All priorities** dropdowns in the toolbar filter which pins are shown on
the map. This is a view-only filter — it doesn't affect the report, which always includes every
issue.

### 8. Generate a report

Click **View Report** (from the workspace toolbar or a property card) to open
`/properties/:id/report`: a count of issues by status and by priority, the property map with all
pins plotted, and a full table (priority, status, description, action needed, work order, comments,
photo thumbnails) for every issue. Click **Print / Save as PDF** to open your browser's print
dialog — choose "Save as PDF" there for a file, or print it directly.

## Data model

- `User`: username, bcrypt password hash — there is ever only one row
- `Session`: server-side session store backing the login cookie (housekept automatically)
- `Property`: name, address, notes, boundary (GeoJSON polygon), center lat/lng
- `Issue`: title, description, action needed, priority, status, work order flag/number, comments,
  lat/lng, belongs to a property
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
