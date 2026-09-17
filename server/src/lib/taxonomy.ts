import { prisma } from "../db";
import { ValidationError } from "./validation";

/**
 * The trades work is sorted into. Fixed in code rather than a table: they drive the
 * technician suggestion, and a stable set keeps that predictable.
 */
export const CATEGORIES = [
  { key: "plumbing", label: "Plumbing" },
  { key: "electrical", label: "Electrical" },
  { key: "hvac", label: "HVAC / air conditioning" },
  { key: "appliance", label: "Appliances" },
  { key: "kitchen", label: "Kitchen equipment" },
  { key: "laundry", label: "Laundry" },
  { key: "carpentry", label: "Carpentry / joinery" },
  { key: "painting", label: "Painting / decorating" },
  { key: "flooring", label: "Flooring" },
  { key: "doors_locks", label: "Doors, locks & keys" },
  { key: "furniture", label: "Furniture & fittings" },
  { key: "lighting", label: "Lighting" },
  { key: "av_it", label: "TV, AV & IT" },
  { key: "pool_spa", label: "Pool & spa" },
  { key: "grounds", label: "Grounds & exterior" },
  { key: "cleaning", label: "Cleaning / housekeeping" },
  { key: "pest_control", label: "Pest control" },
  { key: "fire_safety", label: "Fire & safety" },
  { key: "lift", label: "Lifts" },
  { key: "general", label: "General maintenance" },
] as const;

export const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

export function categoryLabel(key: string | null | undefined): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? "";
}

export function parseCategory(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !CATEGORY_KEYS.has(value as any)) throw new ValidationError("unknown category");
  return value;
}

export function parseCategoryList(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("categories must be a list");
  const keys = [...new Set(value.map(String))];
  for (const key of keys) if (!CATEGORY_KEYS.has(key as any)) throw new ValidationError(`unknown category: ${key}`);
  return JSON.stringify(keys);
}

export function parseStoredList(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The tags most hotel and tourism work falls under; created once, then editable. */
export const DEFAULT_TAGS = [
  { name: "Room improvement", color: "#2563eb" },
  { name: "Room check", color: "#0891b2" },
  { name: "Equipment check", color: "#7c3aed" },
  { name: "Servicing", color: "#16a34a" },
  { name: "Audit", color: "#a16207" },
  { name: "Inspection", color: "#ca8a04" },
  { name: "Arrival room", color: "#db2777" },
  { name: "Vacant room", color: "#64748b" },
  { name: "Out of order room", color: "#dc2626" },
  { name: "Guest complaint", color: "#ea580c" },
  { name: "Deep clean", color: "#0d9488" },
  { name: "Preventive", color: "#4f46e5" },
];

export async function seedTags(): Promise<number> {
  const existing = await prisma.tag.count();
  if (existing > 0) return 0;
  await prisma.tag.createMany({ data: DEFAULT_TAGS.map((tag, i) => ({ ...tag, sortOrder: i })) });
  return DEFAULT_TAGS.length;
}

/** Validates a list of tag ids and returns the ones that exist. */
export async function resolveTagIds(value: unknown): Promise<string[] | undefined> {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("tagIds must be a list");
  const ids = [...new Set(value.map(String))].filter(Boolean);
  if (ids.length === 0) return [];
  const found = await prisma.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new ValidationError("one or more tags no longer exist");
  return found.map((t) => t.id);
}

/** Replaces an issue's tags with exactly this set. */
export async function setIssueTags(issueId: string, tagIds: string[]): Promise<void> {
  await prisma.issueTag.deleteMany({ where: { issueId } });
  if (tagIds.length) await prisma.issueTag.createMany({ data: tagIds.map((tagId) => ({ issueId, tagId })) });
}
