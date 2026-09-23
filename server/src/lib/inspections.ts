import { prisma } from "../db";
import { ValidationError } from "./validation";

/**
 * The inspection vocabulary and the templates a fresh install starts with.
 *
 * Kept apart from the rest of the app on purpose: nothing here reaches into
 * issues, scheduling or dashboards, so the inspection domain can be lifted into
 * its own service later with only its routes and this file to carry.
 */

/** What happened when somebody looked at one point. */
export const OUTCOMES = ["ok", "flagged", "na"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_SET = new Set<string>(OUTCOMES);

/** How bad a flagged point is. */
export const SEVERITIES = ["minor", "moderate", "major"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_SET = new Set<string>(SEVERITIES);

export const SEVERITY_WORDS: Record<Severity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
};

/**
 * What a finding becomes when it is turned into work. A dented skirting board is
 * not an emergency; a loose balcony railing is. The reviewer can still change it.
 */
export const SEVERITY_PRIORITY: Record<Severity, string> = {
  minor: "low",
  moderate: "medium",
  major: "high",
};

export const INSPECTION_STATUSES = ["in_progress", "completed", "abandoned"] as const;

export function parseOutcome(value: unknown): Outcome {
  if (typeof value !== "string" || !OUTCOME_SET.has(value)) throw new ValidationError("outcome must be ok, flagged or na");
  return value as Outcome;
}

export function parseSeverity(value: unknown): Severity | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !SEVERITY_SET.has(value)) throw new ValidationError("severity must be minor, moderate or major");
  return value as Severity;
}

interface SeedPoint {
  label: string;
  hint?: string;
  category?: string;
}
interface SeedSection {
  name: string;
  points: SeedPoint[];
}
interface SeedTemplate {
  name: string;
  description: string;
  sections: SeedSection[];
}

/**
 * The starting templates. They are deliberately fussy — the point of an inspection
 * is to catch the small things before a guest does, so each point says what "not
 * right" actually looks like rather than leaving it to whoever is holding the phone.
 *
 * Edit them, or add your own; they are only a starting point and are never
 * re-applied over the top of what you have changed.
 */
export const DEFAULT_TEMPLATES: SeedTemplate[] = [
  {
    name: "Guest room",
    description: "Full room check, walked the way a guest would arrive and use it.",
    sections: [
      {
        name: "Door and entry",
        points: [
          { label: "Door leaf and frame", hint: "Dents, scuffs, chipped paint, gaps at the frame", category: "doors_locks" },
          { label: "Lock and card reader", hint: "Reads first time, no grinding, battery light", category: "doors_locks" },
          { label: "Door closer", hint: "Closes fully and latches on its own without slamming", category: "doors_locks" },
          { label: "Privacy latch and peephole", hint: "Latch throws cleanly, peephole clear and not loose", category: "doors_locks" },
          {
        label: "Door hinges",
        hint: "No paint on them, screws tight, swings without squeaking or dropping",
        category: "doors_locks",
      },
      {
        label: "Door frame trim and caulking",
        hint: "Filled, painted, sealed where it meets the wall — no open joints",
        category: "carpentry",
      },
      { label: "Door seals and threshold", hint: "Light or draught under the door, worn brush strip", category: "doors_locks" },
          { label: "Room number and signage", hint: "Straight, clean, fully attached", category: "general" },
          { label: "Entry light and switch", hint: "Works, switch plate straight and unmarked", category: "lighting" },
        ],
      },
      {
        name: "Bathroom",
        points: [
          { label: "WC flush and cistern", hint: "Full flush, refills quietly, no running after 60 seconds", category: "plumbing" },
          { label: "WC seat and fixings", hint: "No movement side to side, no staining at the hinges", category: "plumbing" },
          { label: "Basin taps", hint: "Both temperatures, no drip, aerator not furred", category: "plumbing" },
          { label: "Basin drainage", hint: "Drains within seconds, plug seals, no smell", category: "plumbing" },
          { label: "Shower pressure and temperature", hint: "Reaches temperature within a minute and holds it", category: "plumbing" },
          { label: "Shower head and hose", hint: "Limescale on the jets, kinks, drips at the joint", category: "plumbing" },
          { label: "Shower drainage", hint: "No pooling after two minutes of running", category: "plumbing" },
          { label: "Grout and silicone", hint: "Mould in corners, missing or lifting sealant", category: "general" },
          { label: "Tiles", hint: "Cracks, chips, hollow-sounding or loose tiles", category: "flooring" },
          { label: "Extractor fan", hint: "Pulls tissue against the grille, no rattle, grille clean", category: "hvac" },
          { label: "Mirror and lighting", hint: "De-silvering at the edges, even light, no flicker, fitting flush and matching its neighbours", category: "lighting" },
          {
        label: "Bathroom door",
        hint: "Closes and latches, clears the tile without scraping, strike lines up",
        category: "doors_locks",
      },
      {
        label: "Vanity counter and joints",
        hint: "Level, joints tight and even, no gaps where it meets the wall or basin",
        category: "carpentry",
      },
      {
        label: "Vanity unit, doors and drawers",
        hint: "Open and close cleanly, fronts aligned, no scuffs or residue",
        category: "furniture",
      },
      {
        label: "Sealant at junctions",
        hint: "WC base, counter to wall, bath and shower edges — continuous, clean, not mouldy",
        category: "general",
      },
      {
        label: "Mirror fixings",
        hint: "Solid to the wall, no movement or squeak, edges undamaged",
        category: "general",
      },
      { label: "Towel rails and hooks", hint: "Firm to a pull, no rust, fixings covered", category: "furniture" },
          { label: "Bath or shower screen", hint: "Seals, runners, glass clarity, no chips", category: "general" },
          {
        label: "Switch and socket plates",
        hint: "Flush to the wall, covers present, not cracked or painted over",
        category: "electrical",
      },
      { label: "Sockets and shaver point", hint: "Correct distance from water, plate unmarked, works", category: "electrical" },
        ],
      },
      {
        name: "Bedroom",
        points: [
          { label: "Bed frame and legs", hint: "No creak when leant on, castors present, no snags", category: "furniture" },
          { label: "Mattress", hint: "Dips, stains, protector intact and correctly fitted", category: "furniture" },
          { label: "Headboard", hint: "Firm against the wall, fabric clean and unmarked", category: "furniture" },
          { label: "Bedside lights and switches", hint: "Both sides, shade straight, bulb colour matches", category: "lighting" },
          { label: "Bedside sockets and USB", hint: "All live, plates flush, USB charges", category: "electrical" },
          { label: "Curtains and blackout", hint: "Runs the full track, no light gap when closed, hooks intact", category: "furniture" },
          { label: "Wardrobe and hangers", hint: "Doors aligned and closing, hinges clean, rail firm, hanger count, skirting inside sealed", category: "furniture" },
          { label: "Safe", hint: "Opens, closes, resets, battery and instructions present", category: "general" },
          { label: "Minibar or fridge", hint: "Cold, door seal, no smell, not iced up, quiet", category: "appliance" },
          { label: "Kettle and tray", hint: "Boils and cuts out, flex undamaged, tray complete", category: "appliance" },
          { label: "Television and remote", hint: "Powers on, channels tune, remote batteries, cables tidy", category: "av_it" },
          { label: "Desk, chair and mirror", hint: "Wobble, scuffs, chair gas lift holds height", category: "furniture" },
          {
        label: "Chest, nightstands and drawers",
        hint: "Every drawer opens and closes, runners sound, tops and sides unscuffed",
        category: "furniture",
      },
      {
        label: "Cabinet or entertainment unit",
        hint: "Doors aligned and closing, no scuffs, residue or lifting veneer",
        category: "furniture",
      },
      { label: "Luggage rack", hint: "Straps intact, folds and locks open", category: "furniture" },
        ],
      },
      {
        name: "Air conditioning and heating",
        points: [
          { label: "Unit operation", hint: "Reaches set temperature, responds to the control", category: "hvac" },
          { label: "Filter", hint: "Dust visible at the grille, filter clean and refitted", category: "hvac" },
          { label: "Noise and vibration", hint: "Rattles or hums audible from the bed", category: "hvac" },
          { label: "Condensate and staining", hint: "Marks below the unit, damp on the wall", category: "hvac" },
          {
        label: "Vents and grilles",
        hint: "Secure, undented, clean — including any vent in a door or on the outside",
        category: "hvac",
      },
      { label: "Thermostat or control panel", hint: "Display legible, buttons respond, mounted straight", category: "hvac" },
        ],
      },
      {
        name: "Windows and balcony",
        points: [
          { label: "Window operation", hint: "Opens and closes fully, handles firm, locks engage", category: "general" },
          { label: "Window restrictor", hint: "Fitted, engaged and not defeated", category: "fire_safety" },
          { label: "Glazing", hint: "Chips, cracks, blown double glazing, seals", category: "general" },
          { label: "Balcony railing", hint: "No movement at all under firm pressure, fixings sound", category: "fire_safety" },
          { label: "Balcony floor and drainage", hint: "Standing water, lifting tiles, blocked outlet", category: "general" },
          {
        label: "Door and window sensors",
        hint: "Fixed down, aligned with their magnet, reading correctly when the door shuts",
        category: "av_it",
      },
      { label: "Balcony furniture", hint: "Stable, clean, no rust at the joints", category: "furniture" },
        ],
      },
      {
        name: "Finishes",
        points: [
          { label: "Walls", hint: "Scuffs, knocks behind doors and at luggage height, filler showing", category: "painting" },
          { label: "Ceiling", hint: "Water marks, cracks, cobwebs in corners", category: "painting" },
          { label: "Skirting and architrave", hint: "Skirting, architrave and crown moulding — gaps, knocks, mismatched runs, unsealed joints", category: "carpentry" },
          { label: "Flooring", hint: "Lifting edges, stains, squeaks, transition strips", category: "flooring" },
          { label: "Paintwork touch-ups", hint: "Patches that do not match the surrounding sheen or colour, overspray on hinges and hardware", category: "painting" },
        ],
      },
      {
        name: "Safety",
        points: [
          { label: "Smoke detector", hint: "In place, indicator light, not painted over, test date", category: "fire_safety" },
          { label: "Emergency lighting", hint: "Present and working where fitted", category: "fire_safety" },
          { label: "Fire notice and escape plan", hint: "On the door, current, legible", category: "fire_safety" },
          { label: "Sprinkler head", hint: "Unobstructed, clean, nothing hanging from it", category: "fire_safety" },
          { label: "Visible cables and plugs", hint: "No damaged flex, no daisy-chained adaptors", category: "electrical" },
        ],
      },
    ],
  },
  {
    name: "Public area",
    description: "Lobby, corridors, lifts and the front of house a guest walks through.",
    sections: [
      {
        name: "Floors and walls",
        points: [
          { label: "Floor surface", hint: "Trip hazards, lifting edges, stained or worn patches", category: "flooring" },
          { label: "Walls and corners", hint: "Trolley damage at corners, scuffs at handle height", category: "painting" },
          { label: "Skirting and trims", hint: "Loose sections, gaps, missing end caps", category: "carpentry" },
          { label: "Signage", hint: "Straight, clean, current, correctly lit", category: "general" },
        ],
      },
      {
        name: "Lighting and power",
        points: [
          { label: "Light fittings", hint: "Failed lamps, mismatched colour temperature, flicker", category: "lighting" },
          { label: "Emergency lighting", hint: "Indicators lit, no obstruction", category: "fire_safety" },
          { label: "Sockets and covers", hint: "Cracked plates, loose fittings, exposed wiring", category: "electrical" },
        ],
      },
      {
        name: "Lifts and stairs",
        points: [
          { label: "Lift call and levelling", hint: "Stops level with the floor, doors do not judder", category: "lift" },
          { label: "Lift car condition", hint: "Mirror, handrail, floor, certificate in date", category: "lift" },
          { label: "Stair treads and nosings", hint: "Worn nosings, loose treads, missing anti-slip", category: "fire_safety" },
          { label: "Handrails", hint: "Firm along the whole run, no sharp joints", category: "fire_safety" },
        ],
      },
      {
        name: "Comfort and cleanliness",
        points: [
          { label: "Air conditioning in the space", hint: "Temperature, draughts, grille cleanliness", category: "hvac" },
          { label: "Odour", hint: "Drains, damp, bins, cooking carrying from elsewhere", category: "cleaning" },
          { label: "Furniture", hint: "Stability, upholstery marks, worn arms", category: "furniture" },
          { label: "Plants and decor", hint: "Dead leaves, dust on leaves and frames", category: "cleaning" },
          { label: "Bins and ashtrays", hint: "Emptied, clean, lids working", category: "cleaning" },
        ],
      },
      {
        name: "Safety",
        points: [
          { label: "Fire doors", hint: "Close fully onto the latch, seals intact, not wedged", category: "fire_safety" },
          { label: "Extinguishers", hint: "In place, in date, pin and seal intact", category: "fire_safety" },
          { label: "Escape routes", hint: "Clear of furniture, deliveries and storage", category: "fire_safety" },
        ],
      },
    ],
  },
];

/** Creates the starting templates on an empty install. Never overwrites. */
/**
 * Bumped whenever the built-in checklists gain points. An install that is behind
 * gets the new ones added on the next boot; one that is level is left alone.
 */
export const SEED_VERSION = 2;

/**
 * Adds points that a later release decided were missing, to templates that were
 * created by an earlier one.
 *
 * Only ever adds, and only to a section that still exists under its original
 * name. Anything renamed, reordered or removed by hand is somebody's deliberate
 * decision and is left exactly as it is — the version marker means a point that
 * was taken out does not come back on every restart.
 */
export async function topUpTemplates(): Promise<number> {
  const behind = await prisma.inspectionTemplate.findMany({
    where: { seedVersion: { lt: SEED_VERSION } },
    include: { sections: { include: { points: true } } },
  });

  let added = 0;
  for (const template of behind) {
    const source = DEFAULT_TEMPLATES.find((t) => t.name === template.name);
    if (!source) {
      // Not one of ours any more; just mark it so we stop looking at it.
      await prisma.inspectionTemplate.update({ where: { id: template.id }, data: { seedVersion: SEED_VERSION } });
      continue;
    }

    for (const wantedSection of source.sections) {
      const section = template.sections.find((s) => s.name === wantedSection.name);
      if (!section) continue;
      const have = new Set(section.points.map((p) => p.label));
      let position = section.points.reduce((max, p) => Math.max(max, p.position), -1);
      for (const point of wantedSection.points) {
        if (have.has(point.label)) continue;
        await prisma.inspectionPoint.create({
          data: {
            sectionId: section.id,
            label: point.label,
            hint: point.hint ?? null,
            category: point.category ?? null,
            position: ++position,
          },
        });
        added += 1;
      }
    }
    await prisma.inspectionTemplate.update({ where: { id: template.id }, data: { seedVersion: SEED_VERSION } });
  }
  return added;
}

export async function seedTemplates(): Promise<number> {
  const existing = await prisma.inspectionTemplate.count();
  if (existing > 0) return 0;

  for (const [index, template] of DEFAULT_TEMPLATES.entries()) {
    await prisma.inspectionTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        sortOrder: index,
        seedVersion: SEED_VERSION,
        sections: {
          create: template.sections.map((section, sectionIndex) => ({
            name: section.name,
            position: sectionIndex,
            points: {
              create: section.points.map((point, pointIndex) => ({
                label: point.label,
                hint: point.hint ?? null,
                category: point.category ?? null,
                position: pointIndex,
              })),
            },
          })),
        },
      },
    });
  }
  return DEFAULT_TEMPLATES.length;
}

/** How many points a template holds, which is what the picker wants to show. */
export function countPoints(template: { sections: { points: unknown[] }[] }): number {
  return template.sections.reduce((sum, section) => sum + section.points.length, 0);
}
