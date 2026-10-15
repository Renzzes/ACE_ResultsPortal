/**
 * Verify production build artifacts before deploy / start.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const checks = [];

function ok(message) {
  checks.push({ ok: true, message });
  console.log(`[verify] OK   ${message}`);
}

function fail(message) {
  checks.push({ ok: false, message });
  console.error(`[verify] FAIL ${message}`);
}

function requireFile(rel) {
  const full = path.join(rootDir, rel);
  if (existsSync(full) && statSync(full).isFile()) ok(rel);
  else fail(`${rel} missing`);
}

function requireDir(rel) {
  const full = path.join(rootDir, rel);
  if (existsSync(full) && statSync(full).isDirectory()) ok(rel);
  else fail(`${rel} missing`);
}

console.log("");
console.log("========================================");
console.log(" ACE Results Portal — verify production build");
console.log("========================================");
console.log("");

requireFile("dist/server/index.mjs");
requireFile("dist/client/index.html");
requireDir("dist/client/assets");
requireFile("version.json");

for (const name of [
  "Register_Illustration.png",
  "logo_ace.png",
  "ACE-NOBG.png",
  "favicon_ace_logo.png",
  "patient-portrait.png",
]) {
  requireFile(`dist/client/${name}`);
}

const assetsDir = path.join(rootDir, "dist", "client", "assets");
if (existsSync(assetsDir)) {
  const files = readdirSync(assetsDir);
  if (files.length === 0) fail("dist/client/assets is empty");
  else ok(`dist/client/assets (${files.length} file(s))`);
}

const failed = checks.filter((c) => !c.ok);
console.log("");
if (failed.length > 0) {
  console.error(`[verify] ${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("[verify] All build checks passed.");
console.log("");
process.exit(0);
