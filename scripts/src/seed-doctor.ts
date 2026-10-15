import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, initDb, closePool, usersRepo } from "@workspace/db";
import bcrypt from "bcryptjs";

loadRootEnv();

export interface DoctorBootstrapConfig {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

export function assertDoctorBootstrapAllowed(env = process.env) {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("Doctor bootstrap is development-only and must not run in production.");
  }
}

export function getDoctorBootstrapConfig(env = process.env): DoctorBootstrapConfig {
  const username = env.DOCTOR_BOOTSTRAP_USERNAME?.trim();
  const password = env.DOCTOR_BOOTSTRAP_PASSWORD;
  if (!username || !password) {
    throw new Error("DOCTOR_BOOTSTRAP_USERNAME and DOCTOR_BOOTSTRAP_PASSWORD are required.");
  }
  return {
    username,
    password,
    firstName: env.DOCTOR_BOOTSTRAP_FIRST_NAME?.trim() || "Development",
    lastName: env.DOCTOR_BOOTSTRAP_LAST_NAME?.trim() || "Physician",
    email: env.DOCTOR_BOOTSTRAP_EMAIL?.trim() || null,
  };
}

export async function seedDoctor(config = getDoctorBootstrapConfig()) {
  assertDoctorBootstrapAllowed();
  await initDb();
  const passwordHash = await bcrypt.hash(config.password, 12);
  const existing = await usersRepo.findUserByUsername(config.username);

  if (existing) {
    await usersRepo.updateUser(existing.id, {
      role: "physician",
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
    role: "physician",
  });
  return { created: true as const, updated: false as const, username: user.username, role: user.role, passwordOk: true };
}

async function main() {
  loadRootEnv();
  try {
    const result = await seedDoctor();
    if (result.created) {
      console.log("Development physician account created.");
    } else {
      console.log("Development physician account updated (role, password, lockout).");
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
