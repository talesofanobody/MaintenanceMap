# Inspections — what we currently look for

**As of 19 October 2026.** Extracted from `server/src/lib/inspections.ts`, which is the single
source of truth for the templates a fresh install starts with.

This document exists to be handed to someone — or to another conversation — as the starting
point for writing a **more complete** inspection regime. It is a stocktake, not a
recommendation: it lists exactly what the app asks today, in full, so that whatever comes next
can be built on top of it rather than reinventing it.

**Two caveats before the lists.** These templates cover **101 points in total**, and they cover
a guest room thoroughly and a public area thinly. Section 5 sets out what is missing, which for
the purpose of building a complete checklist is the most important part of this document.

---

## 1. How a point is shaped

Every point in the system is three fields, and a new checklist has to supply the same three:

| Field | Purpose | Example |
|---|---|---|
| `label` | What is being looked at. A noun, not a question. | `WC flush and cistern` |
| `hint` | What "right" looks like, concretely. | `Full flush, refills quietly, no running after 60 seconds` |
| `category` | Which trade it belongs to, used to propose who gets the resulting job. | `plumbing` |

**The `hint` is the load-bearing field.** A checklist that says "Bathroom — OK?" produces
nothing but ticks. One that says "no running after 60 seconds" produces findings, because it
tells whoever is holding the phone what the failure actually looks like. Any new checklist
should be judged on whether its hints are specific enough to be falsifiable by someone who has
never done the walk before.

Points group into **sections**, and sections exist mainly so a whole group can be dismissed in
one tap — "Not in this room" marks everything beneath a heading as N/A, which matters because
most rooms have no private pool. Group by *what a person walks past in sequence*, not by trade.

### What the inspector records

| | |
|---|---|
| Outcome | **Fine** / **Flag it** / **N/A** |
| Severity, if flagged | **Minor** / **Moderate** / **Major** |
| Then | a free-text note, and photographs (camera or library) |

Severity maps straight to the priority of the job it becomes: minor → low, moderate → medium,
major → high. So severity is not a feeling, it is a scheduling decision — which is worth saying
explicitly in any new checklist's guidance.

### The three types that exist

| Type | Shape | Area field suggests |
|---|---|---|
| **Guest room** | 82 fixed points, 8 sections | `Room 214` |
| **Public area** | 19 fixed points, 5 sections | `Main lobby` |
| **General** | No checklist — 10 blank slots, each taking a name, an area and a description | `Where is it?` |

The **General** type is the honest admission that the other two do not cover everything: it is
for the walk where nobody knows in advance what they are looking for. A large part of the value
of a more complete checklist is reducing how often General has to be used.

### Trade spread across all 101 points

`general` 15 · `furniture` 14 · `fire_safety` 14 · `plumbing` 12 · `hvac` 9 · `doors_locks` 7 ·
`electrical` 6 · `carpentry` 4 · `lighting` 4 · `painting` 4 · `flooring` 3 · `cleaning` 3 ·
`appliance` 2 · `av_it` 2 · `lift` 2

The full set of categories available — any new checklist should draw from these rather than
invent new ones, since they are what drives job assignment:

`plumbing` · `electrical` · `hvac` · `appliance` · `kitchen` · `laundry` · `carpentry` ·
`painting` · `flooring` · `doors_locks` · `furniture` · `lighting` · `av_it` · `pool_spa` ·
`grounds` · `cleaning` · `pest_control` · `fire_safety` · `lift` · `general` · `admin_office`

Note that **`kitchen`, `laundry`, `pool_spa`, `grounds`, `pest_control` and `admin_office` are
never used by any current point.** Six of the twenty-one trades the app knows about are not
reached by any inspection. That is the clearest single indicator of where the coverage gap is.

> **One of those six is a content bug, not a gap.** The Guest room checklist has a 12-point
> *Private pool or hot tub* section, and not one of its points is categorised `pool_spa` — they
> are spread across `plumbing` (4), `general` (4), `fire_safety` (2), `hvac` (1) and
> `electrical` (1). Since the category is what proposes who gets the job, a flagged pool pump
> currently suggests a plumber rather than the pool technician. Worth correcting whether or not
> the checklist is rewritten.

---

## 2. The full current checklist

What follows is every point, verbatim, in walking order.

### Guest room — 82 points

*Full room check, walked the way a guest would arrive and use it.*  
Area field suggests: `Room 214`

#### Door and entry (9)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Door leaf and frame** | Dents, scuffs, chipped paint, gaps at the frame | `doors_locks` |
| 2 | **Lock and card reader** | Reads first time, no grinding, battery light | `doors_locks` |
| 3 | **Door closer** | Closes fully and latches on its own without slamming | `doors_locks` |
| 4 | **Privacy latch and peephole** | Latch throws cleanly, peephole clear and not loose | `doors_locks` |
| 5 | **Door hinges** | No paint on them, screws tight, swings without squeaking or dropping | `doors_locks` |
| 6 | **Door frame trim and caulking** | Filled, painted, sealed where it meets the wall — no open joints | `carpentry` |
| 7 | **Door seals and threshold** | Light or draught under the door, worn brush strip | `doors_locks` |
| 8 | **Room number and signage** | Straight, clean, fully attached | `general` |
| 9 | **Entry light and switch** | Works, switch plate straight and unmarked | `lighting` |

#### Bathroom (21)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **WC flush and cistern** | Full flush, refills quietly, no running after 60 seconds | `plumbing` |
| 2 | **WC seat and fixings** | No movement side to side, no staining at the hinges | `plumbing` |
| 3 | **Basin taps** | Both temperatures, no drip, aerator not furred | `plumbing` |
| 4 | **Basin drainage** | Drains within seconds, plug seals, no smell | `plumbing` |
| 5 | **Shower pressure and temperature** | Reaches temperature within a minute and holds it | `plumbing` |
| 6 | **Shower controls and handle** | Handle straight, turns without friction, trim plate flush and sealed | `plumbing` |
| 7 | **Shower head and hose** | Secured to its bracket, no drip at the joint, no limescale or kinks | `plumbing` |
| 8 | **Shower drainage** | No pooling after two minutes of running | `plumbing` |
| 9 | **Grout and silicone** | Mould in corners, missing or lifting sealant | `general` |
| 10 | **Tiles** | Cracks, chips, hollow-sounding or loose tiles | `flooring` |
| 11 | **Extractor fan** | Pulls tissue against the grille, no rattle, grille clean | `hvac` |
| 12 | **Mirror and lighting** | De-silvering at the edges, even light, no flicker, fitting flush and matching its neighbours | `lighting` |
| 13 | **Bathroom door** | Closes and latches, clears the tile without scraping, strike lines up | `doors_locks` |
| 14 | **Vanity counter and joints** | Level, joints tight and even, no gaps where it meets the wall or basin | `carpentry` |
| 15 | **Vanity unit, doors and drawers** | Open and close cleanly, fronts aligned, no scuffs or residue | `furniture` |
| 16 | **Sealant at junctions** | WC base, counter to wall, bath and shower edges — continuous, clean, not mouldy | `general` |
| 17 | **Mirror fixings** | Solid to the wall, no movement or squeak, edges undamaged | `general` |
| 18 | **Towel rails and hooks** | Rails, hooks, paper holders and flask brackets — all present, firm to a pull, none rocking | `furniture` |
| 19 | **Bath or shower screen** | Seals, runners, glass clarity, no chips | `general` |
| 20 | **Switch and socket plates** | Flush to the wall, covers present, not cracked or painted over | `electrical` |
| 21 | **Sockets and shaver point** | Correct distance from water, plate unmarked, works | `electrical` |

#### Bedroom (15)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Bed frame and legs** | No creak when leant on, castors present, no scuffs to the legs, foot or frame | `furniture` |
| 2 | **Mattress** | Dips, stains, protector intact and correctly fitted | `furniture` |
| 3 | **Headboard** | Firm against the wall, fabric clean and unmarked | `furniture` |
| 4 | **Bedside lights and switches** | Both sides, shade straight, bulb colour matches | `lighting` |
| 5 | **Bedside sockets and USB** | All live, plates flush, USB charges | `electrical` |
| 6 | **Curtains and blackout** | Runs the full track, no light gap when closed, hooks intact | `furniture` |
| 7 | **Wardrobe and hangers** | Doors aligned and closing, hinges clean, rail firm, hanger count, skirting inside sealed | `furniture` |
| 8 | **Safe** | Opens, closes, resets, battery and instructions present | `general` |
| 9 | **Minibar or fridge** | Cold, door seal, no smell, not iced up, quiet, interior undamaged | `appliance` |
| 10 | **Kettle and tray** | Boils and cuts out, flex undamaged, tray complete | `appliance` |
| 11 | **Television and remote** | Powers on, channels tune, remote batteries, cables tidy | `av_it` |
| 12 | **Desk, chair and mirror** | Wobble, scuffs, chair gas lift holds height | `furniture` |
| 13 | **Chest, nightstands and drawers** | Every drawer opens and closes, runners sound, tops and sides unscuffed | `furniture` |
| 14 | **Cabinet or entertainment unit** | Doors aligned and closing, no scuffs, residue or lifting veneer | `furniture` |
| 15 | **Luggage rack** | Straps intact, folds and locks open | `furniture` |

#### Air conditioning and heating (6)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Unit operation** | Reaches set temperature, responds to the control | `hvac` |
| 2 | **Filter** | Dust visible at the grille, filter clean and refitted | `hvac` |
| 3 | **Noise and vibration** | Rattles or hums audible from the bed | `hvac` |
| 4 | **Condensate and staining** | Marks below the unit, damp on the wall | `hvac` |
| 5 | **Vents and grilles** | Secure, undented, clean — including any vent in a door or on the outside | `hvac` |
| 6 | **Thermostat or control panel** | Present, display legible, buttons respond, mounted straight | `hvac` |

#### Windows and balcony (9)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Window operation** | Opens and closes fully, handles firm, locks engage | `general` |
| 2 | **Window restrictor** | Fitted, engaged and not defeated | `fire_safety` |
| 3 | **Glazing** | Chips, cracks, blown double glazing, seals | `general` |
| 4 | **Balcony railing** | No movement at all under firm pressure, fixings sound | `fire_safety` |
| 5 | **Blinds, rods and blocking** | Rod present and firm, blind runs true, wall behind it properly blocked out | `furniture` |
| 6 | **External walls, soffit and drainage** | Render and paint intact, nothing chipping, downpipes and drains connected | `general` |
| 7 | **Balcony floor and drainage** | Standing water, lifting tiles, blocked outlet | `general` |
| 8 | **Door and window sensors** | Fixed down, aligned with their magnet, reading correctly when the door shuts | `av_it` |
| 9 | **Balcony furniture** | Stable, clean, cushions unstained, no rust at the joints | `furniture` |

#### Finishes (5)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Walls** | Scuffs, knocks behind doors and at luggage height, filler showing | `painting` |
| 2 | **Ceiling** | Water marks, cracks, cobwebs — and no tape or filler showing through, including over the shower | `painting` |
| 3 | **Skirting and architrave** | Skirting, architrave and crown moulding — gaps, knocks, mismatched runs, unsealed joints | `carpentry` |
| 4 | **Flooring** | Lifting edges, stains, squeaks, transition strips | `flooring` |
| 5 | **Paintwork touch-ups** | Patches that do not match the surrounding sheen or colour, overspray on hinges and hardware | `painting` |

#### Private pool or hot tub (12)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Water clarity and level** | Clear, no film or debris, level up to the skimmer | `plumbing` |
| 2 | **Pump and filtration** | Runs without grinding or cavitating, no leaks at the unions | `plumbing` |
| 3 | **Heater and thermostat** | Reaches the set temperature, controls readable and responding | `hvac` |
| 4 | **Jets, blower and controls** | Every jet flows, controls respond, nothing airlocked | `plumbing` |
| 5 | **Waterline tiles and grout** | No loose or missing tiles, grout sound, no scale line | `general` |
| 6 | **Coping, surround and decking** | Level, no lifting or cracking, nothing sharp underfoot | `general` |
| 7 | **Steps, handrail and grab bar** | Firm, no movement, non-slip surface still doing its job | `fire_safety` |
| 8 | **Skimmer, drain and overflow** | Covers present and secured, overflow running clear | `plumbing` |
| 9 | **Underwater and surround lighting** | All lamps working, lenses sealed, no water in the fitting | `electrical` |
| 10 | **Cover, lid and lifter** | Sits properly, clips work, no tears or waterlogging | `general` |
| 11 | **Depth marking and safety signage** | Present, legible, correct for the depth | `fire_safety` |
| 12 | **Chemical smell and skin feel** | No sting or heavy chlorine smell — the first sign the balance is off | `general` |

#### Safety (5)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Smoke detector** | In place, indicator light, not painted over, test date, base matching the unit | `fire_safety` |
| 2 | **Emergency lighting** | Present and working where fitted | `fire_safety` |
| 3 | **Fire notice and escape plan** | On the door, current, legible | `fire_safety` |
| 4 | **Sprinkler head** | Unobstructed, clean, nothing hanging from it | `fire_safety` |
| 5 | **Visible cables and plugs** | No damaged flex, no daisy-chained adaptors | `electrical` |

### Public area — 19 points

*Lobby, corridors, lifts and the front of house a guest walks through.*  
Area field suggests: `Main lobby`

#### Floors and walls (4)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Floor surface** | Trip hazards, lifting edges, stained or worn patches | `flooring` |
| 2 | **Walls and corners** | Trolley damage at corners, scuffs at handle height | `painting` |
| 3 | **Skirting and trims** | Loose sections, gaps, missing end caps | `carpentry` |
| 4 | **Signage** | Straight, clean, current, correctly lit | `general` |

#### Lighting and power (3)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Light fittings** | Failed lamps, mismatched colour temperature, flicker | `lighting` |
| 2 | **Emergency lighting** | Indicators lit, no obstruction | `fire_safety` |
| 3 | **Sockets and covers** | Cracked plates, loose fittings, exposed wiring | `electrical` |

#### Lifts and stairs (4)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Lift call and levelling** | Stops level with the floor, doors do not judder | `lift` |
| 2 | **Lift car condition** | Mirror, handrail, floor, certificate in date | `lift` |
| 3 | **Stair treads and nosings** | Worn nosings, loose treads, missing anti-slip | `fire_safety` |
| 4 | **Handrails** | Firm along the whole run, no sharp joints | `fire_safety` |

#### Comfort and cleanliness (5)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Air conditioning in the space** | Temperature, draughts, grille cleanliness | `hvac` |
| 2 | **Odour** | Drains, damp, bins, cooking carrying from elsewhere | `cleaning` |
| 3 | **Furniture** | Stability, upholstery marks, worn arms | `furniture` |
| 4 | **Plants and decor** | Dead leaves, dust on leaves and frames | `cleaning` |
| 5 | **Bins and ashtrays** | Emptied, clean, lids working | `cleaning` |

#### Safety (3)

| # | Point | What "right" looks like | Trade |
|---|---|---|---|
| 1 | **Fire doors** | Close fully onto the latch, seals intact, not wedged | `fire_safety` |
| 2 | **Extinguishers** | In place, in date, pin and seal intact | `fire_safety` |
| 3 | **Escape routes** | Clear of furniture, deliveries and storage | `fire_safety` |
---

## 3. How the templates behave in the app

Worth knowing before changing them, because the behaviour is deliberately conservative:

- **Starting a walk copies the points onto it.** A report from six months ago shows the
  questions that were actually asked, even if the checklist has since been rewritten. You can
  therefore change a template freely without rewriting history.
- **Improvements are added, never imposed.** When a release improves a checklist, new points are
  added to templates already on an install — additions only, to sections that still exist under
  their original name. A point somebody deliberately deleted stays deleted. A renamed or
  reordered checklist is left alone entirely.
- **Templates can be scoped to one property**, so a resort and a city hotel need not share one
  list.
- **Archiving a finished walk** keeps the findings and the counts for ever but deletes the
  photographs behind findings nobody raised as work. A checklist that generates a great many
  low-value findings therefore costs disk until the walk is archived.

---

## 4. Where the points came from

The two shipped checklists are not theoretical. Two commits in the history exist purely to feed
real findings back into them:

- `0505e8d` — *"Add the checklist points two real inspections showed were missing"*
- `6521723` — *"Add pools and hot tubs, and the rest of what the snag list was finding"*

The working rule has been: **anything an inspector had to add by hand is a question the list
should have asked.** The General type and the "+ Found something else" button are both
instrumentation for this — what gets typed into them is the backlog for the next revision.

If you are writing a replacement, the most valuable input is not a standards document. It is a
few months of actual snag lists from the property.

---

## 5. What is missing — the brief for a complete checklist

This is the part to act on. The current 101 points cover a guest room well and almost nothing
else. Assessed against what a resort operation would ordinarily inspect:

### The Public area checklist is thin, and misnamed in practice

19 points across *Floors and walls, Lighting and power, Lifts and stairs, Comfort and
cleanliness, Safety*. It is really a **corridor and lobby** checklist. Every other public space
is walked with the same 19 generic points or not at all.

### Entire areas with no checklist of their own

| Area | Trades it would reach | Notes |
|---|---|---|
| Restaurants, bars, buffet | `kitchen`, `appliance`, `furniture` | Front of house only; see kitchens below |
| Commercial kitchens | `kitchen`, `electrical`, `fire_safety`, `pest_control` | Highest-consequence area in the building and currently absent |
| Main pools and pool decks | `pool_spa`, `grounds`, `fire_safety` | Only *private* in-room pools are covered |
| Beach, grounds, landscaping, pathways | `grounds` | Not reached at all |
| Gym, spa, treatment rooms | `appliance`, `hvac`, `plumbing` | Not reached at all |
| Laundry and housekeeping stores | `laundry`, `appliance` | Not reached at all |
| Plant rooms, electrical rooms, roof | `electrical`, `hvac`, `plumbing` | Not reached at all |
| Back of house, staff areas | `general`, `cleaning` | Not reached at all |
| Lifts (as equipment, not as a lobby) | `lift` | Two generic points only |
| Car park, arrival, exterior signage | `grounds`, `lighting` | Not reached at all |

### Regimes the app has no vocabulary for

These are not missing points so much as missing *kinds* of inspection, and they are worth
deciding about deliberately rather than by omission:

- **Statutory and life-safety testing** — extinguisher service dates, emergency lighting drop
  tests, alarm panel and sounder tests, fire door integrity, means of escape. There are 14
  `fire_safety` points today, all of them "is it present and does it look right", none of them
  "was it tested, by whom, and when".
- **Water safety** — temperature checks at outlets, dead legs, tank inspection, legionella
  controls. Currently nothing.
- **Electrical safety** — periodic inspection, portable appliance testing, RCD function.
- **Accessibility** — step-free routes, grab rails, accessible bathroom provision, visual and
  audible alarm coverage. Entirely absent, and it is both a legal exposure and a guest-experience
  one.
- **Pest control** — a named trade with no points at all.
- **Food safety and cold chain** — temperatures, probe calibration, storage separation.
- **Energy and water consumption** — dripping taps and failed insulation are findings with a
  running cost, not just a comfort cost.

### Two structural things to decide

1. **Frequency.** Nothing in the app expresses "this is a daily check, that is an annual one."
   Every template is walked on demand. A complete regime distinguishes a daily pool reading from
   an annual fire-door survey, and that distinction currently has nowhere to live. Recurring
   *schedules* exist for maintenance jobs but are not wired to inspection templates.
2. **Pass/fail versus measurement.** Every point today is a three-way judgement. A real regime
   needs recorded *values* — a chlorine reading, a hot-water temperature, a fridge temperature —
   because the trend matters more than whether today's number is acceptable. The data model has
   no numeric field on a check; adding one is a schema change, not a content change.

### Suggested shape for a replacement

If the goal is one complete regime rather than two uneven lists:

- Keep **Guest room** roughly as it is; it is the most mature thing here. Add accessibility and
  water-temperature points.
- Split **Public area** into the areas it is actually pretending to cover: *Corridors and
  stairs*, *Lobby and reception*, *Washrooms*, *Restaurant and bar front of house*, *Pool and
  deck*, *Grounds and arrival*.
- Add the areas that have nothing: *Commercial kitchen*, *Laundry*, *Gym and spa*, *Plant and
  roof*, *Back of house*.
- Treat statutory testing as a **separate type** with a date-and-signature character, not as
  more three-way points mixed into a walk.
- Decide on numeric readings before writing the content, because it changes what a point is.

Aim for specificity over coverage. 40 points with falsifiable hints will find more than 300
points that read "check condition".

---

## Appendix — where this lives in the code

| | |
|---|---|
| Template content | `server/src/lib/inspections.ts` (`DEFAULT_TEMPLATES`, `GENERAL_TEMPLATE`) |
| Categories | `server/src/lib/taxonomy.ts` |
| API | `server/src/routes/inspections.ts` |
| The walk | `client/src/inspections/InspectionRun.tsx` |
| List and start form | `client/src/inspections/Inspections.tsx` |
| Seeding and top-up | `topUpTemplates` / `SEED_VERSION` in `inspections.ts` |

Bump `SEED_VERSION` when template content changes, or existing installs will not receive it.
