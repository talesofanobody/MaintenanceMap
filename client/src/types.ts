export type Priority = "low" | "medium" | "high" | "urgent";
export type Status = "pending" | "in_progress" | "completed";

export interface Photo {
  id: string;
  issueId: string;
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
  | "unassigned";

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
  slaDays: Record<Priority, number>;
  warnAtPercent: number;
  escalation: { enabled: boolean; afterOverdueDays: number };
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
  scheduleId?: string | null;
  checklist?: ChecklistItem[];
  title: string;
  description: string | null;
  actionNeeded: string | null;
  priority: Priority;
  status: Status;
  workOrderCreated: boolean;
  workOrderNumber: string | null;
  workOrderUrl: string | null;
  comments: string | null;
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
  issues?: Issue[];
  _count?: { issues: number };
}

export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
export const STATUSES: Status[] = ["pending", "in_progress", "completed"];

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#16a34a",
  medium: "#eab308",
  high: "#f97316",
  urgent: "#dc2626",
};

export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  low: "Cosmetic or minor — schedule when convenient",
  medium: "Needs attention — plan within the month",
  high: "Deteriorating or affecting use — act soon",
  urgent: "Safety, structural or high-risk — act now",
};

export const STATUS_LABELS: Record<Status, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent / High Risk",
};

export const PRIORITY_SHORT_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
