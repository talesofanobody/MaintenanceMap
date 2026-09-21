import type { Inspection, InspectionCheck, InspectionStatus, InspectionSummary, InspectionTemplate, Outcome, Project, ProjectStatus, Severity, DaySchedule, ScheduledJob, TechnicianLocation, TimeOff, TimeOffKind, GuestReport, ActivityEntry, AppNotification, AppSettings, AppUser, BackupFile, CalendarFeed, Category, Message, Rota, Shift, Tag, ChecklistItem, Contractor, Cost, CostSummary, DayPlan, Portfolio, Schedule, ScheduleInput, TimeEntry, Trends, AuthUser, DashboardData, GeoJSONPolygon, Issue, Photo, Priority, Property, Role, Status, Technician } from "./types";

export interface TechnicianInput {
  name: string;
  trade?: string | null;
  phone?: string | null;
  color?: string;
  weeklyHours?: number[];
  shifts?: (Shift | null)[];
  categories?: string[];
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

  listBackups: () => request<{ directory: string; backups: BackupFile[] }>("/backups"),
  runBackup: () => request<BackupFile>("/backups/run", { method: "POST" }),
  deleteBackup: (name: string) => request<void>(`/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
  backupUrl: (name: string) => `${BASE}/backups/${encodeURIComponent(name)}`,

  listTags: () => request<{ tags: Tag[]; categories: Category[] }>("/tags"),
  createTag: (data: { name: string; color?: string }) => request<Tag>("/tags", { method: "POST", body: JSON.stringify(data) }),
  updateTag: (id: string, data: { name?: string; color?: string; active?: boolean }) => request<Tag>(`/tags/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTag: (id: string) => request<void>(`/tags/${id}`, { method: "DELETE" }),

  getRota: (week?: string) => request<Rota>(`/rota${week ? `?week=${week}` : ""}`),
  listRooms: (propertyId: string) => request<string[]>(`/issues/rooms/${propertyId}`),

  listMessages: (issueId: string) => request<Message[]>(`/issues/${issueId}/messages`),
  postMessage: (issueId: string, body: string) => request<Message>(`/issues/${issueId}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  updateMessage: (issueId: string, messageId: string, body: string) =>
    request<Message>(`/issues/${issueId}/messages/${messageId}`, { method: "PUT", body: JSON.stringify({ body }) }),
  deleteMessage: (issueId: string, messageId: string) => request<void>(`/issues/${issueId}/messages/${messageId}`, { method: "DELETE" }),

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
    firstMessage?: string;
    lat: number;
    lng: number;
    closedAt?: string | null;
    technicianId?: string | null;
    estimatedHours?: number | null;
    actualHours?: number | null;
    scheduledFor?: string | null;
    dueDate?: string | null;
    /** Set when this issue is an accepted guest report: the photos and the record move with it. */
    guestReportId?: string;
    /** The whole crew, lead first. Replaces technicianId, which still works. */
    technicianIds?: string[];
    isEmergency?: boolean;
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

  listTimeOff: (params: { technicianId?: string; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return request<TimeOff[]>(`/timeoff${q.toString() ? `?${q}` : ""}`);
  },
  createTimeOff: (data: { technicianId: string; startDay: string; endDay?: string; kind?: TimeOffKind; note?: string }) =>
    request<{ entry: TimeOff; clashingJobs: number }>("/timeoff", { method: "POST", body: JSON.stringify(data) }),
  updateTimeOff: (id: string, data: { startDay?: string; endDay?: string; kind?: TimeOffKind; note?: string | null }) =>
    request<TimeOff>(`/timeoff/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTimeOff: (id: string) => request<void>(`/timeoff/${id}`, { method: "DELETE" }),

  getSchedule: (day: string) => request<DaySchedule>(`/schedule?day=${encodeURIComponent(day)}`),
  scheduleAssign: (data: { issueId: string; technicianId: string | null; day: string | null; position?: number | null }) =>
    request<ScheduledJob>("/schedule/assign", { method: "PUT", body: JSON.stringify(data) }),
  scheduleEmergency: (data: { issueId: string; technicianId: string; day: string; position?: number }) =>
    request<{ displaced: number; day: string; technicianId: string }>("/schedule/emergency", { method: "POST", body: JSON.stringify(data) }),
  technicianLocations: () => request<{ technicians: TechnicianLocation[]; generatedAt: string }>("/schedule/locations"),

  // --- Inspections. Grouped so the whole domain lifts out in one piece. ---
  listTemplates: (params: { propertyId?: string; all?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.propertyId) q.set("propertyId", params.propertyId);
    if (params.all) q.set("all", "1");
    return request<InspectionTemplate[]>(`/inspections/templates${q.toString() ? `?${q}` : ""}`);
  },
  getTemplate: (id: string) => request<InspectionTemplate>(`/inspections/templates/${id}`),
  createTemplate: (data: { name: string; description?: string; propertyId?: string | null; sections: { name: string; points: { label: string; hint?: string | null; category?: string | null }[] }[] }) =>
    request<InspectionTemplate>("/inspections/templates", { method: "POST", body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: Record<string, unknown>) =>
    request<InspectionTemplate>(`/inspections/templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTemplate: (id: string) => request<void>(`/inspections/templates/${id}`, { method: "DELETE" }),

  listInspections: (params: { propertyId?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return request<InspectionSummary[]>(`/inspections${q.toString() ? `?${q}` : ""}`);
  },
  getInspection: (id: string) => request<Inspection>(`/inspections/${id}`),
  startInspection: (data: { propertyId: string; roomName: string; templateId?: string | null }) =>
    request<Inspection>("/inspections", { method: "POST", body: JSON.stringify(data) }),
  updateInspection: (id: string, data: { roomName?: string; notes?: string | null; status?: InspectionStatus }) =>
    request<Inspection>(`/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteInspection: (id: string) => request<void>(`/inspections/${id}`, { method: "DELETE" }),

  updateCheck: (checkId: string, data: { outcome?: Outcome; severity?: Severity | null; note?: string | null; label?: string; category?: string | null }) =>
    request<InspectionCheck>(`/inspections/checks/${checkId}`, { method: "PUT", body: JSON.stringify(data) }),
  addFinding: (inspectionId: string, data: { label: string; section?: string; severity?: Severity; note?: string; category?: string | null }) =>
    request<InspectionCheck>(`/inspections/${inspectionId}/checks`, { method: "POST", body: JSON.stringify(data) }),
  deleteCheck: (checkId: string) => request<void>(`/inspections/checks/${checkId}`, { method: "DELETE" }),
  uploadCheckPhoto: (checkId: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<Photo>(`/inspections/checks/${checkId}/photos`, { method: "POST", body: form });
  },
  raiseFindings: (inspectionId: string, data: { checkIds: string[]; projectId?: string; projectName?: string; projectDescription?: string }) =>
    request<{ created: { checkId: string; issueId: string; title: string }[]; projectId: string | null; projectName: string | null; inspection: Inspection }>(
      `/inspections/${inspectionId}/raise`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  listProjects: (params: { status?: string; propertyId?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return request<Project[]>(`/projects${q.toString() ? `?${q}` : ""}`);
  },
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: { name: string; description?: string; propertyId?: string | null }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: { name?: string; description?: string | null; status?: ProjectStatus; force?: boolean }) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeProjectIssues: (id: string, data: { add?: string[]; remove?: string[] }) =>
    request<Project>(`/projects/${id}/issues`, { method: "POST", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  setPropertyIntake: (id: string, data: { enabled?: boolean; rotate?: boolean }) =>
    request<{ id: string; intakeEnabled: boolean; intakeToken: string | null }>(`/properties/${id}/intake`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listGuestReports: (params: { status?: string; propertyId?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return request<{ reports: GuestReport[]; pendingCount: number }>(`/guest-reports${q.toString() ? `?${q}` : ""}`);
  },
  getGuestReport: (id: string) => request<GuestReport>(`/guest-reports/${id}`),
  guestReportPendingCount: () => request<{ pendingCount: number }>("/guest-reports/pending-count"),
  declineGuestReport: (id: string, note: string) =>
    request<GuestReport>(`/guest-reports/${id}/decline`, { method: "POST", body: JSON.stringify({ note }) }),
  reopenGuestReport: (id: string) => request<GuestReport>(`/guest-reports/${id}/reopen`, { method: "POST" }),
  deleteGuestReport: (id: string) => request<void>(`/guest-reports/${id}`, { method: "DELETE" }),
};

/**
 * The public reporting form. No session is involved — the token in the link is the only
 * credential — so these deliberately sit outside the `api` object everything else uses.
 */
export const intakeApi = {
  open: (token: string) => request<{ property: { name: string }; categories: Category[] }>(`/intake/${encodeURIComponent(token)}`),
  submit: (token: string, data: { roomName: string; category: string; description: string; photos: File[] }) => {
    const form = new FormData();
    form.append("roomName", data.roomName);
    form.append("category", data.category);
    form.append("description", data.description);
    for (const photo of data.photos) form.append("photos", photo);
    return request<{ ok: boolean; reference: string; photos: number }>(`/intake/${encodeURIComponent(token)}`, { method: "POST", body: form });
  },
};
