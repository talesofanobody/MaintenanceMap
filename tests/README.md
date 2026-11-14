# Tests

Checks for the v2 project-planning slice. Four kinds, in the order they are worth
running:

| File | What it proves | Needs |
|---|---|---|
| `unit-planning.ts` | The rollup and cycle arithmetic | Nothing |
| `unit-schedule.ts` | Critical path, float, blocker ages, progress curve | Nothing |
| `unit-tree.ts` | Summary rollup, weighted progress, start-to-start and finish-to-finish | Nothing |
| `unit-calendar.ts` | Working days, two-way exceptions, float counted in them | Nothing |
| `unit-utilities.ts` | The 05:00 day, tank conversions, WTD/MTD/YTD, cost per unit | Nothing |
| `unit-spaces.ts` | Range expansion, paths, matching text, the sell round | Nothing |
| `unit-assets.ts` | Both graph walks, loops and bounds, isolation order, service state | Nothing |
| `migration-planning.js` | A live database survives the migration | A database at the previous schema |
| `migration-assets.js` | A tree and matched issues survive slice 5 | A database at the previous schema |
| `api-planning.js` | The planning endpoints behave | `server` on :4000 |
| `api-governance.js` | Project dependencies, blockers, stakeholders | `server` on :4000 |
| `ui-planning.js` | A person can reach and use the plan | Both dev servers |
| `api-tree.js` | A phase finishes only when its tasks do; rolled dates | `server` on :4000 |
| `api-calendar.js` | Opting in changes float; opting out puts it back | `server` on :4000 |
| `api-readings.js` | A number flags its own line; the trend groups by point | `server` on :4000 |
| `api-paging.js` | 230 real issues: pages reach each once, the ceiling holds | `server` on :4000 |
| `api-utilities.js` | Rounds, tanks, invoices, site totals, retiring a meter | `server` on :4000 |
| `api-spaces.js` | The tree, 40 rooms from a range, reconciling free text | `server` on :4000 |
| `api-assets.js` | The register, relations, the blast radius, services, the due list | `server` on :4000 |
| `ui-governance.js` | The Gantt draws, blockers clear, roles stick | Both dev servers |
| `ui-tree.js` | Phase dates roll up, progress shows, the refusal holds | Both dev servers |
| `ui-calendar.js` | The editor works and the chart shades days nobody works | Both dev servers |
| `ui-readings.js` | A reading typed on a phone flags the line by itself | Both dev servers |
| `ui-utilities.js` | A round entered on screen converts and adds up | Both dev servers |
| `ui-spaces.js` | A tree built from a range, then the text matched to it | Both dev servers |
| `ui-assets.js` | A breaker's blast radius on screen, and a room traced back | Both dev servers |
| `smoke-pages.js` | Nothing else broke | Both dev servers |

871 checks in total, plus the two migration drills below (33 more).

```sh
(cd server && npm run dev)    # :4000
(cd client && npm run dev)    # :5173
./tests/run.sh all
```

## Why these are committed

An earlier round of this work kept its suites in a scratch directory outside the
repository. The container was recycled and all of them were lost, which left the
application without the harness that had proved it worked. A test that exists on one
machine is not a test. Anything worth running twice belongs in here.

## One sign-in, shared

A full run signs in **once**. The login limiter allows ten attempts per quarter of an
hour — correct, and the only thing between a guessable password and unlimited guesses
— and thirteen suites each signing in separately trips it. Weakening the limiter to
suit the tests would be the wrong trade, so `session.js` caches a session in a file
under `MM_SHOTS` and every API suite reuses it.

If you see *"The login limiter has been tripped"*, that is the limiter working. Wait
out the window rather than changing the limit.

## Browse on the origin the API allows

The CSRF guard checks `Origin` against `CLIENT_ORIGIN` in `server/.env`, normally
`http://localhost:5173`. Opening the app on `http://127.0.0.1:5173` instead gets
*"That request came from somewhere else"* — that is the guard doing its job, not a
broken test. Use the hostname the server was told about.

## The migration drill

Deliberately manual: it moves a migration directory aside, which should not happen by
accident. The point is to prove a **populated** database at the previous schema comes
through intact, rather than that the SQL parses.

```sh
cd server
SCRATCH=$(mktemp -d)
HOLD=$SCRATCH/held && mkdir -p "$HOLD"

# 1. Put the new migration aside and build the OLD schema.
mv prisma/migrations/20261114090000_project_planning "$HOLD/"
DATABASE_URL="file:$SCRATCH/old.db" npx prisma migrate deploy

# 2. Fill it with realistic rows, through raw SQL — the generated client knows the
#    new schema and would reject tables for columns that do not exist yet.
DATABASE_URL="file:$SCRATCH/old.db" node ../tests/migration-seed-oldschema.js

# 3. Put the migration back and apply it over the populated database.
mv "$HOLD/20261114090000_project_planning" prisma/migrations/
DATABASE_URL="file:$SCRATCH/old.db" npx prisma migrate deploy

# 4. Assert the old rows survived and the new model works.
DATABASE_URL="file:$SCRATCH/old.db" node ../tests/migration-planning.js
```

It checks both halves: that an existing issue keeps its title, area, position, cost,
project link and EAM work-order number; and that hierarchy, milestones, baselines,
dependency links and quotes all then function. It also checks the referential rules
that are easy to get wrong — deleting a parent clears its children's parent rather
than cascading onto the work, and a contractor holding a quote cannot be deleted.

### The same drill for slice 5

Equipment is additive — new tables, and one nullable column on `Issue` — which is the
kind of migration that looks safe enough to skip proving. It is worth proving anyway,
because the cost of being wrong about it is the whole dataset.

```sh
cd server
SCRATCH=$(mktemp -d)
HOLD=$SCRATCH/held && mkdir -p "$HOLD"

mv prisma/migrations/20261118090000_assets "$HOLD/"
DATABASE_URL="file:$SCRATCH/old.db" npx prisma migrate deploy
DATABASE_URL="file:$SCRATCH/old.db" node ../tests/migration-seed-preassets.js

mv "$HOLD/20261118090000_assets" prisma/migrations/
DATABASE_URL="file:$SCRATCH/old.db" npx prisma migrate deploy
DATABASE_URL="file:$SCRATCH/old.db" node ../tests/migration-assets.js
```

It proves the location tree and the issues already matched to it come through
untouched, that an issue predating the migration points at no equipment, and that
deleting a piece of equipment takes its own relations with it while leaving the work
history and the spaces it fed alone.

## Fixtures use dates relative to today

Learned the hard way twice. A reading dated in the future is correctly excluded from
the utility summary, and a hardcoded fixture quietly becomes one as the clock moves —
so `ui-utilities.js` builds its dates with `ago(n)`. The same trap caught several
period-total expectations: a day only counts once the *next* day's opening reading
exists, which is a property of the data rather than of the calendar.

## The one thing that must never be automatic

Room 101 exists in Coubaril and in Blue Suites. "Room 101" therefore matches two
spaces exactly, and picking either would be a coin toss recorded as a fact. The
reconcile pass applies **only** a single exact match and reports the rest for a
person — `unit-spaces.ts` and `api-spaces.js` both pin that, because it is the
difference between reconciling history and corrupting it.

## Two things the schedule tests pin down deliberately

**Float includes calendar gaps.** Everything carries dates somebody typed, so float
measures the gap to the next constraint — a weekend included, because a job genuinely
can slide into one. On a plan laid out Monday to Friday that leaves very little
"critical", which is why `longestChain` is reported separately: computed from
durations alone, it is the stable answer to where the end date comes from. There is
no working-day calendar; durations are counted in calendar days.

**Summary rows take no part in the analysis.** A parent's dates are an envelope
around its children. The test fixes the case that caught this: a phase spanning two
months beat the eighteen-day chain of dependent work inside it.

**Float is counted in working days once a calendar exists, and in calendar days
without one.** A job finishing Friday and the next starting Monday has two days of
slack when every day counts and one on a six-day week. Both numbers are right for
what they measure; the point of a calendar is that the second is the one worth
believing. The tests pin both.

**A shutdown inside a task's dates does not move its end.** There is no duration
field — only typed dates — so duration is derived as the working days *inside* the
range, and a shutdown reduces what the range contains rather than pushing the end
out. Somebody typed that end date. The push-out behaviour everybody expects needs a
real duration field with dates derived from it, which is recorded as a gap rather
than faked.

**"The longest chain" can be one task.** A lone activity with no dependencies is the
longest path through the graph if it is the longest activity — correct, and not a
chain, so the wording changes to "longest task" when it has one member. Pinned by a
test, because it looks like a bug when you first see it.

**A phase is finished exactly when its tasks are.** Refused rather than cascaded:
marking a parent done must not quietly close its children, because somebody still has
to do them. `force` exists for work descoped part-way through and is logged as its own
action. The mirror holds too — reopening a task reopens the finished phases above it,
or a phase would report done with live work inside.

## What is not covered

- The aggregate endpoints (`insights`, `export`, parts of `dashboard`) still read
  broadly by design. The dashboard is capped; the others are not, and a CSV export of
  everything is a legitimate thing to want. Worth revisiting if they get slow.
- `GET /issues` returns the full relation set per row even in a list, which no list
  screen needs. Paging makes that survivable rather than cheap; a lean list select
  would be the next improvement.
- The Gantt is not print-tested. It scrolls horizontally, which paper does not.
- The suites from v1 (inspections, guest intake, roles, backups, security headers)
  were lost with the container and have not been rebuilt. `smoke-pages.js` checks only
  that each page renders without an error, which is much weaker than what those did.
