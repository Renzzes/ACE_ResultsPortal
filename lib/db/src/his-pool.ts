import sql from "mssql";
import { loadDbConfig } from "./config";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value.trim();
}

/** HIS SQL credentials must be explicit; never fall back to portal DB_USER/DB_PASSWORD. */
function requiredHisCredential(name: string): string {
  const value = optional(name);
  if (value === undefined || value === "") {
    throw new Error(`${name} is required but was not provided.`);
  }
  return value;
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
 * LiveDB_ACE connection settings.
 * HIS_DB_USER / HIS_DB_PASSWORD are required (fail-closed; no portal credential fallback).
 * Host/port/TLS/pool may fall back to portal DB_* connection settings.
 * Never uses the portal application database name as the HIS database.
 */
export function loadHisDbConfig(): {
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
    optional("HIS_DB_DATABASE") ??
    optional("HOSPITAL_DB_DATABASE");
  if (!database) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }
  if (!IDENTIFIER.test(database)) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }
  if (database.toLowerCase() === portal.database.toLowerCase()) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }

  return {
    server: optional("HIS_DB_SERVER") ?? portal.server,
    port: integer("HIS_DB_PORT", portal.port),
    instanceName: optional("HIS_DB_INSTANCE") ?? portal.instanceName,
    user: requiredHisCredential("HIS_DB_USER"),
    password: requiredHisCredential("HIS_DB_PASSWORD"),
    database,
    encrypt: boolean("HIS_DB_ENCRYPT", portal.encrypt),
    trustServerCertificate: boolean(
      "HIS_DB_TRUST_SERVER_CERTIFICATE",
      portal.trustServerCertificate,
    ),
    poolMax: integer("HIS_DB_POOL_MAX", Math.min(portal.poolMax, 5)),
    poolMin: integer("HIS_DB_POOL_MIN", 0),
    poolIdleTimeoutMs: integer("HIS_DB_POOL_IDLE_TIMEOUT_MS", portal.poolIdleTimeoutMs),
    connectionTimeoutMs: integer("HIS_DB_CONNECTION_TIMEOUT_MS", portal.connectionTimeoutMs),
    requestTimeoutMs: integer("HIS_DB_REQUEST_TIMEOUT_MS", portal.requestTimeoutMs),
  };
}

let hisPool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

function buildHisConfig(): sql.config {
  const cfg = loadHisDbConfig();
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

export async function getHisPool(): Promise<sql.ConnectionPool> {
  if (hisPool?.connected) return hisPool;
  if (connecting) return connecting;

  connecting = (async () => {
    const next = new sql.ConnectionPool(buildHisConfig());
    next.on("error", () => {
      /* errors surface on request; never log credentials */
    });
    await next.connect();
    hisPool = next;
    return next;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function hisRequest(): Promise<sql.Request> {
  const pool = await getHisPool();
  return pool.request();
}

export async function checkHisConnectivity(): Promise<boolean> {
  const req = await hisRequest();
  const result = await req.query("SELECT 1 AS ok");
  return Number((result.recordset[0] as { ok?: number } | undefined)?.ok) === 1;
}

export async function closeHisPool(): Promise<void> {
  if (hisPool) {
    await hisPool.close();
    hisPool = null;
  }
}

export { sql as hisSql };
