import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const patientPhysiciansTable = pgTable("patient_physicians", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  physicianId: integer("physician_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedById: integer("assigned_by_id"),
});
