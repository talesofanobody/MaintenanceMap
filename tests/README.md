# Tests

Checks for the v2 project-planning slice. Four kinds, in the order they are worth
running:

| File | What it proves | Needs |
|---|---|---|
| `unit-planning.ts` | The rollup and cycle arithmetic | Nothing |
| `unit-schedule.ts` | Critical path, float, blocker ages, progress curve | Nothing |
| `unit-tree.ts` | Summary rollup, weighted progress, start-to-start and finish-to-finish | Nothing |
| `unit-calendar.ts` | Working days, two-way exceptions, float counted in them | Nothing |
| `migration-planning.js` | A live database survives the migration | A database at the previous schema |
| `api-planning.js` | The planning endpoints behave | `server` on :4000 |
| `api-governance.js` | Project dependencies, blockers, stakeholders | `server` on :4000 |
| `ui-planning.js` | A person can reach and use the plan | Both dev servers |
| `api-tree.js` | A phase finishes only when its tasks do; rolled dates | `server` on :4000 |
| `api-calendar.js` | Opting in changes float; opting out puts it back | `server` on :4000 |
| `ui-governance.js` | The Gantt draws, blockers clear, roles stick | Both dev servers |
| `ui-tree.js` | Phase dates roll up, progress shows, the refusal holds | Both dev servers |
| `ui-calendar.js` | The editor works and the chart shades days nobody works | Both dev servers |
| `smoke-pages.js` | Nothing else broke | Both dev servers |

423 checks in total.

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

- Pagination is untested because it does not exist. The issues route still makes
  unbounded `findMany` calls, which is slice 0 and the first real ceiling.
- The Gantt is not print-tested. It scrolls horizontally, which paper does not.
- The suites from v1 (inspections, guest intake, roles, backups, security headers)
  were lost with the container and have not been rebuilt. `smoke-pages.js` checks only
  that each page renders without an error, which is much weaker than what those did.
