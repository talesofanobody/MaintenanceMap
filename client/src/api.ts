import type { RestoreResult, Inspection, InspectionCheck, InspectionReport, InspectionStatus, InspectionSummary, InspectionTemplate, Outcome, Project, ProjectStatus, Quote, QuoteState, QuoteStatus, LinkKind, Blocker, BlockerKind, BlockerState, StakeholderRole, WorkCalendar, ReadingSeries, MeterPoint, Reading, Slot, UtilityKind, EntryMode, UtilitySummary, UtilityInvoice, UnitCost, Space, SpaceKind, SellStatus, SellRollup, UnmatchedText, Severity, DaySchedule, ScheduledJob, TechnicianLocation, TimeOff, TimeOffKind, GuestReport, ActivityEntry, AppNotification, AppSettings, AppUser, BackupFile, CalendarFeed, Category, Message, Rota, Shift, Tag, ChecklistItem, Contractor, Cost, CostSummary, DayPlan, Portfolio, Schedule, ScheduleInput, TimeEntry, Trends, AuthUser, DashboardData, GeoJSONPolygon, Issue, Photo, Priority, Property, Role, Status, Technician, Walkthrough, WalkthroughSummary, Asset, AssetKind, AssetDetail, AssetRelationOut, AssetServiceEntry, RelationKind, ServiceKind, SpaceTrace, AssetMap, AssetPhoto, WalkMode} from "./types";

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

/**
 * The CSRF token, which the server hands back on every response while signed in.
 * Kept in memory on purpose: another site can make the browser send a request,
 * but it cannot read a response, so a token that only ever lives here is one it
 * cannot obtain. Storing it in a cookie or localStorage would give that away.
 */
let csrfToken: string | null = null;
export const currentCsrfToken = () => csrfToken;

const NEEDS_TOKEN = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

async function send(path: string, options: RequestInit | undefined, method: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options?.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (csrfToken && NEEDS_TOKEN(method)) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { ...headers, ...((options?.headers as Record<string, string>) ?? {}) },
  });
  const fresh = res.headers.get("X-CSRF-Token");
  if (fresh) csrfToken = fresh;
  return res;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET";
  let res = await send(path, options, method);

  /**
   * A token can go stale — a tab left open over a restart, or a session that
   * predates this build. The refused response carries the current one, so try
   * again with it. Once only: a second refusal is a real one.
   *
   * Worth the trouble because the alternative is a technician halfway through a
   * room being told to reload.
   */
  if (res.status === 403 && NEEDS_TOKEN(method) && csrfToken) {
    res = await send(path, options, method);
  }

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

  // ---- Walk-throughs ----------------------------------------------------
  listWalkthroughs: (params?: { propertyId?: string; state?: "open" | "completed" }) => {
    const q = new URLSearchParams();
    if (params?.propertyId) q.set("propertyId", params.propertyId);
    if (params?.state) q.set("state", params.state);
    const qs = q.toString();
    return request<WalkthroughSummary[]>(`/walkthroughs${qs ? `?${qs}` : ""}`);
  },
  getWalkthrough: (id: string) => request<Walkthrough>(`/walkthroughs/${id}`),
  startWalkthrough: (data: {
    propertyId: string; technicianId?: string; lat?: number; lng?: number;
    mode?: WalkMode; spaceId?: string | null; roomName?: string | null;
  }) =>
    request<Walkthrough>("/walkthroughs", { method: "POST", body: JSON.stringify(data) }),
  addWalkthroughPhotos: (
    id: string,
    files: File[],
    /** One entry per file, in the same order. Null where nothing is known. */
    places?: ({ lat: number; lng: number; source: "exif" | "device"; takenAt?: string | null } | null)[]
  ) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    // Shrinking on the phone throws the EXIF away, so whatever was read off the
    // original — or the phone's own fix — travels beside the files instead.
    if (places?.some(Boolean)) form.append("places", JSON.stringify(places));
    return request<Photo[]>(`/walkthroughs/${id}/photos`, { method: "POST", body: form });
  },
  groupWalkthroughPhotos: (id: string, photoIds: string[], extra?: { title?: string; roomName?: string }) =>
    request<Issue>(`/walkthroughs/${id}/group`, { method: "POST", body: JSON.stringify({ photoIds, ...extra }) }),
  /**
   * One named issue, logged where it was found. Photographs are optional here,
   * unlike grouping: the name is the finding, a photo is supporting detail.
   */
  logWalkthroughIssue: (
    id: string,
    data: {
      title: string; description?: string | null; photoIds?: string[];
      /** What was typed into the one location field; resolved against the tree server-side. */
      place?: string;
      spaceId?: string | null; roomName?: string | null;
    }
  ) => request<Issue>(`/walkthroughs/${id}/issues`, { method: "POST", body: JSON.stringify(data) }),
  updateWalkthrough: (
    id: string,
    data: { areas?: string; notes?: string; state?: "open" | "completed"; spaceId?: string | null; roomName?: string | null }
  ) =>
    request<Walkthrough>(`/walkthroughs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteWalkthrough: (id: string) => request<void>(`/walkthroughs/${id}`, { method: "DELETE" }),

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
  /** What is inside an archive, without touching anything. */
  inspectBackup: (name: string) =>
    request<{ name: string; hasDatabase: boolean; photoCount: number; bytes: number }>(`/backups/${encodeURIComponent(name)}/inspect`, { method: "POST" }),
  restoreBackup: (name: string) =>
    request<RestoreResult>(`/backups/${encodeURIComponent(name)}/restore`, { method: "POST", body: JSON.stringify({ confirm: "restore" }) }),
  restoreUpload: (file: File) => {
    const form = new FormData();
    form.append("confirm", "restore");
    form.append("archive", file);
    return request<RestoreResult>("/backups/restore", { method: "POST", body: form });
  },

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

  /**
   * A page of issues, with the total alongside.
   *
   * Paged rather than all of them: at three hundred and forty rooms carrying up
   * to forty findings each this was thirteen thousand rows with a dozen relations
   * apiece in one response. The caller gets `total` so it can say what it is not
   * showing, instead of quietly showing less.
   */
  listIssues: (propertyId: string, params: { limit?: number; offset?: number; open?: boolean } = {}) => {
    const q = new URLSearchParams({ propertyId });
    if (params.limit) q.set("limit", String(params.limit));
    if (params.offset) q.set("offset", String(params.offset));
    if (params.open) q.set("open", "1");
    return request<{ items: Issue[]; total: number; limit: number; offset: number; hasMore: boolean }>(`/issues?${q}`);
  },
  /** Every issue at a property, fetched a page at a time. For the printable report. */
  listAllIssues: async (propertyId: string, cap = 5000): Promise<{ items: Issue[]; total: number; truncated: boolean }> => {
    const items: Issue[] = [];
    let offset = 0;
    let total = 0;
    for (;;) {
      const page = await api.listIssues(propertyId, { limit: 1000, offset });
      total = page.total;
      items.push(...page.items);
      offset += page.items.length;
      if (!page.hasMore || !page.items.length || items.length >= cap) break;
    }
    return { items, total, truncated: items.length < total };
  },
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
  archiveInspection: (id: string) =>
    request<{ inspection: Inspection; photosReleased: number }>(`/inspections/${id}/archive`, { method: "POST" }),
  getInspection: (id: string) => request<Inspection>(`/inspections/${id}`),
  startInspection: (data: { propertyId: string; roomName: string; templateId?: string | null; technicianId?: string | null; lat?: number; lng?: number }) =>
    request<Inspection>("/inspections", { method: "POST", body: JSON.stringify(data) }),
  updateInspection: (id: string, data: { roomName?: string; propertyId?: string; notes?: string | null; status?: InspectionStatus; technicianId?: string | null; lat?: number; lng?: number }) =>
    request<Inspection>(`/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteInspection: (id: string) => request<void>(`/inspections/${id}`, { method: "DELETE" }),

  updateCheck: (
    checkId: string,
    data: {
      outcome?: Outcome;
      severity?: Severity | null;
      note?: string | null;
      label?: string;
      area?: string | null;
      category?: string | null;
      /**
       * A reading. Out of its range it flags the line by itself, unless an
       * outcome is sent in the same request, which wins.
       */
      value?: number | null;
      unit?: string | null;
      minOk?: number | null;
      maxOk?: number | null;
    }
  ) => request<InspectionCheck>(`/inspections/checks/${checkId}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Marks every untouched line in a section n/a — a room with no pool, say. */
  markSectionNa: (inspectionId: string, section: string, outcome: "na" | "ok" = "na") =>
    request<{ changed: number; inspection: Inspection }>(
      `/inspections/${inspectionId}/sections/${encodeURIComponent(section)}/na`,
      { method: "POST", body: JSON.stringify({ outcome }) }
    ),
  addFinding: (inspectionId: string, data: { label: string; section?: string; severity?: Severity; note?: string; category?: string | null }) =>
    request<InspectionCheck>(`/inspections/${inspectionId}/checks`, { method: "POST", body: JSON.stringify(data) }),
  deleteCheck: (checkId: string) => request<void>(`/inspections/checks/${checkId}`, { method: "DELETE" }),
  uploadCheckPhoto: (
    checkId: string,
    file: File,
    meta?: { gpsLat?: number | null; gpsLng?: number | null; takenAt?: string | null; gpsSource?: "exif" | "device" }
  ) => {
    const form = new FormData();
    form.append("photo", file);
    // Only sent when the photo was shrunk on the device and lost its EXIF with it.
    if (meta?.gpsLat != null && meta?.gpsLng != null) {
      form.append("gpsLat", String(meta.gpsLat));
      form.append("gpsLng", String(meta.gpsLng));
    }
    if (meta?.takenAt) form.append("takenAt", meta.takenAt);
    if (meta?.gpsSource) form.append("gpsSource", meta.gpsSource);
    return request<Photo>(`/inspections/checks/${checkId}/photos`, { method: "POST", body: form });
  },
  inspectionReport: (params: { ids?: string[]; propertyId?: string; from?: string; to?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params.ids?.length) q.set("ids", params.ids.join(","));
    for (const key of ["propertyId", "from", "to", "status"] as const) {
      const v = params[key];
      if (v) q.set(key, v);
    }
    return request<InspectionReport>(`/inspections/report?${q}`);
  },
  /** Findings from several rooms at once, from the combined report. */
  raiseAcrossRooms: (data: { checkIds: string[]; projectId?: string; projectName?: string; projectDescription?: string }) =>
    request<{ created: { checkId: string; issueId: string; title: string }[]; projectId: string | null; projectName: string | null; inspections: Inspection[] }>(
      "/inspections/raise",
      { method: "POST", body: JSON.stringify(data) }
    ),
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
  createProject: (data: {
    name: string;
    description?: string;
    propertyId?: string | null;
    ownerId?: string | null;
    plannedStart?: string | null;
    plannedEnd?: string | null;
    budgetAmount?: number | null;
    status?: ProjectStatus;
  }) => request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      status?: ProjectStatus;
      ownerId?: string | null;
      plannedStart?: string | null;
      plannedEnd?: string | null;
      budgetAmount?: number | null;
      force?: boolean;
    }
  ) => request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeProjectIssues: (id: string, data: { add?: string[]; remove?: string[] }) =>
    request<Project>(`/projects/${id}/issues`, { method: "POST", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  /**
   * Freeze the current plan as the baseline. `force` is needed to re-baseline,
   * because doing so hides the slippage against the original plan.
   */
  baselineProject: (id: string, force = false) =>
    request<Project>(`/projects/${id}/baseline`, { method: "POST", body: JSON.stringify({ force }) }),
  approveProject: (id: string, data: { approved?: boolean; budgetAmount?: number | null } = {}) =>
    request<Project>(`/projects/${id}/approve`, { method: "POST", body: JSON.stringify(data) }),

  // --- quotes: the three-quote rule as something you can count -----------
  listQuotes: (target: { issueId?: string; projectId?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(target)) if (v) q.set(k, v);
    return request<{ quotes: Quote[]; state: QuoteState; required: number }>(`/quotes?${q}`);
  },
  createQuote: (data: {
    issueId?: string;
    projectId?: string;
    contractorId: string;
    amount?: number | null;
    status?: QuoteStatus;
    reference?: string | null;
    notes?: string | null;
  }) => request<Quote>("/quotes", { method: "POST", body: JSON.stringify(data) }),
  updateQuote: (id: string, data: { amount?: number | null; status?: QuoteStatus; reference?: string | null; notes?: string | null }) =>
    request<Quote>(`/quotes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Awarding is allowed below three quotes; the response says so rather than blocking. */
  awardQuote: (id: string) =>
    request<{ quotes: Quote[]; state: QuoteState; required: number; belowRule: boolean; warning: string | null }>(
      `/quotes/${id}/award`,
      { method: "POST" }
    ),
  deleteQuote: (id: string) => request<void>(`/quotes/${id}`, { method: "DELETE" }),

  // --- inspection readings -----------------------------------------------
  /** Readings over time — the whole reason for recording numbers. */
  listReadings: (params: { propertyId?: string; pointId?: string; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    return request<{ series: ReadingSeries[]; units: string[] }>(`/inspections/readings${q.toString() ? `?${q}` : ""}`);
  },

  // --- spaces: where things are ------------------------------------------
  // ---- Slice 5: the equipment register and the relation graph -------------
  listAssets: (propertyId: string, kind?: string, all = false) =>
    request<{
      assets: Asset[]; kinds: AssetKind[]; kindLabels: Record<string, string>;
      relationKinds: RelationKind[]; relationLabels: Record<string, string>; serviceKinds: ServiceKind[];
    }>(`/assets?propertyId=${propertyId}${kind ? `&kind=${kind}` : ""}${all ? "&all=1" : ""}`),
  getAsset: (id: string) => request<AssetDetail>(`/assets/${id}`),
  /** Markers rather than assets: a riser with eight breakers is one marker. */
  assetMap: (propertyId: string) => request<AssetMap>(`/assets/map?propertyId=${propertyId}`),
  uploadAssetPhoto: (assetId: string, file: File) => {
    const form = new FormData();
    form.append("assetId", assetId);
    form.append("photo", file);
    return request<AssetPhoto>("/photos", { method: "POST", body: form });
  },
  /** Everything out of date, worst first — the ninety-day standard as a query. */
  assetsDue: (propertyId: string) =>
    request<{ due: Asset[]; counts: { overdue: number; never: number; dueSoon: number } }>(
      `/assets/due?propertyId=${propertyId}`
    ),
  /** What feeds a room, and where to shut it off. */
  traceSpace: (spaceId: string) => request<SpaceTrace>(`/assets/trace?spaceId=${spaceId}`),
  createAsset: (data: Record<string, unknown>) =>
    request<{ asset: Asset }>("/assets", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id: string, data: Record<string, unknown>) =>
    request<{ asset: Asset }>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  addRelation: (assetId: string, data: Record<string, unknown>) =>
    request<{ relation: AssetRelationOut }>(`/assets/${assetId}/relations`, { method: "POST", body: JSON.stringify(data) }),
  removeRelation: (assetId: string, relationId: string) =>
    request<{ ok: boolean }>(`/assets/${assetId}/relations/${relationId}`, { method: "DELETE" }),
  logService: (assetId: string, data: Record<string, unknown>) =>
    request<{ service: AssetServiceEntry; asset: Asset | null }>(`/assets/${assetId}/services`, { method: "POST", body: JSON.stringify(data) }),
  listSpaces: (propertyId: string, all = false) =>
    request<{ spaces: Space[]; sell: SellRollup; kinds: string[]; sellStatuses: string[] }>(
      `/spaces?propertyId=${propertyId}${all ? "&all=1" : ""}`
    ),
  /** `names` takes a range spec — "101-140" — which is how 340 rooms get created. */
  createSpaces: (data: {
    propertyId: string;
    parentId?: string | null;
    kind?: SpaceKind;
    name?: string;
    names?: string;
    code?: string | null;
    sellable?: boolean;
  }) =>
    request<{ created: number; skipped: number; spaces: Space[]; sell: SellRollup }>("/spaces", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSpace: (
    id: string,
    data: { name?: string; code?: string | null; kind?: SpaceKind; sellable?: boolean; sellStatus?: SellStatus | null; parentId?: string | null; active?: boolean; notes?: string | null }
  ) => request<{ spaces: Space[]; sell: SellRollup }>(`/spaces/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSpace: (id: string, force = false) =>
    request<void>(`/spaces/${id}`, { method: "DELETE", body: JSON.stringify({ force }) }),

  /** Free text on this property's work that has not been matched to the tree. */
  unmatchedSpaces: (propertyId: string) =>
    request<{ unmatched: UnmatchedText[]; distinct: number; certain: number }>(`/spaces/unmatched?propertyId=${propertyId}`),
  /**
   * Point rows at a space. `auto` applies only the unambiguous ones — a single
   * exact match — and reports what it left for a person.
   */
  reconcileSpaces: (data: { propertyId: string; auto?: boolean; text?: string; spaceId?: string }) =>
    request<{ texts: number; issues: number; inspections: number; remaining: { issues: number; inspections: number } }>(
      "/spaces/reconcile",
      { method: "POST", body: JSON.stringify(data) }
    ),

  // --- utilities: the daily round ----------------------------------------
  listMeters: (propertyId: string, all = false) =>
    request<{ meters: MeterPoint[]; kinds: string[]; entryModes: string[]; units: string[]; slots: string[] }>(
      `/utilities/meters?propertyId=${propertyId}${all ? "&all=1" : ""}`
    ),
  createMeter: (data: {
    propertyId: string;
    name: string;
    kind: UtilityKind;
    entryMode?: EntryMode;
    unit: string;
    capacityLitres?: number | null;
    tankMaxHeightMm?: number | null;
    includeInSiteTotal?: boolean;
    cumulative?: boolean;
    notes?: string | null;
  }) => request<MeterPoint>("/utilities/meters", { method: "POST", body: JSON.stringify(data) }),
  updateMeter: (id: string, data: Partial<Omit<MeterPoint, "id" | "propertyId" | "property">>) =>
    request<MeterPoint>(`/utilities/meters/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** A meter with readings is taken out of use rather than deleted. */
  retireMeter: (id: string) =>
    request<{ deactivated?: boolean; readings?: number; message?: string }>(`/utilities/meters/${id}`, { method: "DELETE" }),

  /** One day's round across every meter, for the screen that enters them. */
  readingsForDay: (propertyId: string, day?: string) =>
    request<{ day: string; rows: { meter: MeterPoint; readings: Partial<Record<Slot, Reading>> }[]; slots: Slot[] }>(
      `/utilities/readings?propertyId=${propertyId}${day ? `&day=${day}` : ""}`
    ),
  /** Records a round. Re-recording the same one corrects it rather than adding another. */
  recordReading: (data: { meterPointId: string; slot: Slot; rawValue: number; readingDay?: string; takenAt?: string; notes?: string }) =>
    request<Reading>("/utilities/readings", { method: "POST", body: JSON.stringify(data) }),
  deleteReading: (id: string) => request<void>(`/utilities/readings/${id}`, { method: "DELETE" }),

  /** The property in a nutshell: series, totals, missed rounds, cost per unit. */
  utilitySummary: (propertyId: string, params: { today?: string; from?: string } = {}) => {
    const q = new URLSearchParams({ propertyId });
    if (params.today) q.set("today", params.today);
    if (params.from) q.set("from", params.from);
    return request<UtilitySummary>(`/utilities/summary?${q}`);
  },

  listUtilityInvoices: (propertyId: string, kind?: string) =>
    request<{ invoices: UtilityInvoice[]; costs: Record<string, UnitCost[]> }>(
      `/utilities/invoices?propertyId=${propertyId}${kind ? `&kind=${kind}` : ""}`
    ),
  /** The bill, so cost per unit is derived rather than claimed. */
  recordUtilityInvoice: (data: {
    propertyId: string;
    kind: UtilityKind;
    periodStart: string;
    periodEnd: string;
    amount: number;
    quantity: number;
    unit: string;
    reference?: string;
  }) => request<UtilityInvoice>("/utilities/invoices", { method: "POST", body: JSON.stringify(data) }),
  deleteUtilityInvoice: (id: string) => request<void>(`/utilities/invoices/${id}`, { method: "DELETE" }),

  // --- the working calendar ----------------------------------------------
  listCalendars: () => request<WorkCalendar[]>("/calendars"),
  /** What is in force for a property, whether its own or inherited. */
  calendarFor: (propertyId: string) =>
    request<{ calendar: WorkCalendar | null; inherited: boolean }>(`/calendars/for/${propertyId}`),
  createCalendar: (data: { propertyId?: string | null; name?: string; workingDays?: boolean[] }) =>
    request<WorkCalendar>("/calendars", { method: "POST", body: JSON.stringify(data) }),
  updateCalendar: (id: string, data: { name?: string; workingDays?: boolean[] }) =>
    request<WorkCalendar>(`/calendars/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Sets a day against the pattern — a holiday, or a day worked anyway. */
  setCalendarException: (id: string, data: { day: string; working: boolean; reason?: string }) =>
    request<WorkCalendar>(`/calendars/${id}/exceptions`, { method: "POST", body: JSON.stringify(data) }),
  removeCalendarException: (id: string, exceptionId: string) =>
    request<WorkCalendar>(`/calendars/${id}/exceptions/${exceptionId}`, { method: "DELETE" }),
  /** Removing it puts that property back to counting every day. */
  deleteCalendar: (id: string) => request<void>(`/calendars/${id}`, { method: "DELETE" }),

  // --- governance: blockers, stakeholders, project dependencies ----------
  listBlockers: (target: { issueId?: string; projectId?: string; open?: boolean }) => {
    const q = new URLSearchParams();
    if (target.issueId) q.set("issueId", target.issueId);
    if (target.projectId) q.set("projectId", target.projectId);
    if (target.open) q.set("open", "1");
    return request<{ blockers: Blocker[]; state: BlockerState; kinds: BlockerKind[] }>(`/blockers?${q}`);
  },
  createBlocker: (data: {
    issueId?: string;
    projectId?: string;
    kind?: BlockerKind;
    summary: string;
    ownerId?: string;
    ownerName?: string;
  }) => request<Blocker>("/blockers", { method: "POST", body: JSON.stringify(data) }),
  updateBlocker: (id: string, data: { summary?: string; kind?: BlockerKind; ownerId?: string | null; ownerName?: string | null }) =>
    request<Blocker>(`/blockers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Clears it with what was done, or reopens it with `{ cleared: false }`. */
  clearBlocker: (id: string, data: { resolution?: string; cleared?: boolean } = {}) =>
    request<Blocker>(`/blockers/${id}/clear`, { method: "POST", body: JSON.stringify(data) }),
  /** Only for one raised in error — a cleared blocker is the record of the wait. */
  deleteBlocker: (id: string) => request<void>(`/blockers/${id}`, { method: "DELETE" }),

  addStakeholder: (
    projectId: string,
    data: { technicianId?: string; name?: string; organisation?: string; role?: StakeholderRole; notes?: string }
  ) => request<Project>(`/projects/${projectId}/stakeholders`, { method: "POST", body: JSON.stringify(data) }),
  updateStakeholder: (projectId: string, id: string, data: { role?: StakeholderRole; organisation?: string | null; notes?: string | null }) =>
    request<Project>(`/projects/${projectId}/stakeholders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeStakeholder: (projectId: string, id: string) =>
    request<Project>(`/projects/${projectId}/stakeholders/${id}`, { method: "DELETE" }),

  linkProjects: (id: string, data: { toProjectId: string; kind?: LinkKind; lagDays?: number | null }) =>
    request<Project>(`/projects/${id}/links`, { method: "POST", body: JSON.stringify(data) }),
  unlinkProjects: (id: string, linkId: string) => request<Project>(`/projects/${id}/links/${linkId}`, { method: "DELETE" }),

  // --- work breakdown and dependencies -----------------------------------
  linkIssues: (id: string, data: { toIssueId: string; kind?: LinkKind; lagDays?: number | null }) =>
    request<Issue>(`/issues/${id}/links`, { method: "POST", body: JSON.stringify(data) }),
  unlinkIssues: (id: string, linkId: string) => request<Issue>(`/issues/${id}/links/${linkId}`, { method: "DELETE" }),

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
