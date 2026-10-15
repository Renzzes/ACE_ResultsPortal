import { customFetch } from "@workspace/api-client-react";

export type AdminMonitorSnapshot = {
  openSessions: number;
  pendingWork: number;
  uploadsToday: number;
  sessions: Array<{
    id: string;
    name: string;
    role: string;
    username: string;
    status: "active" | "idle";
    started: string;
    detail: string;
  }>;
  alerts: Array<{
    id: string;
    level: "ok" | "warn" | "info";
    title: string;
    body: string;
    time: string;
    href?: string;
  }>;
  activity: Array<{
    id: number;
    action: string;
    userName?: string | null;
    details?: string | null;
    createdAt: string;
  }>;
};

export type AdminNotificationItem = {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  unread: boolean;
};

export type Department = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  resultScope: "all" | "laboratory" | "radiology" | "other";
  createdAt: string;
  updatedAt: string;
};

export type RolePermissionRow = {
  role: string;
  users: boolean;
  patients: boolean;
  results: boolean;
  upload_results: boolean;
  audit: boolean;
  archive: boolean;
  settings: boolean;
};

export type RolePermissionsMatrix = {
  source: "database" | "file" | "defaults";
  editable: boolean;
  rows: RolePermissionRow[];
  message: string | null;
};

export type AdminPatientAccountRow = {
  id: number;
  patientHisId: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  createdAt: string;
  resultCount?: number;
  accessCodeRequestedAt?: string | null;
  dateOfBirth?: string | null;
  portalActive?: boolean;
};

export function fetchAdminPatientAccounts(params?: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.page != null) query.set("page", String(params.page));
  if (params?.limit != null) query.set("limit", String(params.limit));
  const qs = query.toString();
  return customFetch<{
    data: AdminPatientAccountRow[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/admin/patient-accounts${qs ? `?${qs}` : ""}`);
}

export function fetchAdminMonitor() {
  return customFetch<AdminMonitorSnapshot>("/api/admin/monitor");
}

export function fetchAdminNotifications() {
  return customFetch<{ data: AdminNotificationItem[] }>("/api/admin/notifications");
}

export function fetchRolePermissions() {
  return customFetch<RolePermissionsMatrix>("/api/admin/role-permissions");
}

export function saveRolePermissions(rows: RolePermissionRow[]) {
  return customFetch<RolePermissionsMatrix>("/api/admin/role-permissions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

export type SupportRequestRow = {
  id: number;
  category: "temporary_password" | "diagnostic_access_code";
  patientHisId: string;
  lastName: string;
  contactEmail?: string | null;
  details?: string | null;
  status: "pending" | "processing" | "completed" | "rejected";
  matchedPatientId?: number | null;
  processedById?: number | null;
  processedAt?: string | null;
  adminNotes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchAdminSupportRequests(params?: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.page != null) query.set("page", String(params.page));
  if (params?.limit != null) query.set("limit", String(params.limit));
  const qs = query.toString();
  return customFetch<{
    data: SupportRequestRow[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/admin/support-requests${qs ? `?${qs}` : ""}`);
}

export function processAdminSupportRequest(
  id: number,
  body: { action: "fulfill" | "reject"; adminNotes?: string },
) {
  return customFetch<{
    request: SupportRequestRow;
    message?: string;
    emailAccepted?: boolean;
    temporaryPassword?: string;
    accessCode?: string;
    passwordReset?: boolean;
    accessCodeIssued?: boolean;
    emailedToMasked?: string | null;
  }>(`/api/admin/support-requests/${id}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchActiveDepartments() {
  return customFetch<{ data: Department[] }>("/api/departments");
}

export function fetchAdminDepartments() {
  return customFetch<{ data: Department[] }>("/api/admin/departments");
}

export function createDepartment(input: {
  name: string;
  code?: string;
  resultScope?: Department["resultScope"];
  sortOrder?: number;
}) {
  return customFetch<Department>("/api/admin/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDepartment(
  id: number,
  patch: Partial<Pick<Department, "name" | "isActive" | "sortOrder" | "resultScope">>,
) {
  return customFetch<Department>(`/api/admin/departments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
