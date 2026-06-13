import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditActionEnum = pgEnum("audit_action", [
  "login",
  "logout",
  "upload",
  "edit",
  "delete",
  "view",
  "download",
  "access_denied",
  "access_code_regen",
]);

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: auditActionEnum("action").notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  patientHisId: text("patient_his_id"),
  resultId: integer("result_id"),
  ipAddress: text("ip_address").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
