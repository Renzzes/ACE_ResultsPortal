import sql from "mssql";
import { loadDbConfig } from "./config";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value.trim();
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for ${name}.`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error(`Invalid boolean for ${name}.`);
}

/**
 * ShanScheduler connection settings. Falls back to portal DB_* for host/credentials.
 * Never uses the portal application database name as the scheduler database.
 */
export function loadSchedulerDbConfig(): {
  server: string;
  port: number;
  instanceName?: string;
  user: string;
  password: string;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  poolMax: number;
  poolMin: number;
  poolIdleTimeoutMs: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
} {
  const portal = loadDbConfig();
  const database =
    optional("SCHEDULER_DB_DATABASE") ??
    optional("SHANSCHEDULER_DB_DATABASE") ??
    optional("SHAN_SCHEDULER_DB_DATABASE");
  if (!database) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }
  if (!IDENTIFIER.test(database)) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }
  if (database.toLowerCase() === portal.database.toLowerCase()) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }

  return {
    server: optional("SCHEDULER_DB_SERVER") ?? portal.server,
    port: integer("SCHEDULER_DB_PORT", portal.port),
    instanceName: optional("SCHEDULER_DB_INSTANCE") ?? portal.instanceName,
    user: optional("SCHEDULER_DB_USER") ?? portal.user,
    password: optional("SCHEDULER_DB_PASSWORD") ?? portal.password,
    database,
    encrypt: boolean("SCHEDULER_DB_ENCRYPT", portal.encrypt),
    trustServerCertificate: boolean(
      "SCHEDULER_DB_TRUST_SERVER_CERTIFICATE",
      portal.trustServerCertificate,
    ),
    poolMax: integer("SCHEDULER_DB_POOL_MAX", Math.min(portal.poolMax, 5)),
    poolMin: integer("SCHEDULER_DB_POOL_MIN", 0),
    poolIdleTimeoutMs: integer("SCHEDULER_DB_POOL_IDLE_TIMEOUT_MS", portal.poolIdleTimeoutMs),
    connectionTimeoutMs: integer("SCHEDULER_DB_CONNECTION_TIMEOUT_MS", portal.connectionTimeoutMs),
    requestTimeoutMs: integer("SCHEDULER_DB_REQUEST_TIMEOUT_MS", portal.requestTimeoutMs),
  };
}

let schedulerPool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

function buildSchedulerConfig(): sql.config {
  const cfg = loadSchedulerDbConfig();
  return {
    server: cfg.server,
    port: cfg.instanceName ? undefined : cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    pool: {
      max: cfg.poolMax,
      min: cfg.poolMin,
      idleTimeoutMillis: cfg.poolIdleTimeoutMs,
    },
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
      enableArithAbort: true,
      ...(cfg.instanceName ? { instanceName: cfg.instanceName } : {}),
    },
    connectionTimeout: cfg.connectionTimeoutMs,
    requestTimeout: cfg.requestTimeoutMs,
  };
}

export async function getSchedulerPool(): Promise<sql.ConnectionPool> {
  if (schedulerPool?.connected) return schedulerPool;
  if (connecting) return connecting;

  connecting = (async () => {
    const next = new sql.ConnectionPool(buildSchedulerConfig());
    next.on("error", () => {
      /* errors surface on request; never log credentials */
    });
    await next.connect();
    schedulerPool = next;
    return next;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function schedulerRequest(): Promise<sql.Request> {
  const pool = await getSchedulerPool();
  return pool.request();
}

export async function checkSchedulerConnectivity(): Promise<boolean> {
  const req = await schedulerRequest();
  const result = await req.query("SELECT 1 AS ok");
  return Number((result.recordset[0] as { ok?: number } | undefined)?.ok) === 1;
}

export async function closeSchedulerPool(): Promise<void> {
  if (schedulerPool) {
    await schedulerPool.close();
    schedulerPool = null;
  }
}

export { sql as schedulerSql };
