import { customFetch } from "@workspace/api-client-react";

export type PortalNotification = {
  id: number;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  priority: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type MessageThreadSummary = {
  id: number;
  subject: string;
  patientId: number | null;
  patientName: string | null;
  patientHisId: string | null;
  isClosed: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  participants: Array<{ id: number; name: string; role: string }>;
};

export type MessageRecipient = {
  id: number;
  name: string;
  username: string;
  role: string;
  department: string | null;
};

export type Announcement = {
  id: number;
  title: string;
  body: string;
  priority: string;
  createdById: number;
  isPublished: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: Array<{ targetType: string; targetValue: string | null }>;
};

export async function fetchPortalMessageRecipients(search?: string) {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  return customFetch<{
    data: Array<{ id: number; name: string; role: string; category: string }>;
  }>(`/api/portal/messages/recipients${q}`);
}

export async function fetchPortalMessageUnreadCount() {
  return customFetch<{ count: number }>("/api/portal/messages/unread-count");
}

export async function fetchPortalMessageThreads(params?: { page?: number; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return customFetch<{
    data: Array<{
      id: number;
      subject: string;
      isClosed: boolean;
      createdAt: string;
      updatedAt: string;
      unreadCount: number;
      lastMessagePreview: string | null;
      lastMessageAt: string | null;
      counterpart: { name: string; role: string } | null;
      participants: Array<{ name: string; role: string }>;
    }>;
    total: number;
    page: number;
    limit: number;
  }>(`/api/portal/messages${qs ? `?${qs}` : ""}`);
}

export async function createPortalMessageThread(body: {
  recipientUserId: number;
  subject?: string;
  body?: string;
}) {
  return customFetch<{ id: number; subject: string; reused?: boolean }>("/api/portal/messages/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchPortalMessageThread(threadId: number) {
  return customFetch<{
    id: number;
    subject: string;
    isClosed: boolean;
    createdAt: string;
    updatedAt: string;
    participants: Array<{ name: string; role: string }>;
    messages: {
      data: Array<{
        id: number;
        threadId: number;
        mine: boolean;
        senderName: string;
        body: string;
        isDeleted: boolean;
        createdAt: string;
      }>;
      total: number;
      page: number;
      limit: number;
    };
  }>(`/api/portal/messages/${threadId}`);
}

export async function sendPortalMessage(threadId: number, body: string) {
  return customFetch<{
    id: number;
    threadId: number;
    mine: boolean;
    body: string;
    createdAt: string;
  }>(`/api/portal/messages/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function markPortalMessageThreadRead(threadId: number) {
  return customFetch<{ ok: boolean }>(`/api/portal/messages/${threadId}/read`, { method: "POST" });
}

export async function closePortalMessageThread(threadId: number) {
  return customFetch<{ id: number; isClosed: boolean }>(`/api/portal/messages/${threadId}/close`, {
    method: "POST",
  });
}

export async function deletePortalMessageThread(threadId: number) {
  return customFetch<{ id: number }>(`/api/portal/messages/${threadId}`, { method: "DELETE" });
}

export async function fetchPortalNotifications(params?: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.unreadOnly) q.set("unreadOnly", "1");
  const qs = q.toString();
  return customFetch<{ data: PortalNotification[]; total: number; page: number; limit: number }>(
    `/api/portal/notifications${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchPortalNotificationUnreadCount() {
  return customFetch<{ count: number }>("/api/portal/notifications/unread-count");
}

export async function markPortalNotificationRead(id: number) {
  return customFetch<PortalNotification>(`/api/portal/notifications/${id}/read`, { method: "POST" });
}

export async function markAllPortalNotificationsRead() {
  return customFetch<{ updated: number }>("/api/portal/notifications/read-all", { method: "POST" });
}

export async function fetchNotifications(params?: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.unreadOnly) q.set("unreadOnly", "1");
  const qs = q.toString();
  return customFetch<{ data: PortalNotification[]; total: number; page: number; limit: number }>(
    `/api/notifications${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchNotificationUnreadCount() {
  return customFetch<{ count: number }>("/api/notifications/unread-count");
}

export async function markNotificationRead(id: number) {
  return customFetch<PortalNotification>(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead() {
  return customFetch<{ updated: number }>("/api/notifications/read-all", { method: "POST" });
}

export async function fetchMessageThreads(params?: { page?: number; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return customFetch<{ data: MessageThreadSummary[]; total: number }>(
    `/api/messages/threads${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchMessageUnreadCount() {
  return customFetch<{ count: number }>("/api/messages/unread-count");
}

export async function fetchMessageRecipients(search?: string) {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  return customFetch<MessageRecipient[]>(`/api/messages/recipients${q}`);
}

export async function createMessageThread(body: {
  recipientUserId: number;
  subject?: string;
  body?: string;
  patientId?: number | null;
}) {
  return customFetch<{ id: number; subject: string; reused?: boolean }>("/api/messages/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchMessageThread(id: number) {
  return customFetch<{
    id: number;
    subject: string;
    patientId: number | null;
    patientName: string | null;
    patientHisId: string | null;
    isClosed: boolean;
    participants: Array<{ id: number; name: string; role: string }>;
    messages: {
      data: Array<{
        id: number;
        threadId: number;
        senderUserId: number;
        senderName: string;
        body: string;
        isDeleted: boolean;
        createdAt: string;
      }>;
      total: number;
    };
  }>(`/api/messages/threads/${id}`);
}

export async function sendMessage(threadId: number, body: string) {
  return customFetch(`/api/messages/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function markMessageThreadRead(threadId: number) {
  return customFetch<{ ok: boolean }>(`/api/messages/threads/${threadId}/read`, { method: "POST" });
}

export async function closeMessageThread(threadId: number) {
  return customFetch(`/api/messages/threads/${threadId}/close`, { method: "POST" });
}

export async function deleteMessageThread(threadId: number) {
  return customFetch<{ id: number }>(`/api/messages/threads/${threadId}`, { method: "DELETE" });
}

export async function fetchAnnouncements(params?: { includeDrafts?: boolean; page?: number }) {
  const q = new URLSearchParams();
  if (params?.includeDrafts) q.set("includeDrafts", "1");
  if (params?.page) q.set("page", String(params.page));
  const qs = q.toString();
  return customFetch<{ data: Announcement[]; total: number }>(
    `/api/announcements${qs ? `?${qs}` : ""}`,
  );
}

export async function createAnnouncement(body: {
  title: string;
  body: string;
  priority: string;
  targets: Array<{ targetType: string; targetValue?: string | null }>;
  expiresAt?: string | null;
}) {
  return customFetch<Announcement>("/api/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function publishAnnouncement(id: number) {
  return customFetch<Announcement>(`/api/announcements/${id}/publish`, { method: "POST" });
}
