/**
 * Production app .env handling.
 *
 * First install: merge repo .env secrets + .env.production overlay (production wins).
 * Upgrade: preserve runtime .env; append missing keys from production then secrets.
 *
 * Usage: node scripts/apply-production-env.mjs <appDir> <productionTemplate> [secretsTemplate]
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  statSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function clearWindowsHidden(filePath) {
  if (process.platform !== "win32" || !filePath) return;
  spawnSync("attrib", ["-H", "-S", filePath], { windowsHide: true, stdio: "ignore" });
}

const SECRET_KEY_PATTERN = /(PASSWORD|SECRET|TOKEN|KEY|JWT|PASS|PRIVATE)/i;

export function parseEnvMap(filePath) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!map.has(key)) map.set(key, rawLine.slice(eq + 1));
  }
  return map;
}

export function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * @param {string | undefined} secretsPath
 * @param {string} productionPath
 */
export function buildMergedEnvMap(secretsPath, productionPath) {
  /** @type {Map<string, string>} */
  const merged = new Map();
  if (secretsPath && existsSync(secretsPath) && statSync(secretsPath).isFile()) {
    for (const [key, value] of parseEnvMap(secretsPath).entries()) {
      if (String(value).trim() !== "") merged.set(key, value);
    }
  }
  if (!existsSync(productionPath) || !statSync(productionPath).isFile()) {
    throw new Error("template .env.production is missing or unreadable");
  }
  for (const [key, value] of parseEnvMap(productionPath).entries()) {
    if (String(value).trim() !== "") merged.set(key, value);
  }
  return merged;
}

export function renderEnvMap(map) {
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

/**
 * @param {{ appDir: string, templatePath: string, secretsPath?: string }} options
 */
export function applyProductionEnv({ appDir, templatePath, secretsPath }) {
  if (!templatePath || !existsSync(templatePath) || !statSync(templatePath).isFile()) {
    throw new Error("template .env.production is missing or unreadable");
  }
  if (!appDir) throw new Error("appDir is required");

  const dest = path.join(appDir, ".env");
  const mergedMap = buildMergedEnvMap(secretsPath, templatePath);

  if (!existsSync(dest)) {
    writeFileSync(dest, renderEnvMap(mergedMap), "utf8");
    clearWindowsHidden(dest);
    if (!existsSync(dest) || !statSync(dest).isFile()) {
      throw new Error("failed to create runtime .env from merged templates");
    }
    readFileSync(dest, "utf8");
    return { mode: "created", dest, appendedKeys: [] };
  }

  clearWindowsHidden(dest);
  readFileSync(dest, "utf8");
  const dstMap = parseEnvMap(dest);
  /** @type {string[]} */
  const appendedKeys = [];

  for (const [key, value] of mergedMap.entries()) {
    if (dstMap.has(key)) continue;
    appendFileSync(dest, `\n${key}=${value}`, "utf8");
    appendedKeys.push(key);
  }

  if (!existsSync(dest) || !statSync(dest).isFile()) {
    throw new Error("runtime .env disappeared after merge");
  }
  readFileSync(dest, "utf8");
  return { mode: "merged", dest, appendedKeys };
}

function safeLog(result, secretsPath) {
  if (result.mode === "created") {
    console.log(
      `[apply-production-env] Created runtime .env from merged templates (production +${secretsPath ? " repo .env secrets" : ""})`,
    );
    console.log("[apply-production-env] Verified .env exists and is readable");
    return;
  }
  console.log("[apply-production-env] Preserved existing runtime .env");
  if (result.appendedKeys.length === 0) {
    console.log("[apply-production-env] No missing keys to merge");
  } else {
    const names = result.appendedKeys.map((k) => (isSecretKey(k) ? `${k} (value hidden)` : k));
    console.log(`[apply-production-env] Appended missing keys (names only): ${names.join(", ")}`);
  }
  console.log("[apply-production-env] Verified .env exists and is readable");
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    const secretsPath = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
    const result = applyProductionEnv({
      appDir: process.argv[2],
      templatePath: process.argv[3],
      secretsPath,
    });
    safeLog(result, secretsPath);
  } catch (err) {
    console.error(`[apply-production-env] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
