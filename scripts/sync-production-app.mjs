/**
 * Copy assembled dist/ into C:\ACERPTS\app (or D:\ACERPTS\app).
 *
 * Usage: node scripts/sync-production-app.mjs [C:\ACERPTS\app]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const appDir = path.resolve(process.argv[2] || "C:\\ACERPTS\\app");
const deployRunId = String(process.env.ACERPTS_DEPLOY_RUN_ID || "").trim();
const apiPkgPath = path.join(rootDir, "artifacts", "api-server", "package.json");

function fail(message) {
  console.error(`[sync-production-app] ${message}`);
  process.exit(1);
}

function requireFile(full, label) {
  if (!existsSync(full) || !statSync(full).isFile()) fail(`missing ${label}: ${full}`);
}

requireFile(path.join(distDir, "server", "index.mjs"), "assembled server entry");
requireFile(path.join(distDir, "client", "index.html"), "assembled SPA");

const apiPkg = JSON.parse(readFileSync(apiPkgPath, "utf8"));
const versionInfo = existsSync(path.join(rootDir, "version.json"))
  ? JSON.parse(readFileSync(path.join(rootDir, "version.json"), "utf8"))
  : { version: "0.0.0" };
const appVersion = String(versionInfo.version || "0.0.0");

mkdirSync(appDir, { recursive: true });

const serverOut = path.join(appDir, "server");
const clientOut = path.join(appDir, "client");

if (existsSync(serverOut)) rmSync(serverOut, { recursive: true, force: true });
cpSync(path.join(distDir, "server"), serverOut, { recursive: true });

if (existsSync(clientOut)) rmSync(clientOut, { recursive: true, force: true });
cpSync(path.join(distDir, "client"), clientOut, { recursive: true });

const runtimeDeps = Object.fromEntries(
  Object.entries(apiPkg.dependencies || {}).filter(([, value]) => !String(value).startsWith("workspace:")),
);

writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "acemcc-acerpts",
      version: appVersion,
      private: true,
      type: "module",
      description: "ACE Results Portal production runtime (ACERPTS_OneClick.bat)",
      scripts: { start: "node server/index.mjs" },
      engines: { node: ">=20" },
      dependencies: runtimeDeps,
    },
    null,
    2,
  ) + "\n",
);

if (existsSync(path.join(rootDir, "version.json"))) {
  cpSync(path.join(rootDir, "version.json"), path.join(appDir, "version.json"));
}
if (existsSync(path.join(distDir, "BUILD_INFO.txt"))) {
  cpSync(path.join(distDir, "BUILD_INFO.txt"), path.join(appDir, "BUILD_INFO.txt"));
}
const serviceLauncher = path.join(rootDir, "scripts", "run-acerpts-service.cmd");
if (existsSync(serviceLauncher)) {
  cpSync(serviceLauncher, path.join(appDir, "run-acerpts-service.cmd"));
}
const serviceWatchdog = path.join(rootDir, "scripts", "watch-acerpts-service.ps1");
if (existsSync(serviceWatchdog)) {
  cpSync(serviceWatchdog, path.join(appDir, "watch-acerpts-service.ps1"));
}

requireFile(path.join(serverOut, "index.mjs"), "production server entry");
requireFile(path.join(clientOut, "index.html"), "production client shell");

if (deployRunId) {
  console.log(`[sync-production-app] DEPLOY_RUN_ID=${deployRunId}`);
}
console.log(`[sync-production-app] Installed production tree → ${appDir}`);
console.log(`[sync-production-app] Entry: ${path.join(serverOut, "index.mjs")}`);
