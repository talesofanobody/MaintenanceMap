export type Priority = "low" | "medium" | "high" | "urgent" | "critical";
/** "pending" reads as Requested everywhere a person sees it. */
export type Status = "pending" | "accepted" | "in_progress" | "on_hold" | "needs_parts" | "completed" | "cancelled";
export type TimeOffKind = "vacation" | "sick" | "training" | "other";

export interface Photo {
  id: string;
  /** Null while the photo still belongs to a guest report that hasn't been accepted. */
  issueId: string | null;
  filename: string;
  thumbFilename: string | null;
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  /** "exif" when the camera recorded it, "device" when the phone's GPS stood in. */
  gpsSource: "exif" | "device" | null;
  takenAt: string | null;
  createdAt: string;
}

export type Role = "admin" | "manager" | "dispatcher" | "technician" | "display";

export const ROLES: Role[] = ["admin", "manager", "dispatcher", "technician", "display"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Team member",
  display: "Display",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, including logins, restoring a backup and deleting anything.",
  manager: "Runs the operation day to day. Makes logins for the roles below them. Cannot delete records or restore a backup.",
  dispatcher: "Gets work to the right person: logs issues, assigns and schedules them, triages what guests send in.",
  technician: "Their own work, and walking inspections.",
  display: "A screen on a wall. Dashboards only.",
};

/**
 * What a login may do. The server sends this with the session and checks it on
 * every route regardless — this copy only decides what is worth showing.
 */
export type Capability = string;

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  /** What this login may do, from the server's own table. */
  capabilities?: Capability[];
  technicianId: string | null;
  technician: TechnicianRef | null;
  mustChangePassword: boolean;
}

export interface AppUser extends AuthUser {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  userId: string | null;
  username: string;
  action: string;
  entityType: string;
  entityId: string;
  propertyId: string | null;
  issueId: string | null;
  summary: string;
  details: string | null;
}

export type NotificationKind =
  | "assigned"
  | "new_issue"
  | "status"
  | "priority"
  | "starts_today"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "unassigned"
  | "message"
  | "guest_report";

export interface AppNotification {
  id: string;
  at: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  issueId: string | null;
  propertyId: string | null;
  readAt: string | null;
}

export interface AppSettings {
  /** Hours allowed to resolve each priority, counted from when it was logged. */
  responseHours: Record<Priority, number>;
  warnAtPercent: number;
  escalation: { enabled: boolean; afterOverdueHours: number };
}

export interface ChecklistItem {
  id: string;
  issueId: string;
  text: string;
  position: number;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}

export type ScheduleUnit = "days" | "weeks" | "months";

export interface Schedule {
  id: string;
  propertyId: string;
  title: string;
  description: string | null;
  actionNeeded: string | null;
  priority: Priority;
  technicianId: string | null;
  technician: { id: string; name: string; color: string } | null;
  estimatedHours: number | null;
  lat: number;
  lng: number;
  every: number;
  unit: ScheduleUnit;
  leadDays: number;
  nextDue: string;
  checklist: string[];
  active: boolean;
  lastCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: { id: string; name: string };
  issues: { id: string; title: string; status: Status; dueDate: string | null }[];
}

export interface ScheduleInput {
  propertyId?: string;
  title: string;
  description?: string | null;
  actionNeeded?: string | null;
  priority: Priority;
  technicianId?: string | null;
  estimatedHours?: number | null;
  lat?: number;
  lng?: number;
  every: number;
  unit: ScheduleUnit;
  leadDays: number;
  nextDue: string;
  checklist: string[];
  active?: boolean;
}

export type CostKind = "parts" | "contractor" | "hire" | "other";

export const COST_KIND_LABELS: Record<CostKind, string> = {
  parts: "Parts / materials",
  contractor: "Contractor invoice",
  hire: "Hire / plant",
  other: "Other",
};

export interface Contractor {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  totalSpend?: number;
  _count?: { costs: number };
}

export interface Cost {
  id: string;
  issueId: string;
  kind: CostKind;
  description: string;
  amount: number;
  quantity: number;
  contractorId: string | null;
  contractor: { id: string; name: string } | null;
  invoiceRef: string | null;
  incurredOn: string;
  createdBy: string | null;
  createdAt: string;
}

export interface CostSummary {
  recorded: number;
  labour: number;
  labourHours: number;
  total: number;
}

export interface PlanStop {
  issue: DashboardIssue;
  hours: number;
  assumedHours: boolean;
  travelMetres: number;
  reason: string;
}

export interface DayPlan {
  day: string;
  technicianId: string;
  capacityHours: number;
  plannedHours: number;
  stops: PlanStop[];
  leftOver: { issue: DashboardIssue; hours: number; reason: string }[];
}

export interface Trends {
  months: { month: string; logged: number; closed: number; spend: number; avgResolveDays: number | null }[];
  openByPriority: Record<Priority, number>;
  openTotal: number;
  overdueTotal: number;
  byProperty: { id: string; name: string; open: number; overdue: number; closed: number; spend: number }[];
  byTechnician: { name: string; color: string; open: number; closed: number; avgResolveDays: number | null }[];
  byContractor: { name: string; spend: number }[];
}

export interface PortfolioProperty {
  id: string;
  name: string;
  address: string | null;
  openTotal: number;
  closedTotal: number;
  byPriority: Record<Priority, number>;
  overdue: number;
  spend: number;
  avgResolveDays: number | null;
  nextScheduled: { title: string; nextDue: string } | null;
  attention: { id: string; title: string; priority: Priority; dueDate: string | null; technician: string | null }[];
}

export interface Portfolio {
  generatedAt: string;
  today: string;
  properties: PortfolioProperty[];
}

export interface CalendarFeed {
  token: string;
  path: string;
}

export interface RestoreResult {
  restored: string;
  photoCount: number;
  issues: number;
  safetyCopy: string;
  message: string;
}

export interface RestoreResult {
  restored: string;
  photoCount: number;
  issues: number;
  safetyCopy: string;
  message: string;
}

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
  includesPhotos: boolean;
  /** Why it was taken: nightly, or because something was about to change. */
  kind: "daily" | "before-update" | "before-restore";
}

export interface Category {
  key: string;
  label: string;
}

/** Mirrors the server list so labels render without waiting for a fetch. */
export const CATEGORIES: Category[] = [
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
  // Keep in step with server/src/lib/taxonomy.ts — the server validates
  // against its own copy, so a key only here would be rejected on save.
  { key: "admin_office", label: "Administration / office" },
];

export function categoryLabel(key: string | null | undefined): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? "";
}

/** Short form for boards and cards, where the full label is too long. */
export function categoryShort(key: string | null | undefined): string {
  const label = categoryLabel(key);
  return label.split(" / ")[0].split(",")[0];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  active: boolean;
  _count?: { issues: number };
}

export interface IssueTag {
  tagId: string;
  tag: Tag;
}

export interface Shift {
  start: string;
  end: string;
}

export type Week = (Shift | null)[];

export interface RotaDay {
  day: string;
  shift: Shift | null;
  hours: number;
  bookedHours: number;
  jobs: { id: string; title: string; priority: Priority; estimatedHours: number | null; scheduledFor: string | null; roomName: string | null; category: string | null; property: string }[];
}

export interface RotaRow {
  id: string;
  name: string;
  trade: string | null;
  color: string;
  categories: string[];
  days: RotaDay[];
  weekHours: number;
}

export interface Rota {
  weekStart: string;
  days: string[];
  technicians: RotaRow[];
  generatedAt: string;
}

export interface Message {
  id: string;
  issueId: string;
  userId: string | null;
  authorName: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
}

export interface TechnicianRef {
  id: string;
  name: string;
  color: string;
  trade: string | null;
}

export interface Assignment {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  estimatedHours: number | null;
  actualHours: number | null;
  scheduledFor: string | null;
  dueDate: string | null;
  propertyId: string;
}

export interface Technician extends TechnicianRef {
  shifts: Week;
  categories: string[];
  hourlyRate: number | null;
  phone: string | null;
  active: boolean;
  weeklyHours: number[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  assignments: Assignment[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface Issue {
  id: string;
  propertyId: string;
  category: string | null;
  roomName: string | null;
  tags?: IssueTag[];
  messages?: Message[];
  /** Present when the issue was accepted from a guest report. */
  guestReport?: IssueOrigin | null;
  /** Everyone on the job, lead first. */
  assignees?: IssueAssignee[];
  /** The moment it is due — what a two-hour job is actually judged on. */
  dueAt?: string | null;
  dayOrder?: number | null;
  isEmergency?: boolean;
  shiftedBy?: string | null;
  scheduleId?: string | null;
  checklist?: ChecklistItem[];
  costs?: Cost[];
  title: string;
  description: string | null;
  actionNeeded: string | null;
  priority: Priority;
  status: Status;
  workOrderCreated: boolean;
  workOrderNumber: string | null;
  workOrderUrl: string | null;
  lat: number;
  lng: number;
  closedAt: string | null;
  technicianId: string | null;
  technician: TechnicianRef | null;
  estimatedHours: number | null;
  actualHours: number | null;
  scheduledFor: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  photos: Photo[];
}

export interface DashboardIssue extends Omit<Issue, "photos" | "checklist"> {
  property: { id: string; name: string };
  photos: { id: string }[];
  checklist?: { done: boolean }[];
}

export interface ActiveEntry {
  id: string;
  issueId: string;
  technicianId: string;
  startedAt: string;
}

export interface DashboardData {
  generatedAt: string;
  properties: Pick<Property, "id" | "name" | "address" | "boundary" | "centerLat" | "centerLng">[];
  technicians: Omit<Technician, "assignments">[];
  issues: DashboardIssue[];
  activeEntries: ActiveEntry[];
}

export interface TimeEntry {
  id: string;
  issueId: string;
  technicianId: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  technician: { id: string; name: string; color: string };
  issue: { id: string; title: string; propertyId: string; status: Status; priority: Priority; property: { name: string } };
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Property {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  boundary: GeoJSONPolygon | null;
  centerLat: number | null;
  centerLng: number | null;
  createdAt: string;
  updatedAt: string;
  /** Guest reporting: whether the public link works, and the secret in it (admins only). */
  intakeEnabled?: boolean;
  intakeToken?: string | null;
  issues?: Issue[];
  _count?: { issues: number };
}

/** The report an issue came from, carried on the issue so its origin survives. */
export interface IssueOrigin {
  id: string;
  roomName: string;
  createdAt: string;
  reviewedBy: string | null;
}

export type GuestReportStatus = "pending" | "accepted" | "declined";

/** Something reported through a property's public link by someone with no login. */
export interface GuestReport {
  id: string;
  propertyId: string;
  roomName: string;
  category: string | null;
  description: string;
  status: GuestReportStatus;
  lat: number | null;
  lng: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  issueId: string | null;
  createdAt: string;
  photos: Photo[];
  property: { id: string; name: string; centerLat: number | null; centerLng: number | null };
  issue: { id: string; title: string; status: Status; priority: Priority } | null;
}

export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent", "critical"];
export const STATUSES: Status[] = ["pending", "accepted", "in_progress", "on_hold", "needs_parts", "completed", "cancelled"];
/** Still someone's problem — everything that is not finished or called off. */
export const OPEN_STATUSES: Status[] = ["pending", "accepted", "in_progress", "on_hold", "needs_parts"];
export const CLOSED_STATUSES: Status[] = ["completed", "cancelled"];

export function isOpenStatus(status: Status | string): boolean {
  return (OPEN_STATUSES as string[]).includes(status);
}
export function isClosedStatus(status: Status | string): boolean {
  return (CLOSED_STATUSES as string[]).includes(status);
}

/** A job can have a lead and three other pairs of hands. */
export const MAX_ASSIGNEES = 4;

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#16a34a",
  medium: "#eab308",
  high: "#f97316",
  urgent: "#dc2626",
  critical: "#7f1d1d",
};

export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  low: "Cosmetic or minor — schedule when convenient",
  medium: "Needs attention — plan within the month",
  high: "Deteriorating or affecting use — act soon",
  urgent: "Needs someone within hours, not days",
  critical: "Drop everything — unsafe, flooding or a room out of service",
};

export const STATUS_LABELS: Record<Status, string> = {
  pending: "Requested",
  accepted: "Accepted",
  in_progress: "In Progress",
  on_hold: "On Hold",
  needs_parts: "Needs Parts",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_SHORT_LABELS: Record<Status, string> = {
  pending: "Requested",
  accepted: "Accepted",
  in_progress: "Working",
  on_hold: "On hold",
  needs_parts: "Parts",
  completed: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  critical: "Critical",
};

export const PRIORITY_SHORT_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  critical: "Critical",
};

export const TIME_OFF_LABELS: Record<TimeOffKind, string> = {
  vacation: "Vacation",
  sick: "Sick leave",
  training: "Training",
  other: "Away",
};

export interface TimeOff {
  id: string;
  technicianId: string;
  startDay: string;
  endDay: string;
  kind: TimeOffKind;
  note: string | null;
  createdAt: string;
  technician: TechnicianRef;
}

export interface IssueAssignee {
  id: string;
  issueId: string;
  technicianId: string;
  createdAt: string;
  technician: TechnicianRef;
}

/** One technician's day on the scheduler board. */
export interface ScheduleRow {
  id: string;
  name: string;
  trade: string | null;
  color: string;
  categories: string[];
  shift: Shift | null;
  timeOff: { kind: TimeOffKind; note: string | null; startDay: string; endDay: string } | null;
  capacityHours: number;
  bookedHours: number;
  freeHours: number;
  jobs: ScheduledJob[];
}

export interface ScheduledJob {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  category: string | null;
  roomName: string | null;
  estimatedHours: number | null;
  dayOrder: number | null;
  isEmergency: boolean;
  shiftedBy: string | null;
  dueAt: string | null;
  dueDate: string | null;
  scheduledFor: string | null;
  technicianId: string | null;
  lat: number;
  lng: number;
  property: string;
  propertyId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  hours: number;
  overrunsShift?: boolean;
}

export interface DaySchedule {
  day: string;
  technicians: ScheduleRow[];
  unassigned: ScheduledJob[];
  generatedAt: string;
}

/** Where a technician probably is, worked out from their clock-ins. */
export interface TechnicianLocation {
  id: string;
  name: string;
  trade: string | null;
  color: string;
  timeOff: { kind: TimeOffKind } | null;
  state: "working" | "last_seen" | "away" | "unknown";
  lat: number | null;
  lng: number | null;
  issue: { id: string; title: string; roomName: string | null; property: string; propertyId: string } | null;
  since: string | null;
  ageMinutes: number | null;
}

// ---------------------------------------------------------------------------
// Inspections
//
// Kept together at the end of the file, and depending on nothing above it but
// Photo and the category helpers, so the whole domain can move out with its
// pages when it becomes an app of its own.
// ---------------------------------------------------------------------------

export type Outcome = "ok" | "flagged" | "na";
export type Severity = "minor" | "moderate" | "major";
export type InspectionStatus = "in_progress" | "completed" | "abandoned";
export type ProjectStatus = "planning" | "open" | "on_hold" | "done" | "cancelled";

export const OUTCOMES: Outcome[] = ["ok", "flagged", "na"];
export const SEVERITIES: Severity[] = ["minor", "moderate", "major"];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ok: "Fine",
  flagged: "Flag it",
  na: "N/A",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
};

/** What each severity becomes when the finding is raised as work. */
export const SEVERITY_PRIORITY: Record<Severity, Priority> = {
  minor: "low",
  moderate: "medium",
  major: "high",
};

export interface InspectionPoint {
  id: string;
  sectionId: string;
  label: string;
  hint: string | null;
  category: string | null;
  position: number;
  /** Set where this point wants a number rather than a judgement. */
  unit: string | null;
  minOk: number | null;
  maxOk: number | null;
}

export interface InspectionSection {
  id: string;
  templateId: string;
  name: string;
  position: number;
  points: InspectionPoint[];
}

export interface InspectionTemplate {
  id: string;
  name: string;
  description: string | null;
  /** "checklist" walks a fixed list; "general" is blank slots to fill in. */
  kind?: "checklist" | "general";
  /** What to suggest in the empty area field for this type of walk. */
  areaHint?: string | null;
  propertyId: string | null;
  active: boolean;
  sortOrder: number;
  sections: InspectionSection[];
  pointCount: number;
}

export interface InspectionCheck {
  id: string;
  inspectionId: string;
  pointId: string | null;
  section: string;
  label: string;
  hint: string | null;
  category: string | null;
  outcome: Outcome;
  severity: Severity | null;
  note: string | null;
  /** Where this one finding is, on a general walk. */
  area?: string | null;
  position: number;
  issueId: string | null;
  /** Photos move to the issue when a finding is raised, so the report reads them back from it. */
  issue: { id: string; title: string; status: Status; priority: Priority; projectId: string | null; photos: Photo[] } | null;
  photos: Photo[];
  createdAt: string;
  /** The number that was read. Null means nobody took one, which is not zero. */
  value: number | null;
  /** What the point expected, snapshotted at the time of the walk. */
  unit: string | null;
  minOk: number | null;
  maxOk: number | null;
}

export interface Inspection {
  id: string;
  propertyId: string;
  templateId: string | null;
  templateName: string;
  roomName: string;
  status: InspectionStatus;
  /** The login that typed it in. */
  inspectorId: string | null;
  /** Who actually walked the room. */
  technicianId: string | null;
  technician: TechnicianRef | null;
  inspector: string;
  /** Where the walk was, from the phone, when a photo could not say. */
  lat: number | null;
  lng: number | null;
  notes: string | null;
  /** Set once the walk is closed off as a record and its loose photos released. */
  archivedAt?: string | null;
  /** The frozen record, as JSON, once archived. */
  summary?: string | null;
  startedAt: string;
  completedAt: string | null;
  /** Set once a finished walk has been reopened to correct something. */
  amendedAt: string | null;
  property: { id: string; name: string };
  checks: InspectionCheck[];
}

/** The list view carries counts instead of every line. */
export interface InspectionSummary extends Omit<Inspection, "checks"> {
  counts: { total: number; ok: number; flagged: number; na: number; raised: number };
}

/** Many rooms on one sheet. Nothing is stored — this is assembled for printing. */
export interface InspectionReport {
  inspections: Inspection[];
  totals: {
    rooms: number;
    roomsWithFindings: number;
    points: number;
    ok: number;
    na: number;
    flagged: number;
    major: number;
    moderate: number;
    minor: number;
    raised: number;
    photos: number;
  };
}

export interface ProjectIssue {
  id: string;
  propertyId: string;
  title: string;
  status: Status;
  priority: Priority;
  roomName: string | null;
  category: string | null;
  dueAt: string | null;
  technician: TechnicianRef | null;
  /** Work breakdown. A parent is an ordinary issue that has children. */
  parentId: string | null;
  isMilestone: boolean;
  scheduledFor: string | null;
  dueDate: string | null;
  /** The plan as agreed, kept apart from the dates above so slippage stays visible. */
  baselineStart: string | null;
  baselineDue: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  /** The EAM remains the record of work orders; this app plans and feeds it. */
  workOrderNumber: string | null;
  workOrderUrl: string | null;
  closedAt: string | null;
  /** How far along, 0–100. Null means nobody has said, which is not zero. */
  percentComplete: number | null;
  /**
   * What the tree says about this item, as opposed to what is stored on it. A
   * parent's dates and progress come from its children; a leaf's are its own.
   */
  rolled: {
    start: string | null;
    end: string | null;
    percentComplete: number | null;
    isSummary: boolean;
    /** Tasks beneath that are still open — what stops this being finished. */
    openBeneath: number;
  };
  costs: { amount: number; quantity: number }[];
  blockers: { id: string; summary: string; kind: BlockerKind; raisedAt: string; clearedAt: string | null }[];
  linksOut: { id: string; toIssueId: string; kind: LinkKind; lagDays: number | null }[];
}

export type QuoteStatus = "requested" | "received" | "declined" | "awarded";

export interface Quote {
  id: string;
  issueId: string | null;
  projectId: string | null;
  contractorId: string;
  contractor: { id: string; name: string; trade: string | null; phone?: string | null; email?: string | null };
  amount: number | null;
  status: QuoteStatus;
  reference: string | null;
  notes: string | null;
  requestedAt: string;
  receivedAt: string | null;
  awardedAt: string | null;
  decidedBy: string | null;
}

/** The three-quote rule, as a countable fact rather than a recollection. */
export interface QuoteState {
  total: number;
  received: number;
  awarded: number;
  satisfied: boolean;
  outstanding: number;
}

export interface ProjectRollup {
  total: number;
  /** Items that are nobody's parent — the ones that represent actual work. */
  leaves: number;
  open: number;
  done: number;
  milestones: number;
  milestonesHit: number;
  /** Per cent complete over leaves only, so nesting cannot inflate it. */
  progress: number;
  estimatedHours: number;
  actualHours: number;
  actualCost: number;
}

export interface ProjectBudget {
  approved: number | null;
  /** Awarded quotes — promised to somebody, not necessarily spent yet. */
  committed: number;
  actual: number;
  /** Approved less the larger of committed and actual, never their sum. */
  remaining: number | null;
  overBudget: boolean;
}

export interface ProjectSchedule {
  plannedStart: string | null;
  plannedEnd: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  /** Positive means the end has moved later than what was agreed. */
  slippageDays: number | null;
  baselined: boolean;
}

export type BlockerKind = "parts" | "approval" | "access" | "contractor" | "information" | "weather" | "budget" | "other";

export const BLOCKER_KIND_LABELS: Record<BlockerKind, string> = {
  parts: "Parts",
  approval: "Approval",
  access: "Access",
  contractor: "Contractor",
  information: "Information",
  weather: "Weather",
  budget: "Budget",
  other: "Other",
};

/**
 * Something in the way. Not a dependency: a dependency resolves itself when the
 * thing in front finishes, a blocker needs somebody to go and sort it out.
 */
export interface Blocker {
  id: string;
  issueId: string | null;
  projectId: string | null;
  kind: BlockerKind;
  summary: string;
  ownerId: string | null;
  owner: TechnicianRef | null;
  ownerName: string | null;
  raisedBy: string | null;
  raisedAt: string;
  clearedAt: string | null;
  clearedBy: string | null;
  resolution: string | null;
}

export interface BlockerState {
  open: number;
  cleared: number;
  /** Age in days of the oldest thing still in the way. */
  oldestOpenDays: number | null;
  /** Mean days a cleared blocker sat there. */
  meanDaysToClear: number | null;
}

export type StakeholderRole = "sponsor" | "approver" | "accountable" | "consulted" | "informed";

export const STAKEHOLDER_ROLE_LABELS: Record<StakeholderRole, string> = {
  sponsor: "Sponsor",
  approver: "Approver",
  accountable: "Accountable",
  consulted: "Consulted",
  informed: "Informed",
};

export interface Stakeholder {
  id: string;
  projectId: string;
  technicianId: string | null;
  technician: TechnicianRef | null;
  name: string | null;
  organisation: string | null;
  role: StakeholderRole;
  notes: string | null;
}

export interface ProjectLinkRef {
  id: string;
  kind: LinkKind;
  lagDays: number | null;
  to?: { id: string; name: string; status: ProjectStatus; plannedEnd: string | null };
  from?: { id: string; name: string; status: ProjectStatus; plannedEnd: string | null };
}

export interface ScheduledItem {
  id: string;
  /** Working-day ordinals; differences between them are in working days. */
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  earliestStartDate: string;
  earliestFinishDate: string;
  latestStartDate: string;
  latestFinishDate: string;
  /** Days this can slip before it moves the end — working days where one is set. */
  floatDays: number;
  critical: boolean;
}

/** A planned start its own dependencies do not permit. */
export interface ScheduleViolation {
  id: string;
  plannedStart: string;
  earliestStart: string;
  tooEarlyByDays: number;
}

export interface ScheduleAnalysis {
  items: Record<string, ScheduledItem>;
  /** No slack against the plan as typed. */
  criticalPath: string[];
  /** The longest chain of dependent work by duration — where the end date comes from. */
  longestChain: string[];
  longestChainDays: number;
  violations: ScheduleViolation[];
  projectStart: string | null;
  projectEnd: string | null;
  unscheduled: string[];
  /** Summary rows, excluded deliberately rather than for want of dates. */
  summaries: string[];
  /** True when a working calendar was applied, so the day counts are working days. */
  workingDays: boolean;
  cyclic: boolean;
}

/** A day that goes against the weekly pattern, in either direction. */
export interface CalendarException {
  id: string;
  calendarId: string;
  day: string;
  /** True when this day IS worked despite the pattern; false when it is not. */
  working: boolean;
  reason: string | null;
}

export interface WorkCalendar {
  id: string;
  /** Null means it is the fallback for properties with none of their own. */
  propertyId: string | null;
  property: { id: string; name: string } | null;
  name: string;
  /** Seven booleans, Monday first, as a JSON string. */
  workingDays: string;
  exceptions: CalendarException[];
}

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface CurvePoint {
  day: string;
  done: number;
  percent: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  propertyId: string | null;
  property: { id: string; name: string } | null;
  status: ProjectStatus;
  createdBy: string | null;
  createdAt: string;
  issues: ProjectIssue[];
  counts: ProjectRollup;
  owner: TechnicianRef | null;
  ownerId: string | null;
  budgetAmount: number | null;
  budget: ProjectBudget;
  schedule: ProjectSchedule;
  quotes: Quote[];
  quoteState: QuoteState;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  stakeholders: Stakeholder[];
  blockers: Blocker[];
  linksOut: ProjectLinkRef[];
  linksIn: ProjectLinkRef[];
  /** The forward/backward pass behind the chart. */
  analysis: ScheduleAnalysis;
  /** Work completed over time, from the dates things closed. */
  curve: CurvePoint[];
  blockerState: BlockerState;
  /** The project's own blockers plus the ones on its work. */
  openBlockers: number;
}

export type LinkKind = "precedes" | "starts_after_start" | "finishes_after_finish" | "blocks" | "relates";

/**
 * How the relationships read to somebody planning work. Start-to-start and
 * finish-to-finish are not refinements on heavy work: shoring starts after
 * excavation starts and runs alongside it; curing finishes when the pour does.
 */
export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  precedes: "must finish before",
  starts_after_start: "starts after this starts",
  finishes_after_finish: "finishes after this finishes",
  blocks: "blocks",
  relates: "relates to",
};

export interface IssueLinkRef {
  id: string;
  kind: LinkKind;
  lagDays: number | null;
  to?: { id: string; title: string; status: Status; dueDate: string | null };
  from?: { id: string; title: string; status: Status; dueDate: string | null };
}


/** A walk-round of a property: photographs first, issues afterwards. */
export interface WalkthroughIssue {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  roomName: string | null;
  category: string | null;
  lat: number;
  lng: number;
  createdAt: string;
  photos: { id: string; filename: string; thumbFilename: string | null }[];
}

/**
 * How a walk is being worked.
 *
 * "group"  — photograph everything, sort it into issues afterwards.
 * "direct" — one named issue at a time, photographs optional.
 */
export type WalkMode = "group" | "direct";

export const WALK_MODE_LABELS: Record<WalkMode, string> = {
  group: "Photograph first, sort it afterwards",
  direct: "One issue at a time",
};

export interface WalkthroughSummary {
  id: string;
  propertyId: string;
  property: { id: string; name: string };
  technician: { id: string; name: string; color: string } | null;
  walkedBy: string;
  mode: WalkMode;
  /** Where the walk is now — the default for issues logged next, not a fact about the walk. */
  spaceId: string | null;
  roomName: string | null;
  areas: string | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  lat: number | null;
  lng: number | null;
  _count?: { photos: number; issues: number };
}

export interface Walkthrough extends WalkthroughSummary {
  /** Only the photos not yet grouped: grouping moves them onto their issue. */
  photos: Photo[];
  issues: WalkthroughIssue[];
}


/** The units a reading may use. A closed list, so a series stays one series. */
export const READING_UNITS = ["°C", "mg/L", "ppm", "pH", "bar", "kPa", "%", "hours", "lux", "dB", "NTU"] as const;
export type ReadingUnit = (typeof READING_UNITS)[number];

export type RangeVerdict = "ok" | "low" | "high" | "unknown";

/**
 * Where a reading sits against its range — which side it failed on, not just
 * whether it did. "Add chlorine" and "stop dosing" are different jobs.
 */
export function judgeReading(
  value: number | null | undefined,
  minOk: number | null | undefined,
  maxOk: number | null | undefined
): RangeVerdict {
  if (value === null || value === undefined) return "unknown";
  if ((minOk === null || minOk === undefined) && (maxOk === null || maxOk === undefined)) return "unknown";
  if (minOk !== null && minOk !== undefined && value < minOk) return "low";
  if (maxOk !== null && maxOk !== undefined && value > maxOk) return "high";
  return "ok";
}

/** How the range reads to somebody: "50 °C or above", "1–3 mg/L". */
export function describeRange(unit: string | null, minOk: number | null, maxOk: number | null): string | null {
  const u = unit ? ` ${unit}` : "";
  if (minOk !== null && maxOk !== null) return `${minOk}–${maxOk}${u}`;
  if (minOk !== null) return `${minOk}${u} or above`;
  if (maxOk !== null) return `${maxOk}${u} or below`;
  return null;
}

export interface ReadingPoint {
  checkId: string;
  at: string;
  value: number;
  outcome: Outcome;
  area: string | null;
  inspector: string;
  inspectionId: string;
  property: { id: string; name: string } | null;
  verdict: RangeVerdict;
}

export interface ReadingSeries {
  key: string;
  pointId: string | null;
  section: string;
  label: string;
  unit: string | null;
  minOk: number | null;
  maxOk: number | null;
  readings: ReadingPoint[];
  count: number;
  latest: ReadingPoint | null;
  min: number;
  max: number;
  mean: number;
  /** How many of the readings fell outside the range that applied at the time. */
  outOfRange: number;
}


// ---------------------------------------------------------------------------
// Utilities: the daily round
// ---------------------------------------------------------------------------

export const UTILITY_KINDS = ["electricity", "water", "propane", "diesel"] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export const UTILITY_LABELS: Record<UtilityKind, string> = {
  electricity: "Electricity",
  water: "Water",
  propane: "Propane",
  diesel: "Diesel",
};

export const ENTRY_MODES = ["direct", "percentage", "tank_height"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const ENTRY_MODE_LABELS: Record<EntryMode, string> = {
  direct: "Reads in the unit",
  percentage: "Per cent of the tank",
  tank_height: "Height in the tank",
};

/** The two rounds. A day runs from one 05:00 to the next. */
export const SLOTS = ["0200", "0500"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABELS: Record<Slot, string> = { "0200": "02:00", "0500": "05:00" };

export const READING_UNIT_OPTIONS = ["kWh", "litre", "m3", "gal"] as const;

export interface MeterPoint {
  id: string;
  propertyId: string;
  property?: { id: string; name: string } | null;
  name: string;
  kind: UtilityKind;
  entryMode: EntryMode;
  unit: string;
  capacityLitres: number | null;
  tankMaxHeightMm: number | null;
  /** Whether this rolls into the site total, or is a submeter beneath one. */
  includeInSiteTotal: boolean;
  /** A running total that climbs, versus a level that goes up and down. */
  cumulative: boolean;
  active: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface Reading {
  id: string;
  meterPointId: string;
  takenAt: string;
  slot: Slot;
  readingDay: string;
  /** Exactly what was read, before conversion. */
  rawValue: number;
  /** The same reading in the meter's unit. */
  value: number;
  takenBy: string | null;
  notes: string | null;
}

export interface DayConsumption {
  day: string;
  opening: number | null;
  twoAm: number | null;
  closing: number | null;
  used: number | null;
  /** 02:00 to 05:00 — the quiet hours. */
  usedOvernight: number | null;
  /** 05:00 to 02:00 — while the hotel was open. */
  usedTrading: number | null;
  incomplete: boolean;
}

export interface PeriodTotals {
  wtd: number;
  mtd: number;
  /** From 1 July, the financial year this operation runs on. */
  ytd: number;
  /** Days that actually contributed, so a total can be judged. */
  days: { wtd: number; mtd: number; ytd: number };
}

export interface MeterSummary {
  meter: MeterPoint;
  days: DayConsumption[];
  totals: PeriodTotals;
  /** Rounds not taken, never reaching back before the meter's first reading. */
  missing: { day: string; missing: Slot[] }[];
  latest: DayConsumption | null;
}

export interface UnitCost {
  periodStart: string;
  periodEnd: string;
  amount: number;
  quantity: number;
  unit: string;
  /** Amount divided by quantity — derived from the bill, never typed in. */
  costPerUnit: number;
  changePercent: number | null;
}

export interface UtilityInvoice {
  id: string;
  propertyId: string;
  kind: UtilityKind;
  periodStart: string;
  periodEnd: string;
  amount: number;
  quantity: number;
  unit: string;
  reference: string | null;
  notes: string | null;
}

export interface UtilitySummary {
  today: string;
  from: string;
  meters: MeterSummary[];
  siteTotals: Record<string, { wtd: number; mtd: number; ytd: number; meters: number }>;
  costs: Record<string, UnitCost[]>;
  kinds: readonly string[];
}


// ---------------------------------------------------------------------------
// Spaces: where things are
// ---------------------------------------------------------------------------

export const SPACE_KINDS = ["block", "floor", "space"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];
export const SPACE_KIND_LABELS: Record<SpaceKind, string> = {
  block: "Block",
  floor: "Floor",
  space: "Space",
};

export const SELL_STATUSES = ["green", "amber", "red"] as const;
export type SellStatus = (typeof SELL_STATUSES)[number];
export const SELL_STATUS_LABELS: Record<SellStatus, string> = {
  green: "Sellable",
  amber: "Watch",
  red: "Out of order",
};

export interface Space {
  id: string;
  propertyId: string;
  parentId: string | null;
  kind: SpaceKind;
  name: string;
  /** The short reference people actually say: "214", "P3". */
  code: string | null;
  /** Whether this is a room that can be sold, which is what the round counts. */
  sellable: boolean;
  sellStatus: SellStatus | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  sortOrder: number;
  active: boolean;
  /** Ancestors then self: ["Coubaril", "Floor 2", "214"]. */
  path: string[];
  depth: number;
}

export interface SellRollup {
  green: number;
  amber: number;
  red: number;
  /** Sellable rooms nobody has given a status — never folded into green. */
  unset: number;
  total: number;
}

export interface SpaceMatch {
  spaceId: string;
  path: string[];
  how: "exact" | "token" | "partial";
}

export interface UnmatchedText {
  text: string;
  issues: number;
  inspections: number;
  total: number;
  matches: SpaceMatch[];
  /** Set only where a single exact match makes it safe to apply unasked. */
  certain: string | null;
}

// ---- Slice 5: equipment, and what it does to everything else --------------

export const ASSET_KINDS = [
  "panel", "breaker", "valve", "generator", "tank", "pump", "ahu", "fcu",
  "ice_machine", "lift", "meter", "grease_trap", "calorifier", "chiller", "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  panel: "Distribution panel",
  breaker: "Breaker",
  valve: "Valve",
  generator: "Generator",
  tank: "Tank",
  pump: "Pump",
  ahu: "Air handling unit",
  fcu: "Fan coil unit",
  ice_machine: "Ice machine",
  lift: "Lift",
  meter: "Meter",
  grease_trap: "Grease trap",
  calorifier: "Calorifier",
  chiller: "Chiller",
  other: "Other",
};

export const RELATION_KINDS = ["feeds", "isolates", "serves", "drains", "vents"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Phrased to read as a sentence: "DB-3 feeds Room 101". */
export const RELATION_LABELS: Record<RelationKind, string> = {
  feeds: "feeds",
  isolates: "isolates",
  serves: "serves",
  drains: "drains from",
  vents: "extracts from",
};

export const SERVICE_KINDS = ["service", "test", "repair", "replacement", "inspection"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  service: "Service",
  test: "Test",
  repair: "Repair",
  replacement: "Replacement",
  inspection: "Inspection",
};

export type ServiceState = "ok" | "due" | "overdue" | "never" | "unknown";

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  ok: "In date",
  due: "Due soon",
  overdue: "Overdue",
  never: "Never serviced",
  unknown: "No interval set",
};

export interface ServiceStatus {
  state: ServiceState;
  dueOn: string | null;
  daysOverdue: number | null;
}

export interface Asset {
  id: string;
  propertyId: string;
  spaceId: string | null;
  /** Containment, not supply: a breaker lives inside a panel. */
  parentId: string | null;
  kind: AssetKind;
  /** What people say out loud: "DB-3", "CB-14", "V-207". */
  ref: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  rating: string | null;
  installedAt: string | null;
  lat: number | null;
  lng: number | null;
  serviceIntervalDays: number | null;
  lastServicedAt: string | null;
  notes: string | null;
  active: boolean;
  /** The readable path of the space it sits in, where it has one. */
  spaceName?: string[] | null;
  service: ServiceStatus;
}

export interface AssetRelationOut {
  id: string;
  kind: RelationKind;
  notes: string | null;
  to: { id: string; name: string; kind: AssetKind; ref: string | null } | null;
  toSpace: { id: string; name: string; code: string | null } | null;
}

export interface AssetRelationIn {
  id: string;
  kind: RelationKind;
  notes: string | null;
  from: { id: string; name: string; kind: AssetKind; ref: string | null } | null;
}

export interface AssetServiceEntry {
  id: string;
  kind: ServiceKind;
  performedAt: string;
  performedBy: string | null;
  summary: string;
  reading: number | null;
  unit: string | null;
  passed: boolean | null;
}

/** One hop in a graph walk, hydrated with whatever it points at. */
export interface ReachedAsset {
  id: string;
  depth: number;
  via: RelationKind;
  asset: { id: string; name: string; kind: AssetKind; ref: string | null } | null;
}

export interface ReachedSpace {
  id: string;
  depth: number;
  via: RelationKind;
  space: (Space & { path: string[]; depth: number }) | null;
}

export interface AssetDetail {
  asset: Asset & {
    parent: { id: string; name: string; kind: AssetKind } | null;
    children: { id: string; name: string; kind: AssetKind; ref: string | null }[];
    space: { id: string; name: string; code: string | null } | null;
    relationsOut: AssetRelationOut[];
    relationsIn: AssetRelationIn[];
    services: AssetServiceEntry[];
    issues: { id: string; workOrderNumber: string | null; title: string; status: string; priority: string }[];
    photos: AssetPhoto[];
  };
  /** The blast radius: what else goes dark. */
  affects: {
    spaces: ReachedSpace[];
    assets: ReachedAsset[];
    sellableCount: number;
    truncated: boolean;
  };
  fedBy: ReachedAsset[];
}

export interface SpaceTrace {
  space: { id: string; name: string; code: string | null; propertyId: string };
  fedBy: ReachedAsset[];
  isolateAt: ReachedAsset[];
  truncated: boolean;
}

// ---- Slice 5b: equipment on the map --------------------------------------

/** How a position was arrived at — "here" and "in this building" differ. */
export type PositionSource = "own" | "space" | "parent" | "none";

export interface MapAssetSummary {
  id: string;
  name: string;
  ref: string | null;
  kind: AssetKind;
  source: PositionSource;
  photoCount: number;
  service: ServiceStatus;
}

export interface AssetMapMarker {
  key: string;
  anchorKind: "asset" | "space";
  anchorId: string;
  lat: number;
  lng: number;
  assetIds: string[];
  /** Set when the marker hangs off a space rather than a surveyed point. */
  spacePath: string[] | null;
  assets: MapAssetSummary[];
}

export interface AssetMapSpace {
  id: string;
  path: string[];
  lat: number | null;
  lng: number | null;
  kind: SpaceKind;
}

export interface AssetMap {
  markers: AssetMapMarker[];
  /** Equipment the map cannot show, reported rather than silently dropped. */
  unplaced: MapAssetSummary[];
  spaces: AssetMapSpace[];
}

export interface AssetPhoto {
  id: string;
  filename: string;
  thumbFilename: string | null;
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: string | null;
  createdAt: string;
}
