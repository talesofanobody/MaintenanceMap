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
  createdAt: string;
  updatedAt: string;
  photos: Photo[];
}

export interface DashboardIssue extends Omit<Issue, "photos"> {
  property: { id: string; name: string };
  photos: { id: string }[];
}

export interface DashboardData {
  generatedAt: string;
  properties: Pick<Property, "id" | "name" | "address" | "boundary" | "centerLat" | "centerLng">[];
  technicians: Omit<Technician, "assignments">[];
  issues: DashboardIssue[];
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
