/**
 * Validate production .env.production key presence (names only).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED = [
  "PORT",
  "HOST",
  "NODE_ENV",
  "CORS_ORIGIN",
  "JWT_SECRET",
  "DB_SERVER",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_DATABASE",
  "HOSPITAL_DB_DATABASE",
  "HIS_DB_USER",
  "HIS_DB_PASSWORD",
  "RESULT_STORAGE_ROOT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "PORTAL_EMAIL_FROM",
];

export const OPTIONAL = [
  "LOG_LEVEL",
  "JWT_EXPIRES_IN",
  "DB_INSTANCE",
  "DB_ENCRYPT",
  "DB_TRUST_SERVER_CERTIFICATE",
  "DB_POOL_MAX",
  "DB_POOL_MIN",
  "DB_POOL_IDLE_TIMEOUT_MS",
  "DB_CONNECTION_TIMEOUT_MS",
  "DB_REQUEST_TIMEOUT_MS",
  "HIS_DB_SERVER",
  "HIS_DB_PORT",
  "HIS_DB_DATABASE",
  "RESULT_MAX_FILE_BYTES",
  "ACERPTS_ROOT",
];

export function parseEnvKeys(filePath) {
  const map = new Map();
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value.trim() !== "");
  }
  return map;
}

export function status(map, key) {
  if (!map.has(key)) return "MISSING";
  return map.get(key) ? "PRESENT" : "EMPTY";
}

export function validateProductionEnvFile(envPath, options = {}) {
  const silent = options.silent === true;
  if (!existsSync(envPath)) {
    if (!silent) {
      console.error(`[validate-production-env] ERROR: file not found: ${envPath}`);
    }
    return { ok: false, missingRequired: ["(file not found)"], emptyRequired: [], statuses: {} };
  }

  const keys = parseEnvKeys(envPath);
  const missingRequired = [];
  const emptyRequired = [];
  const statuses = {};

  for (const key of REQUIRED) {
    const st = status(keys, key);
    statuses[key] = st;
    if (st === "MISSING") missingRequired.push(key);
    else if (st === "EMPTY") emptyRequired.push(key);
  }
  for (const key of OPTIONAL) {
    statuses[key] = status(keys, key);
  }

  if (!silent) {
    console.log("");
    console.log("[validate-production-env] Production environment check");
    console.log(`  file: ${envPath}`);
    console.log("----------------------------------------");
    for (const key of REQUIRED) {
      console.log(`  ${key}=${statuses[key]}`);
    }
    console.log("----------------------------------------");
    for (const key of OPTIONAL) {
      console.log(`  (optional) ${key}=${statuses[key]}`);
    }
    console.log("----------------------------------------");
  }

  const ok = missingRequired.length === 0 && emptyRequired.length === 0;
  if (!silent) {
    if (!ok) {
      console.error("[validate-production-env] BUILD MUST FAIL — incomplete .env.production");
      for (const key of missingRequired) {
        console.error(`ERROR: Missing required production environment variable: ${key}`);
      }
      for (const key of emptyRequired) {
        console.error(`ERROR: Empty required production environment variable: ${key}`);
      }
    } else {
      console.log("[validate-production-env] OK — required environment variable names present.");
      console.log("");
    }
  }

  return { ok, missingRequired, emptyRequired, statuses };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const envPath = path.resolve(process.argv[2] || path.join(rootDir, ".env.production"));
  const result = validateProductionEnvFile(envPath);
  process.exit(result.ok ? 0 : 1);
}
