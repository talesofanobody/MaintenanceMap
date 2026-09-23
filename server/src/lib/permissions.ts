/**
 * Who can do what.
 *
 * This used to be sixty `ADMIN_ONLY` guards spread over sixteen route files,
 * which is fine for one privileged role and impossible to review for four. The
 * question "what can a dispatcher actually do?" should be answerable by reading
 * one table, not by grepping.
 *
 * So routes name a capability and the table below decides. Adding a role means
 * adding a row. Changing what a role may do means changing one line, and the
 * change is visible in a diff.
 */

export const ROLES = ["admin", "manager", "dispatcher", "technician", "display"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
  display: "Display",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, including logins, restoring a backup and deleting anything.",
  manager: "Runs the operation day to day. Cannot delete records, manage logins, or restore a backup.",
  dispatcher: "Gets work to the right person: logs issues, assigns and schedules them, triages what guests send in.",
  technician: "Their own work, and walking inspections.",
  display: "A screen on a wall. Dashboards only, no access to anything else.",
};

export const CAPABILITIES = [
  // Work
  "issue.write",
  "issue.delete",
  "issue.assign",
  "time.adjust",
  // Inspections
  "inspection.run",
  "inspection.amend",
  "inspection.raise",
  "inspection.delete",
  "template.write",
  "project.write",
  "project.delete",
  // The estate
  "property.write",
  "property.delete",
  "tag.write",
  "tag.delete",
  "contractor.write",
  "contractor.delete",
  "schedule.write",
  "schedule.delete",
  // People
  "technician.write",
  "technician.delete",
  "timeoff.write",
  "timeoff.delete",
  "user.manage",
  // What guests send in
  "request.review",
  "request.delete",
  // Seeing and taking data out
  "insights.view",
  "export.view",
  "activity.view",
  "settings.write",
  "backup.manage",
  "backup.delete",
  "backup.restore",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Everything a technician can do, which every role above them also can. */
const TECHNICIAN: Capability[] = ["issue.write", "inspection.run", "inspection.amend"];

/**
 * A dispatcher's job is getting the right person to the right room. They log and
 * assign work and triage what guests send in. They do not shape the estate, hire
 * anybody, or delete a thing.
 */
const DISPATCHER: Capability[] = [...TECHNICIAN, "issue.assign", "request.review", "inspection.raise"];

/**
 * A manager runs the operation. Everything except the things you cannot take
 * back: no deleting records, no restoring over the database.
 *
 * They also cannot manage logins — not because creating a user is dangerous in
 * itself, but because anyone who can create an admin can make themselves one,
 * and a role defined as "one step below admin" that can promote itself is not a
 * step below anything.
 */
const MANAGER: Capability[] = [
  ...DISPATCHER,
  "time.adjust",
  "template.write",
  "project.write",
  "property.write",
  "tag.write",
  "contractor.write",
  "schedule.write",
  "technician.write",
  "timeoff.write",
  "insights.view",
  "export.view",
  "activity.view",
  "settings.write",
  "backup.manage",
];

const MATRIX: Record<Role, Capability[] | "everything"> = {
  admin: "everything",
  manager: MANAGER,
  dispatcher: DISPATCHER,
  technician: TECHNICIAN,
  display: [],
};

export function can(role: Role | string | undefined, capability: Capability): boolean {
  if (!role) return false;
  const allowed = MATRIX[role as Role];
  if (!allowed) return false;
  if (allowed === "everything") return true;
  return allowed.includes(capability);
}

/** Every capability a role holds, for telling the client what to show. */
export function capabilitiesOf(role: Role | string | undefined): Capability[] {
  if (!role) return [];
  const allowed = MATRIX[role as Role];
  if (!allowed) return [];
  return allowed === "everything" ? [...CAPABILITIES] : [...allowed];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
