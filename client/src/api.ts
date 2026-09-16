import type { ActivityEntry, AppNotification, AppSettings, AppUser, CalendarFeed, ChecklistItem, Contractor, Cost, CostSummary, DayPlan, Portfolio, Schedule, ScheduleInput, TimeEntry, Trends, AuthUser, DashboardData, GeoJSONPolygon, Issue, Photo, Priority, Property, Role, Status, Technician } from "./types";

export interface TechnicianInput {
  name: string;
  trade?: string | null;
  phone?: string | null;
  color?: string;
  weeklyHours?: number[];
  hourlyRate?: number | null;
  notes?: string | null;
  active?: boolean;
}

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AuthStatus {
  authenticated: boolean;
  needsSetup: boolean;
  username?: string;
  user?: AuthUser;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>("/auth/me"),
  setupAccount: (username: string, password: string) =>
    request<AuthStatus>("/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<AuthStatus>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  listUsers: () => request<AppUser[]>("/users"),
  createUser: (data: { username: string; password: string; role: Role; technicianId?: string }) =>
    request<AppUser>("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: string, data: { active?: boolean; role?: Role; password?: string; technicianId?: string | null }) =>
    request<AppUser>(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),

  listActivity: (params: { issueId?: string; propertyId?: string; entityType?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<ActivityEntry[]>(`/activity${q.toString() ? `?${q}` : ""}`);
  },

  listNotifications: () => request<{ unread: number; items: AppNotification[] }>("/notifications"),
  markNotificationRead: (id: string) => request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),
  runReminderChecks: () => request<{ created: number; checked: number }>("/notifications/run-checks", { method: "POST" }),

  listTimeEntries: (params: { issueId?: string; technicianId?: string; day?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<TimeEntry[]>(`/time${q.toString() ? `?${q}` : ""}`);
  },
  getOpenEntry: (technicianId?: string) => request<TimeEntry | null>(`/time/open${technicianId ? `?technicianId=${encodeURIComponent(technicianId)}` : ""}`),
  clockIn: (issueId: string, technicianId?: string) =>
    request<TimeEntry>("/time/clock-in", { method: "POST", body: JSON.stringify({ issueId, technicianId }) }),
  clockOut: (note?: string, technicianId?: string) =>
    request<TimeEntry & { totalHours: number }>("/time/clock-out", { method: "POST", body: JSON.stringify({ note, technicianId }) }),
  deleteTimeEntry: (id: string) => request<void>(`/time/${id}`, { method: "DELETE" }),

  getSettings: () => request<{ settings: AppSettings; defaults: AppSettings }>("/settings"),
  saveSettings: (settings: AppSettings) => request<{ settings: AppSettings; defaults: AppSettings }>("/settings", { method: "PUT", body: JSON.stringify(settings) }),

  listSchedules: (propertyId?: string) => request<Schedule[]>(`/schedules${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`),
  createSchedule: (data: ScheduleInput) => request<Schedule>("/schedules", { method: "POST", body: JSON.stringify(data) }),
  updateSchedule: (id: string, data: Partial<ScheduleInput>) => request<Schedule>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${id}`, { method: "DELETE" }),
  runScheduleNow: (id: string) => request<{ issue: Issue; schedule: Schedule | null }>(`/schedules/${id}/run-now`, { method: "POST" }),

  addChecklistItem: (issueId: string, text: string) => request<ChecklistItem>(`/issues/${issueId}/checklist`, { method: "POST", body: JSON.stringify({ text }) }),
  updateChecklistItem: (issueId: string, itemId: string, data: { done?: boolean; text?: string }) =>
    request<ChecklistItem>(`/issues/${issueId}/checklist/${itemId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteChecklistItem: (issueId: string, itemId: string) => request<void>(`/issues/${issueId}/checklist/${itemId}`, { method: "DELETE" }),

  listContractors: () => request<Contractor[]>("/contractors"),
  createContractor: (data: Partial<Contractor> & { name: string }) => request<Contractor>("/contractors", { method: "POST", body: JSON.stringify(data) }),
  updateContractor: (id: string, data: Partial<Contractor>) => request<Contractor>(`/contractors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteContractor: (id: string) => request<void>(`/contractors/${id}`, { method: "DELETE" }),

  listCosts: (issueId: string) => request<{ lines: Cost[]; summary: CostSummary }>(`/issues/${issueId}/costs`),
  addCost: (issueId: string, data: Partial<Cost> & { description: string; amount: number }) =>
    request<{ cost: Cost; summary: CostSummary }>(`/issues/${issueId}/costs`, { method: "POST", body: JSON.stringify(data) }),
  deleteCost: (issueId: string, costId: string) => request<{ summary: CostSummary }>(`/issues/${issueId}/costs/${costId}`, { method: "DELETE" }),

  getDayPlan: (params: { technicianId?: string; day: string; propertyId?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
    return request<DayPlan>(`/planner?${q}`);
  },
  applyDayPlan: (data: { technicianId?: string; day: string; issueIds: string[] }) =>
    request<{ applied: number; plan: DayPlan }>("/planner/apply", { method: "POST", body: JSON.stringify(data) }),

  exportCostsUrl: (propertyId?: string) => `${BASE}/export/costs.csv${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`,

  getTrends: (months = 12) => request<Trends>(`/insights/trends?months=${months}`),
  getPortfolio: () => request<Portfolio>("/insights/portfolio"),

  getCalendarFeed: () => request<CalendarFeed>("/calendar/feed"),
  regenerateCalendarFeed: () => request<CalendarFeed>("/calendar/feed/regenerate", { method: "POST" }),

  listProperties: () => request<Property[]>("/properties"),
  createProperty: (data: { name: string; address?: string; notes?: string }) =>
    request<Property>("/properties", { method: "POST", body: JSON.stringify(data) }),
  getProperty: (id: string) => request<Property>(`/properties/${id}`),
  updateProperty: (
    id: string,
    data: Partial<{ name: string; address: string; notes: string; boundary: GeoJSONPolygon | null; centerLat: number; centerLng: number }>
  ) => request<Property>(`/properties/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProperty: (id: string) => request<void>(`/properties/${id}`, { method: "DELETE" }),

  listIssues: (propertyId: string) => request<Issue[]>(`/issues?propertyId=${propertyId}`),
  createIssue: (data: {
    propertyId: string;
    title: string;
    description?: string;
    actionNeeded?: string;
    priority?: Priority;
    status?: Status;
    workOrderCreated?: boolean;
    workOrderNumber?: string;
    workOrderUrl?: string | null;
    comments?: string;
    lat: number;
    lng: number;
    closedAt?: string | null;
    technicianId?: string | null;
    estimatedHours?: number | null;
    actualHours?: number | null;
    scheduledFor?: string | null;
    dueDate?: string | null;
  }) => request<Issue>("/issues", { method: "POST", body: JSON.stringify(data) }),

  exportIssuesUrl: (propertyId?: string) => `${BASE}/export/issues.csv${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`,
  exportTechniciansUrl: () => `${BASE}/export/technicians.csv`,

  listTechnicians: () => request<Technician[]>("/technicians"),
  createTechnician: (data: TechnicianInput) => request<Technician>("/technicians", { method: "POST", body: JSON.stringify(data) }),
  updateTechnician: (id: string, data: Partial<TechnicianInput>) =>
    request<Technician>(`/technicians/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTechnician: (id: string) => request<void>(`/technicians/${id}`, { method: "DELETE" }),

  getDashboard: () => request<DashboardData>("/dashboard"),
  updateIssue: (id: string, data: Partial<Issue>) =>
    request<Issue>(`/issues/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteIssue: (id: string) => request<void>(`/issues/${id}`, { method: "DELETE" }),

  uploadPhoto: (issueId: string, file: File) => {
    const form = new FormData();
    form.append("issueId", issueId);
    form.append("photo", file);
    return request<Photo>("/photos", { method: "POST", body: form });
  },
  deletePhoto: (id: string) => request<void>(`/photos/${id}`, { method: "DELETE" }),
  photoUrl: (id: string) => `${BASE}/photos/${id}/file`,
  photoThumbUrl: (id: string) => `${BASE}/photos/${id}/thumb`,
};
