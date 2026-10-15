import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, initDb, closePool, usersRepo, type UserRole } from "@workspace/db";
import bcrypt from "bcryptjs";

loadRootEnv();

const STAFF_ROLES = ["radiology", "laboratory", "medical_records", "endoscopy"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffBootstrapConfig {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: StaffRole;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

export function assertStaffBootstrapAllowed(env = process.env) {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("Staff bootstrap is development-only and must not run in production.");
  }
}

function parseStaffRole(value: string | undefined): StaffRole {
  const role = (value ?? "medical_records").trim().toLowerCase();
  if ((STAFF_ROLES as readonly string[]).includes(role)) return role as StaffRole;
  throw new Error(`STAFF_BOOTSTRAP_ROLE must be one of: ${STAFF_ROLES.join(", ")}`);
}

export function getStaffBootstrapConfig(env = process.env): StaffBootstrapConfig {
  const username = env.STAFF_BOOTSTRAP_USERNAME?.trim();
  const password = env.STAFF_BOOTSTRAP_PASSWORD;
  if (!username || !password) {
    throw new Error("STAFF_BOOTSTRAP_USERNAME and STAFF_BOOTSTRAP_PASSWORD are required.");
  }
  return {
    username,
    password,
    firstName: env.STAFF_BOOTSTRAP_FIRST_NAME?.trim() || "Development",
    lastName: env.STAFF_BOOTSTRAP_LAST_NAME?.trim() || "Staff",
    email: env.STAFF_BOOTSTRAP_EMAIL?.trim() || null,
    role: parseStaffRole(env.STAFF_BOOTSTRAP_ROLE),
  };
}

export async function seedStaff(config = getStaffBootstrapConfig()) {
  assertStaffBootstrapAllowed();
  await initDb();
  const passwordHash = await bcrypt.hash(config.password, 12);
  const existing = await usersRepo.findUserByUsername(config.username);

  if (existing) {
    await usersRepo.updateUser(existing.id, {
      role: config.role as UserRole,
      isActive: true,
    });
    await usersRepo.setUserPassword(existing.id, passwordHash, true);
    const updated = await usersRepo.findUserByUsername(config.username);
    const passwordOk = updated ? await bcrypt.compare(config.password, updated.passwordHash) : false;
    return {
      created: false as const,
      updated: true as const,
      username: existing.username,
      role: updated?.role ?? existing.role,
      passwordOk,
    };
  }

  const user = await usersRepo.insertUser({
    username: config.username,
    passwordHash,
    firstName: config.firstName,
    lastName: config.lastName,
    email: config.email,
    role: config.role,
  });
  return { created: true as const, updated: false as const, username: user.username, role: user.role, passwordOk: true };
}

async function main() {
  loadRootEnv();
  try {
    const result = await seedStaff();
    if (result.created) {
      console.log("Development staff account created.");
    } else {
      console.log("Development staff account updated (role, password, lockout).");
    }
    console.log(`Username: ${result.username}`);
    console.log(`Role: ${result.role}`);
    console.log(`Password matches .env: ${result.passwordOk ? "yes" : "no"}`);
  } finally {
    await closePool();
  }
}

if (isMainModule()) {
  main().catch(async () => {
    console.error("Seed failed.");
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
