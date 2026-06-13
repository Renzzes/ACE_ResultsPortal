import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function seedAdmin() {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, "admin"));

  if (existing.length > 0) {
    console.log("Admin user already exists, skipping seed.");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash("Admin@ACE2024!", 12);

  await db.insert(usersTable).values({
    username: "admin",
    passwordHash,
    firstName: "System",
    lastName: "Administrator",
    email: "admin@acemedical.ph",
    role: "super_admin",
    isActive: true,
  });

  console.log("Admin user created successfully.");
  console.log("  Username: admin");
  console.log("  Password: Admin@ACE2024!");
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
