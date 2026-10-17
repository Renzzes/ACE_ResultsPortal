/**
 * Fail-closed guard: synthetic upload tests must never resolve to production storage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FORBIDDEN_ROOTS = [
  "D:\\ACERPTS\\storage",
  "C:\\ACERPTS\\storage",
];

export function normalizeStoragePath(p: string): string {
  return path.resolve(p).replace(/\//g, "\\").toLowerCase();
}

export function assertIsolatedStorageRoot(root: string): void {
  const normalized = normalizeStoragePath(root);
  for (const forbidden of FORBIDDEN_ROOTS) {
    const f = normalizeStoragePath(forbidden);
    if (normalized === f || normalized.startsWith(f + "\\")) {
      throw new Error(
        `REFUSING test storage root "${root}" — overlaps production storage "${forbidden}".`,
      );
    }
  }
}

export function createIsolatedResultStorageRoot(label = "doc-access"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `acerpts-test-storage-${label}-`));
  assertIsolatedStorageRoot(root);
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(root, "results"), { recursive: true });
  return root;
}

export function applyIsolatedStorageEnv(root: string): void {
  assertIsolatedStorageRoot(root);
  process.env.RESULT_STORAGE_ROOT = root;
}
