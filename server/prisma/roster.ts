/**
 * The maintenance crew, taken from the printed weekly schedule.
 *
 * Shifts here are the pattern typical of each role on that sheet, not a per-person
 * transcription — the photo's rows don't line up reliably enough to trust 53 × 7 cells.
 * Treat them as a starting point: every one is editable on the Technicians page, and
 * re-running this seed never overwrites a technician who already exists.
 */

import type { Shift } from "../src/lib/shifts";

type Week = (Shift | null)[]; // Monday first

const at = (start: string, end: string): Shift => ({ start, end });

/** Monday–Friday on, weekend off. */
const weekdays = (start: string, end: string): Week => [at(start, end), at(start, end), at(start, end), at(start, end), at(start, end), null, null];
/** Six days on, Sunday off — how most of the trades run on the sheet. */
const sixDays = (start: string, end: string): Week => [at(start, end), at(start, end), at(start, end), at(start, end), at(start, end), at(start, end), null];
/** Seven days, which is how the shift cover works. */
const everyDay = (start: string, end: string): Week => Array.from({ length: 7 }, () => at(start, end));

export interface RosterEntry {
  name: string;
  trade: string;
  /** Work categories they cover, which is what drives the assignment suggestion. */
  categories: string[];
  week: Week;
  /** Their patch, where the sheet names one. */
  notes?: string;
}

export const ROSTER: RosterEntry[] = [
  // ---- Administration -----------------------------------------------------
  // On the sheet as ON/OFF rather than hours; given office hours here.
  { name: "Lewis Crosbie", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Dean Alphonse", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Cyril Popo", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Emmanuel Mercier", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Wilson Ragwanan", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Arthur Edward", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },
  { name: "Deirdre Avril", trade: "Administration", categories: [], week: weekdays("07:00", "16:00") },
  { name: "Donavan Moise", trade: "Administration", categories: [], week: weekdays("13:00", "22:00") },
  { name: "Keitha Nicholson", trade: "Administration", categories: [], week: weekdays("08:00", "17:00") },

  // ---- Room technicians ---------------------------------------------------
  { name: "Owen Theophilus", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Tennis Courts" },
  { name: "Samuel Seraphin", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Points & B2P" },
  { name: "Cleus St. Catherine", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "T & Tower Block" },
  { name: "Bradley Ashby", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Ronderval" },
  { name: "Miguel Ambrose", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Blue Suites / WE" },
  { name: "Abraham Mentor", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Coubaril Block" },
  { name: "Dhardyll Jeffers", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "PQ&R Block" },
  { name: "Sherdan Vital", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("14:00", "23:00"), notes: "Relief room technician" },
  { name: "Jonathan Octave", trade: "Room Technician", categories: ["general", "furniture", "doors_locks", "appliance"], week: sixDays("08:00", "17:00"), notes: "Relief room technician" },

  // ---- AC -----------------------------------------------------------------
  { name: "Erneil Simmons", trade: "AC Technician", categories: ["hvac"], week: sixDays("08:00", "17:00") },
  { name: "Darren Charlemagne", trade: "AC Technician", categories: ["hvac"], week: sixDays("07:00", "16:00") },
  { name: "Avitus Joseph", trade: "AC Technician", categories: ["hvac"], week: sixDays("08:00", "17:00") },
  { name: "Russel Cherubin", trade: "AC Service Technician", categories: ["hvac"], week: sixDays("08:00", "17:00") },
  { name: "Shamoir Jn. Baptiste", trade: "AC Service Technician", categories: ["hvac"], week: sixDays("08:00", "17:00") },
  { name: "Calvin Duplessis", trade: "AC Service Technician", categories: ["hvac"], week: sixDays("08:00", "17:00") },
  { name: "Daniel Dujon", trade: "AC Service Assistant", categories: ["hvac"], week: sixDays("08:00", "17:00") },

  // ---- Plumbing -----------------------------------------------------------
  { name: "Wally Mathurin", trade: "Plumber", categories: ["plumbing"], week: sixDays("08:00", "17:00") },
  { name: "Sujae Hollincide", trade: "Plumber", categories: ["plumbing"], week: sixDays("08:00", "17:00") },

  // ---- Painting -----------------------------------------------------------
  { name: "Benjamin Gabriel", trade: "Painter", categories: ["painting"], week: weekdays("07:00", "16:00"), notes: "Blue Suites / w Edge" },
  { name: "Fitzroy Marius", trade: "Painter", categories: ["painting"], week: weekdays("07:00", "16:00"), notes: "T & Tower" },
  { name: "Godfrey Alfred", trade: "Painter", categories: ["painting"], week: weekdays("07:00", "16:00"), notes: "Tennis Courts" },
  { name: "Jeaniel Griffin", trade: "Painter", categories: ["painting"], week: weekdays("07:00", "16:00"), notes: "Points / B2P 822-823" },
  { name: "Neil Lubin", trade: "Painter", categories: ["painting"], week: weekdays("08:00", "17:00"), notes: "Coubaril 820-821" },
  { name: "Russell Joseph", trade: "Painter", categories: ["painting"], week: weekdays("06:00", "15:00"), notes: "PQ&R" },
  { name: "Emmanuel Clermont", trade: "Painter", categories: ["painting"], week: weekdays("07:00", "16:00"), notes: "Public area" },
  { name: "Jesery Jn. Philip", trade: "Painter", categories: ["painting"], week: weekdays("08:00", "17:00"), notes: "Public area" },
  { name: "Norman Loctar", trade: "Painter", categories: ["painting"], week: weekdays("08:00", "17:00"), notes: "Relief painter" },
  { name: "Ian Augustin", trade: "Painter", categories: ["painting"], week: weekdays("08:00", "17:00"), notes: "Rondervals" },

  // ---- Gas ----------------------------------------------------------------
  { name: "Imron Joseph", trade: "Gas Technician", categories: ["kitchen", "general"], week: weekdays("07:00", "16:00") },

  // ---- Carpentry ----------------------------------------------------------
  { name: "John Bernadine", trade: "Carpenter", categories: ["carpentry", "furniture", "doors_locks"], week: sixDays("09:00", "18:00") },
  { name: "Kenius Evans", trade: "Carpenter", categories: ["carpentry", "furniture", "doors_locks"], week: weekdays("07:00", "16:00") },
  { name: "Samuel Donnelly", trade: "Carpenter", categories: ["carpentry", "furniture", "doors_locks"], week: weekdays("07:00", "16:00") },

  // ---- Masonry ------------------------------------------------------------
  { name: "Anthony Pologne", trade: "Mason", categories: ["general", "flooring"], week: weekdays("05:00", "14:00") },
  { name: "Kenvin Hippolyte", trade: "Mason", categories: ["general", "flooring"], week: weekdays("08:00", "17:00") },

  // ---- Electrical ---------------------------------------------------------
  { name: "Benedict Edward", trade: "Electrician", categories: ["electrical", "lighting"], week: weekdays("07:00", "16:00") },
  { name: "Glenn Louis", trade: "Electrician", categories: ["electrical", "lighting"], week: weekdays("15:00", "00:00"), notes: "Rondervals" },
  { name: "Kermaki Matty", trade: "Electrician", categories: ["electrical", "lighting"], week: weekdays("08:00", "17:00") },

  // ---- Shift cover --------------------------------------------------------
  { name: "Juni Jean", trade: "Shift Technician", categories: ["general", "electrical", "plumbing", "hvac"], week: everyDay("15:00", "00:00"), notes: "Evening technician" },
  { name: "Naeem White", trade: "Shift Technician", categories: ["general", "electrical", "plumbing", "hvac"], week: everyDay("22:00", "07:00"), notes: "Night technician" },
  { name: "Ezekiel Jn Baptiste", trade: "Shift Technician", categories: ["general", "electrical", "plumbing", "hvac"], week: everyDay("22:00", "07:00"), notes: "Shift technician" },

  // ---- Plant and services -------------------------------------------------
  { name: "Winston Janvier", trade: "Grease Trap Operator", categories: ["general", "cleaning"], week: sixDays("08:00", "17:00") },
  { name: "Miguel Arthur", trade: "Handyman", categories: ["general", "carpentry", "furniture"], week: sixDays("08:00", "17:00") },
  { name: "Shaun Cruz", trade: "Sewer Plant Operator", categories: ["general", "plumbing"], week: sixDays("07:00", "16:00") },
  { name: "Garfield Dulis", trade: "Laundry Technician", categories: ["laundry"], week: sixDays("07:00", "16:00") },
  { name: "Tarric John", trade: "Laundry Technician", categories: ["laundry"], week: sixDays("07:00", "16:00") },
];

/** A colour per trade, so the boards and the day view read at a glance. */
export const TRADE_COLORS: Record<string, string> = {
  Administration: "#64748b",
  "Room Technician": "#2563eb",
  "AC Technician": "#0891b2",
  "AC Service Technician": "#0891b2",
  "AC Service Assistant": "#22d3ee",
  Plumber: "#0ea5e9",
  Painter: "#7c3aed",
  "Gas Technician": "#ea580c",
  Carpenter: "#a16207",
  Mason: "#78716c",
  Electrician: "#eab308",
  "Shift Technician": "#4f46e5",
  "Grease Trap Operator": "#16a34a",
  Handyman: "#059669",
  "Sewer Plant Operator": "#0d9488",
  "Laundry Technician": "#db2777",
};
