import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { findRepoRoot } from "@workspace/db";

const repoRoot = findRepoRoot();
const openapiPath = path.join(repoRoot, "lib", "api-spec", "openapi.yaml");
const routesDir = path.join(repoRoot, "artifacts", "api-server", "src", "routes");

function listExpressRoutes(): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  for (const file of fs.readdirSync(routesDir).filter((name) => name.endsWith(".ts"))) {
    const text = fs.readFileSync(path.join(routesDir, file), "utf8");
    const re = /router\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      routes.push({ method: match[1].toUpperCase(), path: match[2] });
    }
  }
  return routes;
}

function listOpenApiOperations(): Array<{ method: string; path: string }> {
  const text = fs.readFileSync(openapiPath, "utf8");
  const ops: Array<{ method: string; path: string }> = [];
  let currentPath: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const pathMatch = line.match(/^  (\/[A-Za-z0-9_{}/-]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^    (get|post|patch|put|delete):$/);
    if (methodMatch && currentPath) {
      ops.push({ method: methodMatch[1].toUpperCase(), path: currentPath });
    }
    if (line.startsWith("components:")) {
      break;
    }
  }
  return ops;
}

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function key(method: string, p: string): string {
  return `${method} ${p}`;
}

const PREEXISTING_UNDOCUMENTED_ROUTES = [
  "GET /departments",
  "GET /admin/departments",
  "POST /admin/departments",
  "PATCH /admin/departments/{id}",
  "GET /admin/monitor",
  "GET /admin/notifications",
  "GET /admin/role-permissions",
  "PUT /admin/role-permissions",
  "POST /auth/verify-patient",
  "POST /auth/register-patient",
  "GET /dashboard/staff-desk",
  "GET /patients/hospital-lookup",
  "POST /patients/{id}/email-access-code",
  "POST /patients/{id}/reset-portal-password",
  "POST /portal/results/unlock",
  "POST /portal/login",
  "POST /portal/change-password",
  "POST /portal/request-access-code",
];

test("every Express route is documented in OpenAPI", () => {
  const documented = new Set(listOpenApiOperations().map((op) => key(op.method, op.path)));
  const missing = listExpressRoutes()
    .map((route) => key(route.method, toOpenApiPath(route.path)))
    .filter((item) => !documented.has(item));
  assert.equal(missing.includes("PUT /results/{id}/review"), false);
  assert.deepEqual(missing, PREEXISTING_UNDOCUMENTED_ROUTES);
});

test("every OpenAPI path exists as an Express route", () => {
  const implemented = new Set(
    listExpressRoutes().map((route) => key(route.method, toOpenApiPath(route.path))),
  );
  const extra = listOpenApiOperations()
    .map((op) => key(op.method, op.path))
    .filter((item) => !implemented.has(item));
  assert.deepEqual(extra, []);
});

test("OpenAPI documents staff and portal bearer auth", () => {
  const text = fs.readFileSync(openapiPath, "utf8");
  assert.match(text, /staffBearer:/);
  assert.match(text, /portalBearer:/);
  assert.match(text, /ace_refresh_token` is not issued/);
  assert.doesNotMatch(text, /\/auth\/refresh:/);
  assert.doesNotMatch(text, /\/auth\/logout:/);
  assert.match(text, /type=access/);
  assert.match(text, /15 minutes/);
});

test("upload contract includes multipart file field and does not use 413", () => {
  const text = fs.readFileSync(openapiPath, "utf8");
  assert.match(text, /multipart\/form-data/);
  assert.match(text, /format: binary/);
  assert.match(text, /required: \[file, patientId, category, releaseOption\]/);
  assert.doesNotMatch(text, /"413"/);
  assert.doesNotMatch(text, /\n        "413":/);
});

test("download contract is binary and does not document OS paths as response fields", () => {
  const text = fs.readFileSync(openapiPath, "utf8");
  assert.match(text, /application\/pdf:/);
  assert.match(text, /image\/jpeg:/);
  assert.match(text, /image\/png:/);
  assert.match(text, /Never a filesystem path/);
  assert.doesNotMatch(text, /passwordHash/);
  assert.doesNotMatch(text, /accessCodeHash/);
  assert.doesNotMatch(text, /refreshTokenHash/);
});

test("error contract uses ErrorResponse and documents 429 where rate limits exist", () => {
  const text = fs.readFileSync(openapiPath, "utf8");
  assert.match(text, /ErrorResponse:/);
  assert.match(text, /TooManyRequests:/);
  assert.match(text, /\/auth\/login[\s\S]*"429":/);
  assert.match(text, /\/auth\/session\/\{sessionPublicId\}\/refresh[\s\S]*"429":/);
  assert.match(text, /\/portal\/verify[\s\S]*"429":/);
});

test("generated Zod login/refresh schemas match OpenAPI source", () => {
  const zodPath = path.join(repoRoot, "lib", "api-zod", "src", "generated", "api.ts");
  const zod = fs.readFileSync(zodPath, "utf8");
  assert.match(zod, /export const LoginBody/);
  assert.doesNotMatch(zod, /export const RefreshTokenBody/);
  assert.match(zod, /export const UploadResultBody/);
  assert.match(zod, /export const VerifyPatientAccessBody/);
});
