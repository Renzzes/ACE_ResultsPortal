import { pgTable, text, serial, timestamp, integer, bigint, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const resultCategoryEnum = pgEnum("result_category", [
  "laboratory",
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
  "other",
]);

export const releaseOptionEnum = pgEnum("release_option", [
  "immediate",
  "after_physician_review",
  "scheduled",
]);

export const resultStatusEnum = pgEnum("result_status", [
  "pending",
  "released",
  "archived",
]);

export const fileTypeEnum = pgEnum("file_type", ["pdf", "jpeg", "png"]);

export const resultsTable = pgTable("results", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  category: resultCategoryEnum("category").notNull(),
  fileName: text("file_name").notNull(),
  originalFileName: text("original_file_name").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  releaseOption: releaseOptionEnum("release_option").notNull(),
  scheduledReleaseDate: text("scheduled_release_date"),
  dateReleased: timestamp("date_released", { withTimezone: true }),
  status: resultStatusEnum("status").notNull().default("pending"),
  remarks: text("remarks"),
  uploadedById: integer("uploaded_by_id").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertResultSchema = createInsertSchema(resultsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  uploadedAt: true,
});
export type InsertResult = z.infer<typeof insertResultSchema>;
export type Result = typeof resultsTable.$inferSelect;
