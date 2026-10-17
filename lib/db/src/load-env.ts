import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const REPO_MARKER = "pnpm-workspace.yaml";
const ENV_FILENAME = ".env";
const SERVER_ENTRY_NAMES = ["index.mjs", "index.js"] as const;

export interface RootEnvLoadResult {
  root: string;
  envPath: string;
  exists: boolean;
  loaded: boolean;
}

let cached: RootEnvLoadResult | null = null;

/** Test/handoff helper: clear cache so ACERPTS_ROOT / cwd changes take effect. */
export function resetRootEnvCache(): void {
  cached = null;
}

function hasProductionAppLayout(dir: string): boolean {
  const envPath = path.join(dir, ENV_FILENAME);
  if (!fs.existsSync(envPath) || !fs.statSync(envPath).isFile()) {
    return false;
  }
  return SERVER_ENTRY_NAMES.some((name) => {
    const entry = path.join(dir, "server", name);
    return fs.existsSync(entry) && fs.statSync(entry).isFile();
  });
}

function walkForProductionAppRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (hasProductionAppLayout(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function walkForRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, REPO_MARKER))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function findRepoRoot(): string {
  const configuredRoot = process.env.ACERPTS_ROOT?.trim();
  if (configuredRoot) {
    const resolved = path.resolve(configuredRoot);
    if (hasProductionAppLayout(resolved) || fs.existsSync(path.join(resolved, REPO_MARKER))) {
      return resolved;
    }
  }

  const fromProdModule = walkForProductionAppRoot(path.dirname(fileURLToPath(import.meta.url)));
  const fromProdCwd = walkForProductionAppRoot(process.cwd());
  if (fromProdModule && fromProdCwd && !samePath(fromProdModule, fromProdCwd)) {
    throw new Error(
      "Refusing to load environment: production app root from module path and process.cwd() do not match.",
    );
  }
  const productionRoot = fromProdModule ?? fromProdCwd;
  if (productionRoot) {
    return productionRoot;
  }

  const fromModule = walkForRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const fromCwd = walkForRepoRoot(process.cwd());

  if (fromModule && fromCwd && !samePath(fromModule, fromCwd)) {
    throw new Error(
      "Refusing to load environment: repository root from module path and process.cwd() do not match.",
    );
  }

  const root = fromModule ?? fromCwd;
  if (!root) {
    throw new Error(
      `Could not locate repository root (${REPO_MARKER}) or production app layout. Cannot resolve ${ENV_FILENAME}.`,
    );
  }
  return root;
}

/**
 * Loads `<repo-root>/.env` if present. Existing process.env values are preserved
 * (`override: false`). Never loads `.env.example` or other env variants.
 */
export function loadRootEnv(): RootEnvLoadResult {
  if (cached) {
    return cached;
  }

  const root = findRepoRoot();
  const envPath = path.join(root, ENV_FILENAME);
  const exists = fs.existsSync(envPath) && fs.statSync(envPath).isFile();

  if (exists) {
    dotenv.config({ path: envPath, override: false });
  }

  cached = { root, envPath, exists, loaded: exists };
  return cached;
}

loadRootEnv();
