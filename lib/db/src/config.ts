function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required but was not provided.`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
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

export interface DbConfig {
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
}

export function loadDbConfig(): DbConfig {
  const database = required("DB_DATABASE");
  const blocked = new Set([
    "CodeGeneratorDB",
    "LiveDB_ACE",
    "ACE_PatientPortal",
    "AI_HRIS",
    "ACEMCC_ITAssets",
    "BIOMETRIC",
    "AceVoicePortal",
    "BenAceQueueDB",
    "BenAnalyticsDB",
    "ReportServer",
    "ReportServerTempDB",
    "TrainingDB_AMCC",
  ]);
  if (blocked.has(database)) {
    throw new Error(
      `DB_DATABASE="${database}" is an existing hospital database and must not be used by ACE Results Portal.`,
    );
  }

  return {
    server: required("DB_SERVER"),
    port: integer("DB_PORT", 1433),
    instanceName: optional("DB_INSTANCE"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database,
    encrypt: boolean("DB_ENCRYPT", false),
    trustServerCertificate: boolean("DB_TRUST_SERVER_CERTIFICATE", true),
    poolMax: integer("DB_POOL_MAX", 10),
    poolMin: integer("DB_POOL_MIN", 0),
    poolIdleTimeoutMs: integer("DB_POOL_IDLE_TIMEOUT_MS", 30000),
    connectionTimeoutMs: integer("DB_CONNECTION_TIMEOUT_MS", 15000),
    requestTimeoutMs: integer("DB_REQUEST_TIMEOUT_MS", 30000),
  };
}
