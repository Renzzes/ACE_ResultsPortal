/**
 * Fail-closed check: HIS_DB_USER and HIS_DB_PASSWORD must be present and non-empty.
 * Prints only missing/empty key names (never values). Exit 0 on success, 1 on failure.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_HIS = ["HIS_DB_USER", "HIS_DB_PASSWORD"];

function parseEnv(filePath) {
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
    map.set(key, value.trim());
  }
  return map;
}

const envPath = path.resolve(process.argv[2] || "");
if (!envPath || !existsSync(envPath)) {
  process.stdout.write(REQUIRED_HIS.join(" "));
  process.exit(1);
}

const map = parseEnv(envPath);
const bad = [];
for (const key of REQUIRED_HIS) {
  const value = map.get(key);
  if (value === undefined || value === "") bad.push(key);
}

if (bad.length > 0) {
  process.stdout.write(bad.join(" "));
  process.exit(1);
}

process.exit(0);
