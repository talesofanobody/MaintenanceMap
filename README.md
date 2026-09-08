# MaintenanceMap

A self-hosted, single-user web app for tracking property maintenance issues on a map. Draw a
property's border over satellite imagery, drop pins for issues (or let the app place them from a
photo's GPS metadata), track priority/status/work orders, and generate a printable report.

## Stack

- **Server**: Node.js, Express, TypeScript, Prisma ORM, SQLite, Multer (uploads), `exifr` (EXIF parsing)
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

## How it works

1. **Properties** (`/`) — create a property (name + optional address). Each property has its own
   border, issues, and report.
2. **Workspace** (`/properties/:id`) — the main map view:
   - Use the polygon tool (top-right of the map) to draw the property border over satellite
     imagery, then click **Save Border** to persist it. Use the edit/delete tools to adjust it
     later.
   - Use the address search box to fly the map to an address (via Nominatim geocoding) before
     drawing.
   - Click **+ Add Issue**, then click anywhere on the map to drop a pin. Fill in the description,
     what needs to be done, priority (Low/Medium/High/Urgent), status (Pending/In Progress/
     Completed), whether a work order was created and its number, and comments. Attach photos —
     the location can also be set automatically from a photo's GPS EXIF data if the pin hasn't
     been placed yet.
   - Click any existing pin to edit it, reposition it, add/remove photos, or delete it.
   - Filter the map by status or priority using the toolbar dropdowns.
3. **Report** (`/properties/:id/report`) — a printable summary: counts by status/priority, the
   property map with all issue pins, and a full table of issues (with thumbnails). Use **Print /
   Save as PDF** (browser print) to export it.

## Data model

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

- Single user, no authentication — anyone with access to the running server can see/edit
  everything. Fine for local personal use; would need an auth layer before exposing it to a network.
- No automated tests yet.
- Property boundary/centroid are simple averages, not projected-CRS calculations — fine at
  building/lot scale, not for large or high-latitude parcels.
