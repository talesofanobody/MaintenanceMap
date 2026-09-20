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
  takenAt: string | null;
  createdAt: string;
}

export type Role = "admin" | "technician" | "display";

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", technician: "Technician", display: "Display" };

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
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

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
  includesPhotos: boolean;
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
