import { loadRootEnv, initDb, closePool, usersRepo } from "@workspace/db";
import bcrypt from "bcryptjs";

loadRootEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for admin bootstrap.`);
  }
  return value;
}

async function seedAdmin() {
  loadRootEnv();
  await initDb();

  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = required("ADMIN_BOOTSTRAP_PASSWORD");
  const firstName = process.env.ADMIN_BOOTSTRAP_FIRST_NAME || "System";
  const lastName = process.env.ADMIN_BOOTSTRAP_LAST_NAME || "Administrator";
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || null;
  const production = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

  const existing = await usersRepo.findUserByUsername(username);
  if (existing) {
    if (production) {
      console.log("Bootstrap administrator already exists; no changes made.");
      await closePool();
      process.exit(0);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await usersRepo.updateUser(existing.id, {
      role: "super_admin",
      isActive: true,
    });
    await usersRepo.setUserPassword(existing.id, passwordHash, true);
    const updated = await usersRepo.findUserByUsername(username);
    const passwordOk = updated ? await bcrypt.compare(password, updated.passwordHash) : false;
    console.log("Bootstrap administrator updated (role, password, lockout).");
    console.log(`Username: ${username}`);
    console.log(`Role: ${updated?.role ?? existing.role}`);
    console.log(`Password matches .env: ${passwordOk ? "yes" : "no"}`);
    await closePool();
    process.exit(passwordOk ? 0 : 1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await usersRepo.insertUser({
    username,
    passwordHash,
    firstName,
    lastName,
    email,
    role: "super_admin",
  });

  console.log("Bootstrap administrator created.");
  await closePool();
  process.exit(0);
}

seedAdmin().catch(async () => {
  console.error("Seed failed.");
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
