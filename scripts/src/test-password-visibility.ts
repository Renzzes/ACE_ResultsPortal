/**
 * Phase 4: Shared PasswordInput with show/hide; all password fields migrated.
 * Access-code fields are intentionally left separate.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/ace-results-portal/src");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("PasswordInput hides by default and toggles type only", () => {
  const source = read("components/ui/password-input.tsx");
  assert.match(source, /useState\(false\)/);
  assert.match(source, /type=\{visible \? "text" : "password"\}/);
  assert.match(source, /type="button"/);
  assert.match(source, /Show password/);
  assert.match(source, /Hide password/);
  assert.match(source, /EyeOff/);
  assert.match(source, /Eye/);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("console.log"), false);
});

test("auth and account forms use PasswordInput", () => {
  const files = [
    "pages/access.tsx",
    "pages/register.tsx",
    "pages/recover.tsx",
    "pages/settings/index.tsx",
    "pages/admin/settings.tsx",
    "pages/users/new.tsx",
    "components/admin/account-dialog.tsx",
    "components/staff/settings-dialog.tsx",
    "components/doctor/settings-dialog.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /PasswordInput/, `${file} must import/use PasswordInput`);
  }
});

test("no raw password Input remains outside PasswordInput and access-code unlock", () => {
  const files = walk(root);
  const offenders: string[] = [];
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (rel === "components/ui/password-input.tsx") continue;
    if (rel === "components/portal/results-unlock-dialog.tsx") continue;
    const source = fs.readFileSync(file, "utf8");
    // Direct Input type=password (not via PasswordInput internals)
    if (/<Input[^>]*type=["']password["']/.test(source)) offenders.push(rel);
    if (/type=\{[^}]*\? ["']text["'] : ["']password["']\}/.test(source) && !source.includes("PasswordInput")) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});

test("results unlock keeps access-code field separate from PasswordInput", () => {
  const source = read("components/portal/results-unlock-dialog.tsx");
  assert.equal(source.includes("PasswordInput"), false);
  assert.match(source, /showCode|access.?code/i);
});
