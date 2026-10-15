import sql from "mssql";
import { loadDbConfig } from "./config";

let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

function buildConfig(): sql.config {
  const cfg = loadDbConfig();
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

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (connecting) return connecting;

  connecting = (async () => {
    const next = new sql.ConnectionPool(buildConfig());
    next.on("error", () => {
      /* connection errors surface on request; avoid logging credentials */
    });
    await next.connect();
    pool = next;
    return next;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function initDb(): Promise<void> {
  const connected = await getPool();
  await connected.request().query("SELECT 1 AS ok");
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export async function withTransaction<T>(
  work: (tx: sql.Transaction) => Promise<T>,
): Promise<T> {
  const connected = await getPool();
  const tx = new sql.Transaction(connected);
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* rollback may fail if the connection is already dead */
    }
    throw err;
  }
}

export function request(tx?: sql.Transaction): sql.Request {
  if (tx) return new sql.Request(tx);
  if (!pool?.connected) {
    throw new Error("Database pool is not initialized. Call initDb() first.");
  }
  return pool.request();
}

export { sql };
