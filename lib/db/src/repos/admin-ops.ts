import { getPool, request, sql } from "../pool";
import * as authSessionsRepo from "./auth-sessions";
import * as auditLogsRepo from "./audit-logs";
import { getPortalStorageCompactSummary } from "./portal-storage";

export type AdminAlert = {
  id: string;
  level: "ok" | "warn" | "info";
  title: string;
  body: string;
  time: string;
  href?: string;
};

export type AdminNotificationItem = {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  unread: boolean;
};

function relativeTime(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1h ago";
  if (hours < 48) return `${hours}h ago`;
  return date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function getAdminAlerts(): Promise<AdminAlert[]> {
  await getPool();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [denied, pending, storage] = await Promise.all([
    request()
      .input("since", sql.DateTimeOffset, since)
      .query(`
        SELECT COUNT(*) AS total
        FROM dbo.audit_logs
        WHERE action = N'access_denied' AND created_at >= @since
      `),
    request().query(`SELECT COUNT(*) AS total FROM dbo.results WHERE status = N'pending'`),
    getPortalStorageCompactSummary(),
  ]);

  const deniedCount = Number((denied.recordset[0] as { total: number }).total ?? 0);
  const pendingCount = Number((pending.recordset[0] as { total: number }).total ?? 0);
  const alerts: AdminAlert[] = [];

  if (deniedCount > 0) {
    alerts.push({
      id: "failed-logins",
      level: "warn",
      title: `${deniedCount} failed access attempt${deniedCount === 1 ? "" : "s"} (24h)`,
      body: "Review access_denied events in Audit Logs.",
      time: "Last 24h",
      href: "/admin/history",
    });
  }

  alerts.push({
    id: "api-health",
    level: "ok",
    title: "API connected",
    body: "Database pool responded for this monitor check.",
    time: "Live",
    href: "/admin/monitor",
  });

  if (pendingCount > 0) {
    alerts.push({
      id: "pending-results",
      level: "warn",
      title: `${pendingCount} result${pendingCount === 1 ? "" : "s"} pending release`,
      body: "Open Results Management to review pending work.",
      time: "Live",
      href: "/admin/results",
    });
  }

  if (storage.available && storage.databaseUsedPercent != null && storage.databaseUsedPercent >= 70) {
    alerts.push({
      id: "storage",
      level: storage.databaseUsedPercent >= 85 ? "warn" : "info",
      title: `Database allocation at ${storage.databaseUsedPercent}%`,
      body: "ACE_ResultsPortal allocated capacity is elevated.",
      time: "Live",
      href: "/admin/storage",
    });
  }

  if (alerts.length === 1) {
    alerts.push({
      id: "quiet",
      level: "info",
      title: "No critical alerts",
      body: "Pending work and failed logins are within quiet levels.",
      time: "Live",
    });
  }

  return alerts;
}

export async function getAdminNotifications(): Promise<AdminNotificationItem[]> {
  await getPool();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [pending, denied, storage, recentDenied] = await Promise.all([
    request().query(`SELECT COUNT(*) AS total FROM dbo.results WHERE status = N'pending'`),
    request()
      .input("since", sql.DateTimeOffset, since)
      .query(`
        SELECT COUNT(*) AS total
        FROM dbo.audit_logs
        WHERE action = N'access_denied' AND created_at >= @since
      `),
    getPortalStorageCompactSummary(),
    request()
      .input("since", sql.DateTimeOffset, since)
      .query(`
        SELECT TOP (5) id, details, created_at, user_name, patient_his_id
        FROM dbo.audit_logs
        WHERE action = N'access_denied' AND created_at >= @since
        ORDER BY created_at DESC
      `),
  ]);

  const items: AdminNotificationItem[] = [];
  const pendingCount = Number((pending.recordset[0] as { total: number }).total ?? 0);
  if (pendingCount > 0) {
    items.push({
      id: `pending-${pendingCount}`,
      title: `${pendingCount} results pending release`,
      body: "Review and release diagnostic results awaiting action.",
      href: "/admin/results",
      createdAt: new Date().toISOString(),
      unread: true,
    });
  }

  const deniedCount = Number((denied.recordset[0] as { total: number }).total ?? 0);
  if (deniedCount > 0) {
    items.push({
      id: `denied-${deniedCount}`,
      title: `${deniedCount} access denied event${deniedCount === 1 ? "" : "s"} (7d)`,
      body: "Security events recorded in audit logs.",
      href: "/admin/history",
      createdAt: new Date().toISOString(),
      unread: true,
    });
  }

  if (storage.available && storage.databaseUsedPercent != null) {
    items.push({
      id: `storage-${storage.databaseUsedPercent}`,
      title: `Database allocation ${storage.databaseUsedPercent}% used`,
      body: `ACE_ResultsPortal allocated ${storage.databaseAllocatedGB ?? 0} GB.`,
      href: "/admin/storage",
      createdAt: new Date().toISOString(),
      unread: storage.databaseUsedPercent >= 70,
    });
  }

  for (const row of recentDenied.recordset as Array<Record<string, unknown>>) {
    const createdAt = new Date(String(row.created_at));
    items.push({
      id: `audit-${row.id}`,
      title: "Access denied",
      body: [row.user_name, row.patient_his_id, row.details].filter(Boolean).join(" · ") || "Failed access attempt",
      href: "/admin/history",
      createdAt: createdAt.toISOString(),
      unread: Date.now() - createdAt.getTime() < 24 * 60 * 60 * 1000,
    });
  }

  return items.slice(0, 20);
}

export async function getAdminMonitorSnapshot() {
  const [sessions, sessionCount, alerts, activity, pending, uploadsToday] = await Promise.all([
    authSessionsRepo.listActiveSessions(40),
    authSessionsRepo.countActiveSessions(),
    getAdminAlerts(),
    auditLogsRepo.listRecentActivity(20),
    request().query(`SELECT COUNT(*) AS total FROM dbo.results WHERE status = N'pending'`),
    request()
      .input("today", sql.DateTimeOffset, (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      })())
      .query(`SELECT COUNT(*) AS total FROM dbo.results WHERE uploaded_at >= @today`),
  ]);

  return {
    openSessions: sessionCount,
    pendingWork: Number((pending.recordset[0] as { total: number }).total ?? 0),
    uploadsToday: Number((uploadsToday.recordset[0] as { total: number }).total ?? 0),
    sessions: sessions.map((session) => ({
      id: String(session.id),
      name: `${session.firstName} ${session.lastName}`.trim() || session.username,
      role: session.role,
      username: session.username,
      status: session.status,
      started: (session.lastUsedAt ?? session.createdAt).toLocaleTimeString("en-PH", {
        hour: "numeric",
        minute: "2-digit",
      }),
      detail: relativeTime(session.lastUsedAt ?? session.createdAt),
    })),
    alerts: alerts.map((alert) => ({
      ...alert,
      time: alert.time,
    })),
    activity: activity.map((item) => ({
      id: item.id,
      action: item.action,
      userName: item.userName,
      details: item.details,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}
