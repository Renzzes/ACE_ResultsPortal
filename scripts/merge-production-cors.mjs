/**
 * Append detected LAN / hostname / localhost origins to CORS_ORIGIN.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const appDir = process.argv[2] || "C:\\ACERPTS\\app";
const envPath = path.join(appDir, ".env");
if (!existsSync(envPath)) {
  console.error("[merge-production-cors] .env missing");
  process.exit(1);
}

const text = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
const portMatch = text.match(/^\s*PORT\s*=\s*(\d+)/m);
const port = portMatch ? Number(portMatch[1]) : 3003;
const corsMatch = text.match(/^\s*CORS_ORIGIN\s*=\s*(.+)$/m);
const existing = corsMatch
  ? corsMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s && !/REPLACE_WITH/i.test(s))
  : [];

const required = [];
function add(origin) {
  if (origin && !required.includes(origin)) required.push(origin);
}
for (const origin of existing) add(origin);

const nets = os.networkInterfaces();
for (const addrs of Object.values(nets)) {
  for (const addr of addrs || []) {
    if (addr.family !== "IPv4" && addr.family !== 4) continue;
    if (addr.internal) continue;
    if (addr.address.startsWith("169.254.")) continue;
    add(`http://${addr.address}:${port}`);
  }
}
const hostname = os.hostname().trim();
if (hostname) add(`http://${hostname}:${port}`);
add(`http://localhost:${port}`);
add(`http://127.0.0.1:${port}`);

const joined = required.join(",");
let next = text;
if (/^\s*CORS_ORIGIN\s*=/m.test(next)) {
  next = next.replace(/^\s*CORS_ORIGIN\s*=.*$/m, `CORS_ORIGIN=${joined}`);
} else {
  if (!next.endsWith("\n")) next += "\n";
  next += `CORS_ORIGIN=${joined}\n`;
}
if (process.platform === "win32") {
  spawnSync("attrib", ["-H", "-S", envPath], { windowsHide: true, stdio: "ignore" });
}
writeFileSync(envPath, next, "utf8");
console.log(`[merge-production-cors] CORS_ORIGIN=${joined}`);
