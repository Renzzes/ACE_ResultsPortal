import fs from "node:fs";
import { getPool, request, sql } from "../pool";
import { getStorageRoot } from "../result-files";
import { getPortalStorageCompactSummary, type PortalStorageCompactSummary } from "./portal-storage";
import * as auditLogsRepo from "./audit-logs";
import type { AuditLog } from "../types";

export type AdminOverviewMetrics = {
  totalPatients: number;
  staffAccounts: number;
  doctorAccounts: number;
  totalResults: number;
  pendingRelease: number;
  totalReleased: number;
  totalArchived: number;
  uploadsToday: number;
};

export type AdminOverviewSeriesPoint = {
  date: string;
  uploaded: number;
  released: number;
  registrations: number;
  logins: number;
};

export type AdminOverviewRegistration = {
  id: number;
  firstName: string;
  lastName: string;
  middleName: string | null;
  patientHisId: string;
  createdAt: string;
};

export type AdminOverviewPendingResult = {
  id: number;
  originalFileName: string;
  category: string;
  status: string;
  uploadedAt: string;
  patientHisId: string;
  patientFirstName: string;
  patientLastName: string;
};

export type AdminOverviewHealthItem = {
  id: string;
  name: string;
  state: "Operational" | "Critical" | "Not monitored";
  detail: string;
};

export type AdminOverviewResponse = {
  metrics: AdminOverviewMetrics;
  activity: AuditLog[];
  recentRegistrations: AdminOverviewRegistration[];
  pendingResults: AdminOverviewPendingResult[];
  systemOverview: {
    days: number;
    points: AdminOverviewSeriesPoint[];
    hasData: boolean;
  };
  systemHealth: {
    overall: "ok" | "degraded" | "unknown";
    items: AdminOverviewHealthItem[];
  };
  storage: PortalStorageCompactSummary;
  messagingAvailable: boolean;
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fillSeries(
  days: number,
  uploaded: Map<string, number>,
  released: Map<string, number>,
  registrations: Map<string, number>,
  logins: Map<string, number>,
): AdminOverviewSeriesPoint[] {
  const points: AdminOverviewSeriesPoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - i);
    const key = toIsoDate(day);
    points.push({
      date: key,
      uploaded: uploaded.get(key) ?? 0,
      released: released.get(key) ?? 0,
      registrations: registrations.get(key) ?? 0,
      logins: logins.get(key) ?? 0,
    });
  }
  return points;
}

async function loadMetrics(): Promise<AdminOverviewMetrics> {
  await getPool();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [patients, users, results] = await Promise.all([
    request().query(`
      SELECT COUNT(*) AS total
      FROM dbo.patients p
      INNER JOIN dbo.users u ON u.id = p.portal_user_id
      WHERE p.portal_user_id IS NOT NULL AND u.role = N'patient'
    `),
    request().query(`
      SELECT
        SUM(CASE WHEN role <> N'physician' AND role <> N'patient' AND is_active = 1 THEN 1 ELSE 0 END) AS staffAccounts,
        SUM(CASE WHEN role = N'physician' AND is_active = 1 THEN 1 ELSE 0 END) AS doctorAccounts
      FROM dbo.users
    `),
    request()
      .input("today", sql.DateTimeOffset, today)
      .query(`
        SELECT
          COUNT(*) AS totalResults,
          SUM(CASE WHEN status = N'pending' THEN 1 ELSE 0 END) AS pendingRelease,
          SUM(CASE WHEN status = N'released' THEN 1 ELSE 0 END) AS totalReleased,
          SUM(CASE WHEN status = N'archived' THEN 1 ELSE 0 END) AS totalArchived,
          SUM(CASE WHEN uploaded_at >= @today THEN 1 ELSE 0 END) AS uploadsToday
        FROM dbo.results
      `),
  ]);

  const userRow = users.recordset[0] as { staffAccounts: number | null; doctorAccounts: number | null };
  const resultRow = results.recordset[0] as Record<string, unknown>;

  return {
    totalPatients: Number((patients.recordset[0] as { total: number }).total ?? 0),
    staffAccounts: Number(userRow.staffAccounts ?? 0),
    doctorAccounts: Number(userRow.doctorAccounts ?? 0),
    totalResults: Number(resultRow.totalResults ?? 0),
    pendingRelease: Number(resultRow.pendingRelease ?? 0),
    totalReleased: Number(resultRow.totalReleased ?? 0),
    totalArchived: Number(resultRow.totalArchived ?? 0),
    uploadsToday: Number(resultRow.uploadsToday ?? 0),
  };
}

async function loadDailyMap(
  query: string,
  since: Date,
): Promise<Map<string, number>> {
  const result = await request()
    .input("since", sql.DateTimeOffset, since)
    .query(query);
  const map = new Map<string, number>();
  for (const row of result.recordset as Array<{ date: string; count: number }>) {
    map.set(String(row.date), Number(row.count ?? 0));
  }
  return map;
}

async function loadSystemOverview(days: number): Promise<AdminOverviewResponse["systemOverview"]> {
  await getPool();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const [uploaded, released, registrations, logins] = await Promise.all([
    loadDailyMap(
      `SELECT CONVERT(char(10), SWITCHOFFSET(uploaded_at, 0), 23) AS [date], COUNT(*) AS [count]
       FROM dbo.results
       WHERE uploaded_at >= @since
       GROUP BY CONVERT(char(10), SWITCHOFFSET(uploaded_at, 0), 23)`,
      since,
    ),
    loadDailyMap(
      `SELECT CONVERT(char(10), SWITCHOFFSET(date_released, 0), 23) AS [date], COUNT(*) AS [count]
       FROM dbo.results
       WHERE date_released IS NOT NULL AND date_released >= @since
       GROUP BY CONVERT(char(10), SWITCHOFFSET(date_released, 0), 23)`,
      since,
    ),
    loadDailyMap(
      `SELECT CONVERT(char(10), SWITCHOFFSET(created_at, 0), 23) AS [date], COUNT(*) AS [count]
       FROM dbo.patients
       WHERE created_at >= @since
       GROUP BY CONVERT(char(10), SWITCHOFFSET(created_at, 0), 23)`,
      since,
    ),
    loadDailyMap(
      `SELECT CONVERT(char(10), SWITCHOFFSET(created_at, 0), 23) AS [date], COUNT(*) AS [count]
       FROM dbo.audit_logs
       WHERE action = N'login' AND created_at >= @since
       GROUP BY CONVERT(char(10), SWITCHOFFSET(created_at, 0), 23)`,
      since,
    ),
  ]);

  const points = fillSeries(days, uploaded, released, registrations, logins);
  const hasData = points.some(
    (p) => p.uploaded > 0 || p.released > 0 || p.registrations > 0 || p.logins > 0,
  );

  return { days, points, hasData };
}

async function loadRecentRegistrations(limit: number): Promise<AdminOverviewRegistration[]> {
  await getPool();
  const result = await request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        p.id, p.first_name, p.last_name, p.middle_name, p.patient_his_id, p.created_at
      FROM dbo.patients p
      INNER JOIN dbo.users u ON u.id = p.portal_user_id
      WHERE p.portal_user_id IS NOT NULL AND u.role = N'patient'
      ORDER BY p.created_at DESC
    `);

  return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    middleName: row.middle_name == null ? null : String(row.middle_name),
    patientHisId: String(row.patient_his_id ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

async function loadPendingResults(limit: number): Promise<AdminOverviewPendingResult[]> {
  await getPool();
  const result = await request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        r.id,
        r.original_file_name,
        r.category,
        r.status,
        r.uploaded_at,
        p.patient_his_id,
        p.first_name,
        p.last_name
      FROM dbo.results r
      INNER JOIN dbo.patients p ON p.id = r.patient_id
      WHERE r.status = N'pending'
      ORDER BY r.uploaded_at ASC
    `);

  return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    originalFileName: String(row.original_file_name ?? ""),
    category: String(row.category ?? ""),
    status: String(row.status ?? ""),
    uploadedAt: new Date(String(row.uploaded_at)).toISOString(),
    patientHisId: String(row.patient_his_id ?? ""),
    patientFirstName: String(row.first_name ?? ""),
    patientLastName: String(row.last_name ?? ""),
  }));
}

async function loadSystemHealth(): Promise<AdminOverviewResponse["systemHealth"]> {
  const items: AdminOverviewHealthItem[] = [
    { id: "web", name: "Web Application", state: "Not monitored", detail: "—" },
    { id: "api", name: "API", state: "Operational", detail: "Responding" },
    { id: "db", name: "Database", state: "Not monitored", detail: "—" },
    { id: "auth", name: "Authentication", state: "Not monitored", detail: "—" },
    { id: "files", name: "File Storage", state: "Not monitored", detail: "—" },
    { id: "backup", name: "Backup System", state: "Not monitored", detail: "—" },
  ];

  try {
    await getPool();
    await request().query(`SELECT 1 AS ok`);
    const dbItem = items.find((i) => i.id === "db");
    if (dbItem) {
      dbItem.state = "Operational";
      dbItem.detail = "Connected";
    }
  } catch {
    const dbItem = items.find((i) => i.id === "db");
    if (dbItem) {
      dbItem.state = "Critical";
      dbItem.detail = "Unreachable";
    }
    const apiItem = items.find((i) => i.id === "api");
    if (apiItem) {
      apiItem.state = "Critical";
      apiItem.detail = "Database dependency failed";
    }
  }

  try {
    const root = getStorageRoot();
    if (fs.existsSync(root)) {
      const filesItem = items.find((i) => i.id === "files");
      if (filesItem) {
        filesItem.state = "Operational";
        filesItem.detail = "Storage root present";
      }
    } else {
      const filesItem = items.find((i) => i.id === "files");
      if (filesItem) {
        filesItem.state = "Critical";
        filesItem.detail = "Storage root missing";
      }
    }
  } catch {
    const filesItem = items.find((i) => i.id === "files");
    if (filesItem) {
      filesItem.state = "Not monitored";
      filesItem.detail = "Unable to check";
    }
  }

  const critical = items.some((i) => i.state === "Critical");
  return {
    overall: critical ? "degraded" : "ok",
    items,
  };
}

export async function getAdminOverview(): Promise<AdminOverviewResponse> {
  const [metrics, activity, recentRegistrations, pendingResults, systemOverview, systemHealth, storage] =
    await Promise.all([
      loadMetrics(),
      auditLogsRepo.listRecentActivity(12),
      loadRecentRegistrations(8),
      loadPendingResults(8),
      loadSystemOverview(7),
      loadSystemHealth(),
      getPortalStorageCompactSummary(),
    ]);

  return {
    metrics,
    activity,
    recentRegistrations,
    pendingResults,
    systemOverview,
    systemHealth,
    storage,
    messagingAvailable: false,
  };
}
