# MaintenanceMap — where the project stands

**As of 19 October 2026.** Repository `talesofanobody/MaintenanceMap`.
`main` and `claude/sleepy-pasteur-m2ppos` are both at `2e31f95`, working tree clean.
52 commits, 23 database migrations.

---

## 1. What it is

A self-hosted property-maintenance application for a hotel operation. You draw a
property's boundary on a map, log faults against a position inside it, photograph them,
and track the work from there — priority, status, category, area, tags, the crew on it,
dates, checklists, photos, time clocked on site, and what it cost.

Two things distinguish it from a generic ticket tracker:

- **Everything is on a map.** A fault has a position, taken from the photograph's own GPS
  where the camera recorded one, so a contractor can navigate to it rather than read a
  description of where it is.
- **Inspections are first-class.** A structured walk against a checklist, on a phone, with
  findings that become work orders in one step.

It is designed to be run on your own hardware or your own hosting account. There is no
vendor account, no per-seat pricing and no data held by anyone else.

---

## 2. Deployment

| | |
|---|---|
| Hosting | Railway, Hobby plan |
| Shape | One Docker container, one origin — the API process also serves the built client |
| Database | SQLite on a mounted volume at `/data` |
| Photographs | `/data/uploads` |
| Backups | `/data/backups` |
| Branch deployed | `main` |

**The volume is the whole install.** The database, every photograph and every backup live
on it. Nothing of value is in the container's own filesystem, which is replaced on every
deploy.

### The data-loss incident, and what now prevents it

In late September the live install was wiped. The cause was not a bug in the application:
**no Railway volume had ever been attached.** Everything was being written to the
container's writable layer, which Railway discards on each redeploy. The data from before
that point is gone and is not recoverable.

A volume is attached now, and the container refuses to start in four situations rather than
starting wrong. From `docker-entrypoint.sh`:

1. **`/data` is not a mounted volume.** The old failure was silent because `mkdir -p /data`
   succeeds whether or not a volume is there, so a missing mount looked exactly like a first
   install. The boot now checks the mount itself and stops.
2. **Migrations are pending.** A backup is taken *before* `prisma migrate deploy` runs, and a
   failure to take it stops the boot. A deploy that will not start is better than one that
   migrates with no way back. SQLite rebuilds whole tables on some migrations, which makes
   this the single riskiest moment in the deploy.
3. **The database is empty but the uploads folder is not.** That is a lost install, not a new
   one, and starting would offer the first-run setup screen to whoever opened the address
   first — which is how an attacker ends up owning your install.
4. **A restored archive is newer than the running code.** Restoring now also runs migrations,
   which it previously did not; a database left behind the schema was the cause of an earlier
   crash loop.

---

## 3. What is built

### Core
- Properties with a hand-drawn boundary on a map; issues pinned inside it
- Photographs with EXIF GPS extraction, HEIC conversion, server-side resizing and thumbnails
- Printable reports laid out for A4 and Letter, with a fitted map and a boundary mask
- CSV export; work-order links out to an external EAM

### People and access
Five roles on a single capability table rather than scattered role checks:
**admin**, **manager**, **dispatcher**, **technician** (shown as "Team member"), **display**.
A manager is defined by what they cannot undo — no deleting a property, an issue or an
inspection, and no creating a role equal to or above their own. The team roster carries
trades, skills, shift times and time off, including an office/administration category so
non-trade staff can be attached to issues.

### Work management
Priorities with hour-based response targets, an expanded status workflow, up to four people
per issue, categories, areas, tags, comment threads, recurring maintenance schedules,
per-issue checklists, costs and parts, contractors, a drag-and-drop day scheduler with
emergency insertion, clock in/out time tracking, and a "Today" page per person.

### Inspections
The detailed walk. Three types ship with the app and can be edited or replaced:

- **Guest room** — 82 points across eight sections
- **Public area** — 19 points across five sections
- **General** — no checklist; ten empty slots, each taking a name, an area and a description

Built for a phone in one hand: three thumb-sized targets per line, everything saving as it is
touched, a floating "+ Found something else", and a combined report across an entire round of
rooms. Findings become issues (or a project) in one step, carrying the photograph, the
severity-derived priority and the note across.

### Walk-through
A looser alternative to a checklist walk. Records the date, time and person; the inspector
photographs as they go, selects a few photographs and presses **Group** to create an issue to
fill in afterwards. Reconciliation after the fact rather than form-filling in the corridor.

### Guest intake
A guest or a member of staff without a login can report a problem by scanning a code in the
room. Rate-limited, capped at four photographs, reviewed by an admin before it becomes work,
and the origin stays attached to the issue it became.

### Dashboards and reporting
Live map, departure board, kitchen-display ticket board, TV cycle mode, trend charts, a
portfolio report, an ICS calendar feed, and an activity log over everything.

### Operational
Offline capture on site via a service worker with a queue; nightly backups of database and
photographs; restore from an uploaded archive, with a safety copy taken before the restore
overwrites anything.

---

## 4. Security posture

Addressed over three commits (`ad87b53`, `05c5222`, and the audit that preceded them):

- **Content Security Policy** with exactly one external origin (the map tile server).
  `script-src 'self'`, no `unsafe-eval`, `frame-ancestors 'none'`.
- **CSRF**: a forged request fails three separate ways — Origin/Referer must match the app's
  own origin, and a signed-in session must echo a per-session token. Guest intake is
  deliberately exempt: it has no session and no credentials to forge.
- **HSTS** only when the request actually arrived over TLS, so a self-hosted install on plain
  HTTP cannot lock itself out of its own address.
- `nosniff`, a referrer policy, and a permissions policy on every response.
- Passwords are bcrypt at 12 rounds. Sessions are server-side in the database, not in a
  cookie.

### Open: dependency advisories, one of them reachable

GitHub reports **11 advisories on `main` — 1 critical, 1 high, 9 moderate.** `npm audit` across
both packages breaks down as 1 critical, 7 high and 7 moderate. These were triaged on
19 October; the count had grown from 9 since the end of September.

**The critical one is reachable on this deployment and should be treated as live.**
`proxy-addr` ≤ 2.0.7 can be made to trust a forged client address through an IPv4-mapped IPv6
subnet. It matters here because the app sets `trust proxy` when `TRUST_PROXY` is present, which
production does, so `proxy-addr` is what resolves `req.ip`. All three rate limiters use the
default key generator, which is `req.ip`:

| Limiter | Cap | What a forged address bypasses |
|---|---|---|
| `authRouter` login | 10 per 15 min | brute-forcing an account password |
| `intake` submit | 10 per hour | the guest-report flood cap |
| `intake` open | 120 per 15 min | form-read throttling |

So the practical effect is that the login throttle — the only thing standing between a guessable
password and an unlimited number of attempts — can be stepped around. Nothing suggests this has
been exploited; the point is that it is not theoretical on this configuration.

A non-major fix is available for the critical and for all but one of the rest:

| Package | Severity | Fix |
|---|---|---|
| `proxy-addr` (via `express`) | critical | available, non-major |
| `sharp` (librsvg, CVE-2026-96889) | high | available, non-major |
| `vite`, `source-map-js` | high | available |
| `brace-expansion`, `braces`, `chokidar` | high | via `ts-node-dev` — **dev only** |
| `express`/`body-parser`/`qs`, `multer` | moderate | available, non-major |
| `react-router`, `esbuild` | moderate | available |
| `ts-node-dev` | high | **none** — dev dependency, never in the container |

`ts-node-dev` and the three transitive highs beneath it are development-only and do not ship in
the production image, so they do not affect the deployment.

**This has not been applied.** Upgrading `express`, `sharp` and `multer` on a live install needs
the end-to-end suites run against it — `sharp` in particular is load-bearing for every
photograph. It is a contained piece of work, not a risky one, and it is the next thing worth
doing.

---

## 5. The most recent work (`2e31f95`, merged to `main`)

Seven changes to the inspection flow, plus one bug found in passing.

1. **The photo viewer opened at the top of a long walk** instead of over the screen.
   `position: fixed` stops meaning "the viewport" the moment an ancestor has a transform, and
   `animation-fill-mode: both` leaves an identity transform on the page permanently once the
   animation has run. Fill mode is now `backwards`, and the viewer is rendered into
   `document.body` so the next transform anyone adds cannot reintroduce it.
2. **Property and area are editable on the walk itself** — both are as easy to get wrong as
   anything on the list, and neither previously had a way back short of starting again.
3. **Room became Area** throughout, with each type carrying its own example for the field:
   `Room 214` for a guest room, `Main lobby` for a public area, `Where is it?` for General.
4. **Archive** freezes a finished walk into a summary — property, area, type, who walked it,
   the counts, and every finding with its severity, note and photograph count — then deletes
   the image files behind findings nobody raised as work. A finding that became an issue moved
   its photographs onto that issue already, so those are untouched. The report still prints
   off the frozen record. One-way: an archived walk refuses reopening, editing and a second
   archive rather than half-working.
5. **"+ Found something else" now floats** above the walk. The thing you notice on the way out
   is the thing you notice eighty lines from the button.
6. **Checklist became Type**, with General as the third option.
7. **GPS is kept warm for the length of the walk** — refreshed every 45 seconds once permission
   exists, never prompting on its own, and only replaced by a reading that is not meaningfully
   worse. A fix taken at the front door is stale by the third floor, and a stale fix pins a
   finding where nobody stood. Which location a photograph gets is now decided per photograph:
   the camera's where it has one, the phone's where it does not *and* the fix is good to 120
   metres or better. A fix good to four hundred metres puts the pin on a neighbouring street,
   which is a worse answer than no location at all.

**The bug found in passing:** loading an inspection never cleared the one already on screen.
Moving between two walks left the previous one rendered *and editable*, and an edit made in
that window saved against the wrong record. This was unrelated to any of the seven items and
would not have been found by testing them individually.

### Performance work immediately before it (`6a5b4c2`, `953e603`)

Photographs were slow to appear in the deployment. Measured rather than guessed:

| | Before | After |
|---|---|---|
| `storeImage` server-side | 1345 ms | 243 ms |
| Time on the wire | 14.0 s | 2.2 s |
| Server RSS | 248 MB | 155 MB |

The fixes: decode once and derive the thumbnail from the already-resized buffer rather than
re-decoding the original; drop mozjpeg (quality 76 matched its output size, 80 was chosen for
fidelity); and stop the client sending eight megabytes of original image purely to preserve a
coordinate. **This was a code problem, not a RAM problem** — the Railway upgrade was not what
fixed it.

---

## 6. How it is verified

Changes are checked against end-to-end suites driven through a real browser, not asserted.
Suites `e2e-v16` and `e2e-v22` through `e2e-v31` all pass as of the last merge, including a
production-mode suite that runs the compiled app behind a TLS proxy to exercise behaviour that
only appears in production (CSP, HSTS).

Migrations are tested by building a database at the *previous* schema, seeding it with raw SQL,
migrating, and asserting the old rows survive. The latest migration is additive only — five
nullable columns and one index, no table rebuild.

> **Caveat worth knowing.** These suites live in the session scratchpad, not in the
> repository. They are not committed and will not survive this environment. Anyone picking the
> project up later has the application but not the harness that proves it works. Committing
> them is a worthwhile piece of work that has not been done.

---

## 7. Open items

### Security
- **11 advisories on `main`, one critical and reachable.** Triaged, not fixed. The critical
  (`proxy-addr`, forged client address) lets the login rate limiter be bypassed on this
  configuration. A non-major fix exists. See section 4 — this is the top item.

### Operational risk
- **No off-platform backup automation.** The Railway volume holds the only live copy. Nightly
  backups are written to `/data/backups` — on the same volume. If the volume is lost, the
  backups go with it. This has been raised repeatedly and not yet acted on; given that the
  install has already been wiped once, it is the highest-value item after the critical advisory
  above.
- **The template top-up behaviour widened** in the last release: it now creates any template
  missing by name, where it previously only added sections to templates that already existed.
  If either shipped checklist has been renamed on the live install, the original name will read
  as missing and be re-created. Worth one glance at the Type dropdown after a deploy.

### Data quality
- **Roster:** roughly 12 flagged name spellings need confirming, and real per-person shift data
  is still placeholder.

### Not started
- Committing the end-to-end suites into the repository (see section 6).

---

## 8. Running it locally

```sh
# server
cd server
npm install
npx prisma migrate dev
npm run dev            # http://localhost:4000

# client, in a second terminal
cd client
npm install
npm run dev            # http://localhost:5173
```

The first account you create becomes the admin. `README.md` is the full reference — setup,
every feature, the self-hosting walkthrough and the reasoning behind the design decisions.

### Stack

**Server** — Node, Express 4, TypeScript, Prisma 5 over SQLite, express-session with a Prisma
session store, bcryptjs, multer, sharp, heic-convert, exifr, express-rate-limit.

**Client** — React 18, Vite, TypeScript, react-leaflet, HashRouter, one stylesheet with a
design-token layer (whites, a single Apple-style blue, hairline borders, minimal cards).

One quirk worth knowing if you touch the server: **Express 4 does not catch rejected promises
from async handlers**, so a single failed query took down the whole process. `server/src/lib/asyncErrors.ts`
patches Express's `Layer.prototype.handle` so a rejection reaches `next`. It preserves handler
arity deliberately — Express identifies error handlers by `fn.length === 4`, so wrapping
without preserving it silently breaks error handling.
