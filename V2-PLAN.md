# MaintenanceMap v2 — architecture and sequencing

**Drafted:** 14 November 2026
**Scope:** project management, a property manual, daily utility logging with graphs, and the
groundwork for automation.
**Status:** slices 1 and 1b are built, tested and pushed. Slices 2–8 are still plan.
Section 7 is the build order and records what is done.

**Decided since drafting.** The EAM stays the record of work orders; this app plans and
feeds it. Slice 1 is therefore a planning layer, and nothing in it assumes otherwise —
`workOrderNumber` and `workOrderUrl` are untouched and carried through every new read.

---

## 1. The short version

Four subsystems were asked for. They are not equal in size, risk or payback, and two of them
depend on a decision that has to be made before any content is written.

| # | Subsystem | Size | Pays back | Depends on |
|---|---|---|---|---|
| A | Project management | Medium | Weeks | Nothing — mostly extends what exists |
| B | Daily utility logging and graphs | **Small** | **Daily, immediately** | Nothing |
| C | Property manual (map, assets, circuits) | **Large** | Months, then permanently | Nothing, but it is the long pole |
| D | Automation / agents | Small *rail*, large *content* | Only after B and C | **B and C** |

**Three things I would push back on before starting.**

1. **Do not build agents yet.** What makes automation useful here is not agent code, it is
   structured data to act on and a safe way to act. The data comes from B and C. The safe way to
   act is a proposal-and-approval rail, which is perhaps two days of work and is worth building
   now *because it is cheap and it shapes everything else*. The agents themselves should wait.
   Section 6 explains what to build now and what to leave.
2. **Do not create a "work package" object.** `Issue` is already one — it has priority, status,
   trade, assignees, estimated and actual hours, scheduled and due dates, costs, time entries, a
   checklist, tags and a thread. Adding a parallel object alongside it would split every list,
   every report and every dashboard in the app in two. v2 should give `Issue` a parent and
   dependencies, not a rival. This is the single most consequential call in this document.
3. **B is the cheapest win and it is being done by hand right now.** The reporting "bible"
   described in the project summary — daily tabs, 2am and 5am readings, WTD/MTD/YTD, charts —
   is a month of spreadsheet maintenance that this app could absorb in one slice. Project
   management was asked for first and the build order below respects that, but B is small enough
   to run alongside A rather than behind it.

---

## 1b. Can this run heavy construction?

Asked directly, so answered directly: **not yet, and the gap is narrower than it
looks.** The structure is right and four specific things are missing. None of them is
architectural.

### What is in place and genuinely sufficient

| | |
|---|---|
| Work breakdown | Unlimited nesting; a phase is an ordinary task with children |
| Tree semantics | A phase's dates and progress come from its children; it finishes only when they do |
| Dependencies | Finish-to-start, start-to-start, finish-to-finish, with lag. Loops refused |
| Schedule | Forward and backward pass, float, longest chain, and plans that contradict themselves |
| Baselines | Frozen deliberately; slippage visible per task and per project |
| Progress | Per cent complete per task, duration-weighted up the tree |
| Money | Approved, committed, actual; quotes with the three-quote rule and an audited award |
| Governance | Stakeholders with roles, blockers with an owner and an age |
| Chart | Gantt with arrows, baselines, summary brackets, progress fill, critical chain |

For a multi-part job — substructure, frame, envelope, fit-out, each with sub-packages
and overlapping trades — that is a workable planning tool today.

### The four things that are missing, in the order they will bite

**1. ~~A working-day calendar.~~ Done.** Opt-in per property, with a fallback for the
rest; a weekly pattern plus exceptions in both directions, because a holiday and a
Sunday worked to claw back a slipped pour are equally real and only one of them gets
remembered. The whole schedule pass now works in working-day ordinals, so float, lag
and the longest chain are all counted in days somebody actually works. Days nobody
works are shaded on the chart.

Opt-in deliberately: setting a calendar changes every float figure on that
property's programmes, so it is a decision rather than something that happens during
a deploy. Without one, behaviour is exactly as before.

**What it did not fix, and what that needs.** There is no duration field — only typed
dates — so a task's duration is the working days *inside* its range. A shutdown in the
middle therefore reduces what the range holds rather than pushing the end out. That is
defensible, since somebody typed that end date, but it is not what people expect. The
expected behaviour needs duration as a first-class field with dates derived from it,
which is a bigger change than the calendar was and conflicts with `scheduledFor` and
`dueDate` being used by the day planner and the response targets. Worth doing, not
worth faking.

**2. Earned value.** Per cent complete and budget both exist, so planned value, earned
value and actual cost are all derivable — but nothing computes them, which means no
schedule or cost performance index. On heavy work those two numbers are how progress
is reported upward. Small, now that the inputs are there.

**3. Quantities and unit rates.** Heavy construction is planned by quantity — cubic
metres of concrete, tonnes of steel — with a rate against each, and progress measured
as quantity placed. `Cost` has an amount and a quantity but there is no bill of
quantities, so a task cannot say "400 m³ at $x, 240 placed". Medium.

**4. Variations and change orders.** A change to scope mid-job has to be tracked
separately from the baseline, with its own approval and its own effect on budget and
programme. Right now a scope change is indistinguishable from the original plan once
it is typed in. Medium, and the thing an auditor or a claim will ask for.

### Smaller gaps, worth knowing about

- **Resource levelling.** Crews can be assigned and there is a day planner, but
  nothing shows a trade over-committed across a project.
- **One baseline only.** Re-baselining overwrites; construction often keeps several.
- **Free float** is not computed, only total float.
- **Submittals, RFIs, progress claims and retention** — contract administration
  generally — are absent. Whether they belong here or in the contract is a real
  question, not an oversight.
- **Drawings.** Photographs attach to work; drawings and revisions do not. This
  overlaps the property manual in section 5.
- **The Gantt does not print.** It scrolls horizontally, which paper does not do.

### The honest summary

The bones are right and the tree semantics are now correct, which was the part most
likely to have been wrong. What is missing is arithmetic and record-keeping layered on
top of a model that already holds the right things — not a different model. The
working-day calendar is the one that would change numbers already on screen, so it
should come before the other three.

---

## 2. What was taken from the two reference projects

I read both READMEs on github.com. I did **not** read either data model: `openproject.org`
is outside this session's allowed network, so the user guide could not be fetched. What follows
is therefore a judgement about which *ideas* to borrow, not a transcription of their schemas.
Treat it as such.

### OpenProject — take the work-package graph, leave the breadth

Worth borrowing:

- **A single work item type with hierarchy**, so a phase, a task and a milestone are the same
  object at different levels rather than three tables. This is what lets a budget or a
  percentage roll up without special cases.
- **Typed relations between items** — *precedes*, *follows*, *blocks*, *relates*. A maintenance
  department lives on "the scaffold has to come down before the painters can start".
- **Baselines.** The planned dates kept separately from the current dates, so slippage is
  visible rather than overwritten. The app currently overwrites, so no one can see drift.
- **Budget as a first-class object on the project**, with committed and actual rolled up from
  the children.

Deliberately not borrowing: Scrum and SAFe boards, forums, news, wikis, product and release
planning. OpenProject is a general tool aimed substantially at software teams. Most of its
surface is dead weight for a 340-room engineering department, and every screen adopted is a
screen to maintain.

### NocoBase — take the narrow version, refuse the wide one

NocoBase's organising idea is that the data model itself is editable at runtime: define
collections and fields, and the interface follows. It is genuinely clever and it is the wrong
trade here.

A runtime-editable schema is a permanent complexity tax — migrations, validation, permissions
and reporting all become dynamic, and every future feature has to cope with a shape it cannot
know. You would be buying the ability to add a field without a developer, at the cost of making
every other change harder.

**The narrow version is worth having:** user-defined custom fields on a small, fixed set of
objects (asset, work item, project), stored as typed key/value rows. That covers "we need to
track a serial number on chillers" without making the whole app dynamic.

The second idea worth taking from NocoBase is **permissions and workflow as built-in
primitives rather than per-feature logic.** This app already does the first half — there is one
capability table rather than scattered role checks. It does not yet have the second half, which
is section 6.

---

## 3. (A) Project management

### What exists

`Project` is a thin container: name, description, property, status, and a list of issues.
`Issue` is, as noted, already most of a work package.

### What v2 adds

**On `Project`:** an owner, planned and actual start/end, a baseline of those dates, an approved
budget, a phase list, and a sign-off record. Status widens beyond `open | done | cancelled`.

**On `Issue`:** three fields and one new table.

```
parentId      String?   // work breakdown: a task under a phase under a project
isMilestone   Boolean   // a dateline with no duration — permits, deliveries, handover
baselineStart String?   // the planned dates, frozen, so slippage is visible
baselineDue   String?
```

```
model IssueLink {          // typed dependency graph
  fromIssueId  String
  toIssueId    String
  kind         String      // precedes | blocks | relates
  lagDays      Int?
}
```

Hierarchy and dependencies are what turn a list of jobs into a plan. Everything else — Gantt,
critical path, rollups — is a view over those two.

### Quotes, because the rule already exists

The department rule is **at least three quotes on any contractor job**, with EAM sending the RFQ
and notifying the award. That rule is currently enforced by memory. It should be a table:

```
model Quote {
  issueId / projectId
  contractorId
  amount, currency
  requestedAt, receivedAt
  status        // requested | received | declined | awarded
  documentId?
}
```

The payoff is that "has this job got its three quotes?" becomes a field rather than a
conversation, and award is an auditable event. This is a small table with a disproportionate
return, and I would build it in the first slice.

### Rollups

Budget versus committed versus actual, and percent complete, computed up the hierarchy. The
pieces already exist — `Cost` per issue, `TimeEntry` per issue — they have never been summed
against an approved figure because there was no approved figure to sum against.

---

## 4. (B) Daily utility logging and graphs

This is the most precisely specified of the four, because the project summary already settled
the rules. Restating them as the spec:

| Rule | Consequence for the model |
|---|---|
| Readings at **02:00 and 05:00** | Every reading carries which slot it belongs to |
| The day runs **05:00 to 05:00** | A reading's "day" is derived, not the calendar date |
| Overnight window is **02:00–05:00** | A separate night aggregate, not a filter applied later |
| Site electricity = **all meters summed**; the incoming line is **"Main meter"** | Meters carry a flag for whether they roll into the site total, and the main line is named, not numbered |
| Propane and diesel entered as **% or fraction** | Stored raw *and* converted; conversion needs tank capacity |
| Water tank is a **height fraction × litre capacity** | Tank geometry belongs on the meter point |
| Metric throughout; °C | Units are per meter point, with a metric default |

```
model MeterPoint {
  propertyId
  name                 // "Main meter", "Chiller plant", "Propane bulk 1"
  kind                 // electricity | water | propane | diesel
  entryMode            // direct | percentage | tank_height
  unit                 // kWh | litre | m3  — stored, never assumed
  capacityLitres       Float?   // for percentage and tank_height
  tankMaxHeightMm      Float?   // for tank_height
  includeInSiteTotal   Boolean
}

model Reading {
  meterPointId
  takenAt       DateTime
  slot          String   // "0200" | "0500"
  readingDay    String   // the 05:00–05:00 day it belongs to, computed on write
  rawValue      Float    // exactly what was read, never normalised
  value         Float    // converted to the meter's unit
  takenBy
}
```

**Two open items from the project summary get answered by this design rather than deferred.**

*Water in litres or US gallons (open item 3).* The unit lives on the meter point, so the
ambiguity stops being global. A meter read in gallons is recorded in gallons and converted once,
and the conversion is visible rather than assumed. Nothing has to be settled before building.

*Electricity up "nearly 30%" (open item 4).* The app should not accept a claimed percentage. It
should store the **invoice** per period — amount, kWh billed, period — and derive cost per kWh
from it. Then the trend is a computed figure with a document behind it, which is what makes it
safe to put in a monthly report. I would treat "verify against the invoice" as a feature, not a
to-do.

```
model UtilityInvoice {
  propertyId, kind
  periodStart, periodEnd
  amount, currency
  quantity, unit        // kWh billed
  documentId?           // the invoice itself
}
```

Derived cost per unit, month over month, with the invoice attached. Any trend the app states, it
can show its working for.

### Output

One screen: the property in a nutshell. Daily line charts per utility, the night window
separately, week-over-week, and WTD/MTD/YTD against the same period last year. A flat log page
of cleaned data for anything the app has not thought of yet — which is what the spreadsheet is
really providing today and should not be taken away.

> **Charting is a dependency decision.** The app currently draws its trend charts by hand in
> SVG. Six or seven utility charts with shared axes and tooltips is past the point where that is
> sensible. This needs one small charting library, chosen once.

---

## 5. (C) The property manual

The largest and most valuable of the four. The description given was: log the property, sync the
GPS map to a drawing to make a new view, then log key equipment — panels and breakers *and what
they control*, valves and pipe locations, generators, tanks, and where the rooms are.

### Why this is worth the effort

Every other feature in the app helps you record a problem. This one helps you *act* on one. The
questions it answers are the ones that cost the most time in an emergency and are currently
answered by whoever has been there longest:

- Which breaker isolates room 214, and which panel is it in?
- Which valve shuts off this pipe without dropping the whole block?
- What else goes dark if I open this breaker?
- Where is the nearest isolation point to this leak?

That last class of question — *what else is affected* — is why this cannot be a list of
equipment with photographs. It needs the connections.

### Three layers

**1. A location hierarchy.** Property → block → floor → space. The blocks are already named:
Coubaril, Millionaire, Point Suites, Blue Suites, Tennis. 340+ rooms hang off this, and so does
every report that currently matches on a free-text room name. Replacing the free-text `roomName`
is a migration with real consequences, so the two should coexist: a nullable `spaceId` added
beside `roomName`, backfilled gradually, with the text kept as the fallback.

**2. The drawing layer.** A floor plan or site drawing, georeferenced onto the existing Leaflet
map so that drawing coordinates and GPS coordinates are the same space.

```
model FloorPlan {
  propertyId, name, level
  imageId
  // Affine georeference: three points identified on both the image and the map.
  controlPoints Json   // [{imageX, imageY, lat, lng} x3]
  opacity, order
}
```

The pragmatic approach is a raster overlay with three control points, which Leaflet supports
directly and which someone can set up in a browser in a few minutes per drawing. Vector/CAD
import is a much larger piece of work and should not be in the first version — but the control
point model is the same either way, so starting with raster does not close the door.

**3. Assets and the connections between them.**

```
model Asset {
  propertyId, spaceId?
  kind            // panel | breaker | valve | generator | tank | pump | ahu | fcu
                  // ice_machine | lift | meter | grease_trap | ...
  ref             // "DB-3", "CB-14", "V-207"
  parentAssetId?  // a breaker lives in a panel; a pump lives in a plant room
  lat, lng?       // on the map
  floorPlanId?, planX, planY?   // and/or on a drawing
  installedAt?, serialNumber?, model?, capacity?
  lastServicedAt?, serviceIntervalDays?   // the 90-day AC standard lives here
}

model AssetRelation {
  fromAssetId
  toAssetId?      // breaker feeds a sub-panel; valve isolates a pump
  toSpaceId?      // breaker feeds room 214
  kind            // feeds | isolates | serves | drains | vents
}
```

`AssetRelation` is the heart of it. It is a directed graph, not a tree — one room is fed by a
breaker and served by a valve and conditioned by an air handler, and each of those has its own
upstream. Modelling it as a tree would be simpler and would be wrong.

With that graph, "what does this breaker control" is a traversal, and so is its inverse, "what
feeds this room" — which is the question people actually ask.

### What this unlocks that is already being asked for

- **AC servicing.** `serviceIntervalDays` on the asset makes the 90-day standard a property of
  the equipment rather than a column in a tracker. "Not serviced in 3 months" becomes a query
  over every unit — rooms, back of house and public areas in one list.
- **Generators.** The weekly 30-minute no-load test and the monthly one-hour load test become
  recurring schedules attached to a named asset, with the test result recorded against it.
- **Legionella and water hygiene.** The matrix maps onto assets (tanks, outlets, calorifiers)
  with recurring checks and **recorded temperatures** — see the schema note below.
- **Inspections get a target.** A finding can point at the asset that is faulty, not just the
  room it is in.

### The schema decision that has to be made first

The inspections stocktake flagged this already: **there is nowhere to record a number on a
check.** Every point is a three-way judgement. But a chlorine reading, an outlet temperature, a
fridge temperature and a generator run-hour are all numbers, and for those the trend matters more
than whether today's value passed.

This one change — a nullable numeric value, a unit and an acceptable range on an inspection
check — serves the Legionella matrix, pool chemistry, the generator tests and the kitchen cold
chain. **Three of the four subsystems in this document want it.** It should be decided and built
early, before anybody writes new checklist content against the old shape.

---

## 6. (D) Groundwork for automation

Written for someone who has not set agents up before, because that was the stated position.

### The honest shape of the problem

An agent that can act on this app needs three things, and only one of them is agent code:

1. **Something to read.** Structured, queryable state. This is subsystems B and C. An agent
   cannot reason about equipment that exists only as a free-text room name.
2. **Somewhere safe to act.** Not direct database writes. A place to put a *proposal* that a
   human accepts or rejects.
3. **A record of what it did.** Already present — the activity log covers every mutation.

So the groundwork is (2), it is small, and it is worth building now. (1) comes free with B and C.
(3) exists.

### What to build now

```
model AgentRun {
  kind         // "overdue-sweep" | "reading-anomaly" | "ac-due" | ...
  startedAt, finishedAt
  trigger      // schedule | manual | event
  status       // running | done | failed
  summary
}

model AgentProposal {
  agentRunId
  action       // "raise-issue" | "reassign" | "flag-reading" | "order-part"
  payload      Json          // exactly what would be done
  rationale    String        // why, in words, for the person approving
  confidence   Float?
  status       // pending | approved | rejected | applied | expired
  decidedBy, decidedAt
}
```

**Why a proposal and not an action.** The department already works this way — sign-off is a
supervisor plus one of two assistant chiefs or the chief. An agent that files a proposal fits
that existing culture exactly, and it means the first version cannot do damage. Once a given
proposal type has been approved a few hundred times without a correction, *that type* can be
promoted to act directly. That is a per-action decision made on evidence, not a switch thrown at
the start.

### The part that surprises people

**The first "agents" should not use a model at all.** Write them as plain scheduled functions
that produce proposals:

- every AC unit past 90 days → propose a work order
- any reading more than *n*% off the trailing fortnight → propose a flag for review
- any P1 or P2 open past its response target → propose an escalation
- any contractor job without three quotes → propose a hold

Each is a few lines of SQL and a row in `AgentProposal`. They will cover a surprising amount of
what you would otherwise want an agent for, they are debuggable, and they cost nothing to run.

Then the rail is already built and proven, and introducing a model is a small, contained change
in one place — for the jobs that genuinely need judgement rather than a threshold: reading a
supervisor's turnover narrative and proposing the work orders it implies; clustering a month of
findings into a capital request; drafting the monthly report from the logs.

**The recommendation: build the rail, write the threshold jobs, and do not put a model behind
anything until there is a job that visibly needs one.** It is not the exciting answer but it is
the one that gets automation running this quarter instead of next.

---

## 7. Build order

| Slice | Contents | Why here |
|---|---|---|
| ~~**1**~~ | ~~Work breakdown: `parentId`, `isMilestone`, baselines, `IssueLink`, project budget/owner/sign-off, `Quote`~~ | **Done** — `632caa9` |
| ~~**1b**~~ | ~~`ProjectLink`, `Blocker`, `Stakeholder`, critical path and float, Gantt with dependencies and baselines, progress curve~~ | **Done** — `991493b` |
| ~~**1c**~~ | ~~Tree semantics: a phase finishes only when its tasks do, dates and progress roll up, start-to-start and finish-to-finish, per cent complete~~ | **Done**. 334 checks in `tests/` |
| ~~**1d**~~ | ~~A working-day calendar, with two-way exceptions~~ | **Done**. 423 checks in `tests/` |
| **1e** | Earned value (PV/EV/AC, SPI/CPI) | Inputs now exist; small |
| ~~**2**~~ | ~~Numeric readings on inspection checks (value, unit, acceptable range, trend)~~ | **Done**. 484 checks in `tests/` |
| **3** | Daily readings: `MeterPoint`, `Reading`, `UtilityInvoice`, the nutshell dashboard, one charting library | Smallest, pays back daily, replaces live spreadsheet work |
| **4** | Location hierarchy: block → floor → space, coexisting with `roomName` | Foundation for the manual; touches a lot, so early |
| **5** | Assets and `AssetRelation`; AC and generator intervals on assets | The manual's substance |
| **6** | Floor plans: raster overlay, three-point georeference, the drawing map view | Depends on 4 and 5 |
| ~~**7**~~ | ~~Gantt and critical path~~ | **Pulled forward into 1b** |
| **8** | Automation rail: `AgentRun`, `AgentProposal`, approval screen, threshold jobs | Needs 3 and 5 to have anything worth proposing |

Slices 1 and 3 are independent and can run in parallel. Slice 2 should go in before any new
checklist content is written in another conversation.

---

## 8. Things that must be dealt with on the way

### ~~Pagination~~ — done

`GET /issues` returned every issue with every relation in one unbounded response. A page is now
200 with a hard ceiling of 1000 no caller can raise, and the response carries the true total so
a caller can say what it is not showing. The printable report and the property workspace page
through and both say so on screen when they are showing fewer than exist. The dashboard is
capped at 1500 rather than loading every open issue.

Tested against 230 real issues: three pages at 100 reach each one exactly once, a limit of
99,999 clamps to 1000, and a default page is 190KB.

What is left here: the list still carries the full relation set per row, which no list screen
needs. Paging makes that survivable rather than cheap, and a lean list select would be the next
improvement. The aggregate endpoints (`insights`, `export`) still read broadly by design.

### Volume of readings

Several meters, twice a day, every day, is tens of thousands of rows a year. SQLite is entirely
comfortable with that; the aggregates are what need care. Pre-compute the daily rollups on write
rather than scanning the reading table for every chart.

### The critical dependency advisory is still open

`proxy-addr` allows a forged client address, which on this deployment lets the login rate
limiter be bypassed. A non-major fix exists and has not been applied. It should be cleared before
v2 work starts, not after, and the reinstall this session needed is the natural moment.

### Backups are still on the volume they protect

Unchanged and still the highest operational risk. v2 adds considerably more irreplaceable data —
a property manual is months of surveying that cannot be reconstructed from memory. Off-platform
backup should land before the manual is populated, not after.

### Found while building slice 1b

**Float against typed dates is not the critical path.** Every item here carries dates
somebody chose, so float measures the gap to the next constraint — weekends included,
because a job can genuinely slide into one. On a Monday-to-Friday plan that leaves
almost nothing "critical", which is accurate and useless. So the analysis reports
three things instead of one: float against the plan as typed, the **longest chain** by
duration alone (where the end date actually comes from, and stable against calendar
gaps), and **violations** — jobs planned to start before their own dependencies allow.
The third is usually the most actionable: it finds plans that contradict themselves.

There is no working-day calendar, so durations are counted in calendar days. That
matters less here than in an office, because this department works Monday to Saturday
with Sunday covered.

**A summary row must take no part in the schedule.** Caught by a failing test rather
than by reasoning: a phase spanning two months came out as "the longest chain",
beating the eighteen-day chain of dependent work inside it. A parent's dates are an
envelope around its children, so it is excluded from the analysis entirely — the same
reason the progress rollup counts leaves only — and drawn as a bracket rather than a
bar.

**A blocker is not a dependency**, and conflating them loses the thing that matters. A
dependency resolves itself when the work in front finishes; nobody has to do anything.
A blocker needs somebody to go and sort it out, and its *age* is the management signal
— one raised this morning and one sitting for a month are different problems, and no
dependency graph can tell them apart. So blockers carry an owner, a kind, a resolution
and a cleared-at, and are cleared rather than deleted: how long work sat waiting is the
figure the table exists to produce.

### Found while building slice 1

**`projectId` was accepted nowhere on an issue.** An issue could only join a project
through `POST /projects/:id/issues`, so building a breakdown took two calls per job and
an issue could not be moved between projects at all. Fixed in slice 1.

**The pool section does not use the `pool_spa` trade.** Recorded in `INSPECTIONS.md` and
still open: the twelve-point private pool and hot tub section is categorised across
`plumbing`, `general`, `fire_safety`, `hvac` and `electrical`, so a flagged pool pump
proposes a plumber rather than the pool technician. It is a content fix, best done with
whatever checklist rewrite comes out of slice 2.

### Smaller items from the project summary

- **Legal paper (8.5 × 14 in).** The daily supervisor checklist prints on Legal. The app's
  sheets are sized for the intersection of A4 and Letter — 190 mm wide — which fits Legal's width
  but wastes 77 mm of its length. Paper should be a per-document choice so a Legal checklist gets
  the rows it has room for.
- **Sell-status tracker** — GREEN / AMBER / RED per room, weekly, with last-inspected and
  worked-on dates. This is a view over slice 4 plus a status field, not a new subsystem.
- **Shift checklists with a turnover report.** The inspection engine nearly does this; what is
  missing is a narrative turnover field and an issues-to-be-addressed table carrying EAM numbers.
- **Metric and °C throughout**, per the stated preference. Units are per meter point in slice 3;
  the rest of the app should be audited for assumed units.

---

## 9. What I have not decided, and would want a view on

1. **Does the drawing layer need to carry room boundaries, or only points?** Points are far
   cheaper; boundaries let you shade a whole room by status, which is a strong dashboard. It
   changes slice 6's size materially.
2. **Should the EAM remain the system of record for work orders**, with this app feeding it, or
   should this app become the record? Today it links out. The answer decides whether slice 1 is a
   planning layer over the EAM or a replacement for part of it — and that is a much bigger
   question than it looks.
3. **How much of the manual can realistically be surveyed, and by whom?** The schema is the easy
   half. Several hundred rooms, panels and valves is a field exercise, and a half-populated manual
   is worse than none because it cannot be trusted. Worth deciding the survey plan before the
   software is ready for it.
