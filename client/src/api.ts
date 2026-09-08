import type { GeoJSONPolygon, Issue, Photo, Priority, Property, Status } from "./types";

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
}

export const api = {
  getAuthStatus: () => request<AuthStatus>("/auth/me"),
  setupAccount: (username: string, password: string) =>
    request<AuthStatus>("/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<AuthStatus>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

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
    comments?: string;
    lat: number;
    lng: number;
  }) => request<Issue>("/issues", { method: "POST", body: JSON.stringify(data) }),
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
