/**
 * Post-sync verification — proves dist/ was copied to the production app tree.
 *
 * Usage: node scripts/verify-deployed-production.mjs <APP_DIR> <DEPLOY_RUN_ID> <LOG_DIR>
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.resolve(process.argv[2] || "");
const deployRunId = String(process.env.ACERPTS_DEPLOY_RUN_ID || process.argv[3] || "").trim();
const logDir = path.resolve(process.env.ACERPTS_VERIFY_LOG_DIR || process.argv[4] || "");

function fail(message) {
  console.error(`[verify-deployed-production] ${message}`);
  process.exit(1);
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function requireFile(full, label) {
  if (!existsSync(full) || !statSync(full).isFile()) {
    fail(`missing ${label}: ${full}`);
  }
}

function compareHash(distRel, appRel, label) {
  const distPath = path.join(rootDir, "dist", distRel);
  const appPath = path.join(appDir, appRel);
  requireFile(distPath, `dist ${label}`);
  requireFile(appPath, `deployed ${label}`);
  const distHash = sha256(distPath);
  const appHash = sha256(appPath);
  if (distHash !== appHash) {
    fail(
      `${label} hash mismatch (dist ${distHash.slice(0, 12)}… ≠ app ${appHash.slice(0, 12)}…). Sync did not copy the current build.`,
    );
  }
  console.log(`[verify-deployed-production] OK hash ${label}`);
  return distHash;
}

if (!appDir) fail("APP_DIR argument required");
if (!deployRunId) fail("DEPLOY_RUN_ID argument required");
if (!logDir) fail("LOG_DIR argument required");

const entryHash = compareHash(
  path.join("server", "index.mjs"),
  path.join("server", "index.mjs"),
  "server/index.mjs",
);
compareHash(path.join("client", "index.html"), path.join("client", "index.html"), "client/index.html");

const distClientRoot = path.join(rootDir, "dist", "client");
const appClientRoot = path.join(appDir, "client");
const publicRootFiles = readdirSync(distClientRoot).filter((name) => {
  const full = path.join(distClientRoot, name);
  return name !== "assets" && statSync(full).isFile();
});
if (publicRootFiles.length < 1) {
  fail(`dist client has no public root files: ${distClientRoot}`);
}
for (const name of publicRootFiles) {
  compareHash(path.join("client", name), path.join("client", name), `client/${name}`);
}
console.log(`[verify-deployed-production] OK client public root files (${publicRootFiles.length} file(s))`);

const assetsDir = path.join(appDir, "client", "assets");
if (!existsSync(assetsDir)) fail(`missing client assets directory: ${assetsDir}`);
const assetCount = readdirSync(assetsDir).filter((name) => statSync(path.join(assetsDir, name)).isFile()).length;
if (assetCount < 1) fail(`deployed client assets directory is empty: ${assetsDir}`);
console.log(`[verify-deployed-production] OK client assets (${assetCount} file(s))`);

const markerPath = path.join(logDir, `deploy-run-${deployRunId}.sync.ok`);
const markerBody = [
  `DEPLOY_RUN_ID=${deployRunId}`,
  `APP_DIR=${appDir}`,
  `SYNCED_AT=${new Date().toISOString()}`,
  `SERVER_SHA256=${entryHash}`,
].join("\n");
writeFileSync(markerPath, markerBody + "\n", "utf8");
console.log(`[verify-deployed-production] OK marker ${markerPath}`);
console.log("[verify-deployed-production] DEPLOYMENT SYNC VERIFIED");
