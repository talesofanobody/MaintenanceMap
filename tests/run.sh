#!/bin/bash
# Run the checks for the project-planning slice.
#
# These live in the repository on purpose. An earlier round of this work kept its
# suites in a scratch directory outside the repo; the container was recycled and
# every one of them was lost, leaving the application without the harness that
# proved it worked. Tests that only exist on one machine are not tests.
#
#   ./tests/run.sh unit        — the arithmetic: rollups, cycles, critical path
#   ./tests/run.sh migration   — old schema -> populate -> migrate -> assert
#   ./tests/run.sh api         — the endpoints, against a running dev server
#   ./tests/run.sh ui          — the screens, in a real browser
#   ./tests/run.sh smoke       — every page renders without an error
#   ./tests/run.sh all         — everything except the migration drill
#
# Expects the dev servers up for api/ui/smoke:
#   (cd server && npm run dev)     on :4000
#   (cd client && npm run dev)     on :5173
#
# Browse the client on the origin the API allows (CLIENT_ORIGIN in server/.env),
# normally http://localhost:5173 — the CSRF check refuses a different one, which
# is the guard working rather than a broken test.
#
# Overridable: MM_API, MM_CLIENT, MM_SHOTS, PLAYWRIGHT_PATH, PRISMA_CLIENT_PATH
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"

: "${PLAYWRIGHT_PATH:=$(node -e "try{console.log(require.resolve('playwright'))}catch(e){console.log('')}" 2>/dev/null)}"
: "${PRISMA_CLIENT_PATH:=$ROOT/server/node_modules/@prisma/client}"
: "${MM_SHOTS:=$HERE/.shots}"
export PLAYWRIGHT_PATH PRISMA_CLIENT_PATH MM_SHOTS
mkdir -p "$MM_SHOTS"

rc=0
run() { echo "================ $1 ================"; shift; "$@"; local r=$?; [ $r -ne 0 ] && rc=$r; return 0; }

case "${1:-all}" in
  unit)
    for f in unit-planning unit-schedule unit-tree unit-calendar; do
      run "unit: $f" npx --prefix "$ROOT/server" ts-node --transpile-only \
        --compiler-options '{"module":"commonjs","target":"es2020","ignoreDeprecations":"6.0","moduleResolution":"node"}' \
        "$HERE/$f.ts"
    done
    ;;
  migration)
    echo "The migration drill needs a database built at the PREVIOUS schema."
    echo "See the recipe in tests/README.md — it is deliberately manual, because it"
    echo "moves a migration directory aside and should not be run by accident."
    ;;
  api)
    run "api: planning endpoints" node "$HERE/api-planning.js"
    run "api: governance"         node "$HERE/api-governance.js"
    run "api: the tree"           node "$HERE/api-tree.js"
    run "api: the calendar"       node "$HERE/api-calendar.js"
    run "api: readings"           node "$HERE/api-readings.js"
    ;;
  ui)
    run "ui: the plan on screen" node "$HERE/ui-planning.js"
    run "ui: gantt and governance" node "$HERE/ui-governance.js"
    run "ui: the tree"             node "$HERE/ui-tree.js"
    run "ui: the calendar"         node "$HERE/ui-calendar.js"
    run "ui: readings"             node "$HERE/ui-readings.js"
    ;;
  smoke)  run "smoke: every page"       node "$HERE/smoke-pages.js" ;;
  all)
    for f in unit-planning unit-schedule unit-tree unit-calendar; do
      run "unit: $f" npx --prefix "$ROOT/server" ts-node --transpile-only \
        --compiler-options '{"module":"commonjs","target":"es2020","ignoreDeprecations":"6.0","moduleResolution":"node"}' \
        "$HERE/$f.ts"
    done
    run "api: planning endpoints"  node "$HERE/api-planning.js"
    run "api: governance"          node "$HERE/api-governance.js"
    run "api: the tree"            node "$HERE/api-tree.js"
    run "api: the calendar"        node "$HERE/api-calendar.js"
    run "api: readings"            node "$HERE/api-readings.js"
    run "ui: the plan on screen"   node "$HERE/ui-planning.js"
    run "ui: gantt and governance" node "$HERE/ui-governance.js"
    run "ui: the tree"             node "$HERE/ui-tree.js"
    run "ui: the calendar"         node "$HERE/ui-calendar.js"
    run "ui: readings"             node "$HERE/ui-readings.js"
    run "smoke: every page"        node "$HERE/smoke-pages.js"
    ;;
  *) echo "unknown target: $1"; exit 2 ;;
esac

echo
[ $rc -eq 0 ] && echo "EVERYTHING PASSED" || echo "SOMETHING FAILED (rc=$rc)"
exit $rc
