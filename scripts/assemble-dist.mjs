/**
 * Assemble production artifacts for ACERPTS_OneClick deployment.
 *
 * Inputs:
 *   artifacts/api-server/dist/index.mjs
 *   artifacts/ace-results-portal/dist/public/{index.html,assets}
 *
 * Output:
 *   dist/server/index.mjs + dist/client/{index.html,assets}
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDist = path.join(rootDir, "artifacts", "api-server", "dist");
const portalDist = path.join(rootDir, "artifacts", "ace-results-portal", "dist", "public");
const outDir = path.join(rootDir, "dist");

function fail(message) {
  console.error(`[assemble-dist] ${message}`);
  process.exit(1);
}

function requireFile(full, label) {
  if (!existsSync(full) || !statSync(full).isFile()) {
    fail(`missing ${label}: ${full}`);
  }
}

function requireDir(full, label) {
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    fail(`missing ${label}: ${full}`);
  }
}

requireFile(path.join(apiDist, "index.mjs"), "api-server build entry");
requireFile(path.join(portalDist, "index.html"), "portal index.html");
requireDir(path.join(portalDist, "assets"), "portal assets");

const assetFiles = readdirSync(path.join(portalDist, "assets"));
if (assetFiles.length === 0) {
  fail("portal assets directory is empty");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "server"), { recursive: true });
mkdirSync(path.join(outDir, "client", "assets"), { recursive: true });

cpSync(apiDist, path.join(outDir, "server"), { recursive: true });
cpSync(path.join(portalDist, "index.html"), path.join(outDir, "client", "index.html"));
cpSync(path.join(portalDist, "assets"), path.join(outDir, "client", "assets"), { recursive: true });

let publicRootCount = 0;
for (const name of readdirSync(portalDist)) {
  if (name === "index.html" || name === "assets") continue;
  const src = path.join(portalDist, name);
  if (!statSync(src).isFile()) continue;
  cpSync(src, path.join(outDir, "client", name));
  publicRootCount += 1;
}

const versionPath = path.join(rootDir, "version.json");
let appVersion = "0.0.0";
if (existsSync(versionPath)) {
  cpSync(versionPath, path.join(outDir, "version.json"));
  try {
    appVersion = String(JSON.parse(readFileSync(versionPath, "utf8")).version || "0.0.0");
  } catch {
    // keep default
  }
}

writeFileSync(
  path.join(outDir, "BUILD_INFO.txt"),
  [
    `builtAt=${new Date().toISOString()}`,
    `node=${process.version}`,
    `serverSource=artifacts/api-server/dist`,
    `clientSource=artifacts/ace-results-portal/dist/public`,
    `version=${appVersion}`,
  ].join("\n") + "\n",
);

console.log(`[assemble-dist] server entry: dist/server/index.mjs`);
console.log(`[assemble-dist] client shell: dist/client/index.html`);
console.log(`[assemble-dist] client assets: ${assetFiles.length} file(s)`);
console.log(`[assemble-dist] client public root files: ${publicRootCount} file(s)`);
console.log("BUILD SUCCESS");
