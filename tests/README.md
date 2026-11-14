# Tests

Checks for the v2 project-planning slice. Four kinds, in the order they are worth
running:

| File | What it proves | Needs |
|---|---|---|
| `unit-planning.ts` | The rollup and cycle arithmetic | Nothing |
| `migration-planning.js` | A live database survives the migration | A database at the previous schema |
| `api-planning.js` | The endpoints behave | `server` on :4000 |
| `ui-planning.js` | A person can reach and use it | Both dev servers |
| `smoke-pages.js` | Nothing else broke | Both dev servers |

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

## What is not covered

- No Gantt or critical path yet; slice 7 in `V2-PLAN.md`.
- Pagination is untested because it does not exist. The issues route still makes
  unbounded `findMany` calls, which is slice 0 and the first real ceiling.
- The suites from v1 (inspections, guest intake, roles, backups, security headers)
  were lost with the container and have not been rebuilt. `smoke-pages.js` checks only
  that each page renders without an error, which is much weaker than what those did.
