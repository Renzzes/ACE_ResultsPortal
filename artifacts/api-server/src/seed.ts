import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./lib/auth";

async function seed() {
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));

  if (existing.length > 0) {
    console.log("Admin user already exists.");
    process.exit(0);
  }

  const passwordHash = await hashPassword("Admin@ACE2024!");

  await db.insert(usersTable).values({
    username: "admin",
    passwordHash,
    firstName: "System",
    lastName: "Administrator",
    email: "admin@acemedical.ph",
    role: "super_admin",
    isActive: true,
  });

  console.log("Admin user created: admin / Admin@ACE2024!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
