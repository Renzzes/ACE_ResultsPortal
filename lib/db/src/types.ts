export type UserRole = string;

/** Built-in roles that are never department codes. */
export const SYSTEM_USER_ROLES = ["super_admin", "physician", "patient"] as const;
export type SystemUserRole = (typeof SYSTEM_USER_ROLES)[number];

export const PORTAL_USER_ROLE: UserRole = "patient";

export type ResultCategory =
  | "laboratory"
  | "radiology"
  | "ultrasound"
  | "ct_scan"
  | "mri"
  | "ecg"
  | "echo_2d"
  | "rehabilitation"
  | "other";

export type ReleaseOption = "immediate" | "after_physician_review" | "scheduled";

export type ResultStatus = "pending" | "released" | "archived";

export type FileType = "pdf" | "jpeg" | "png";

export type ResultAccessCodeEmailStatus = "none" | "accepted" | "failed";

export type AuditAction =
  | "login"
  | "logout"
  | "upload"
  | "edit"
  | "delete"
  | "view"
  | "download"
  | "access_denied"
  | "access_code_regen";

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  /** When true, portal must set a new password before protected features. */
  mustChangePassword: boolean;
  /** Temporary password expiry; null means no time-bound password. */
  passwordExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupportRequestCategory = "temporary_password" | "diagnostic_access_code";
export type SupportRequestStatus = "pending" | "processing" | "completed" | "rejected";

export interface PatientSupportRequest {
  id: number;
  category: SupportRequestCategory;
  patientHisId: string;
  lastName: string;
  contactEmail: string | null;
  details: string | null;
  status: SupportRequestStatus;
  matchedPatientId: number | null;
  processedById: number | null;
  processedAt: Date | null;
  adminNotes: string | null;
  requesterIpHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Patient {
  id: number;
  patientHisId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  dateOfBirth: string;
  mobileNumber: string | null;
  email: string | null;
  /** Patient-level results unlock is retired; prefer per-result credentials. */
  accessCodeHash: string | null;
  createdById: number | null;
  /** Linked dbo.users.id when role='patient'. Null until portal registration. */
  portalUserId: number | null;
  /** When set, patient has requested a new results access code from admin. */
  accessCodeRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientPhysician {
  id: number;
  patientId: number;
  physicianId: number;
  assignedAt: Date;
  assignedById: number | null;
}

export interface ResultRow {
  id: number;
  patientId: number;
  category: ResultCategory;
  fileName: string;
  originalFileName: string;
  fileType: FileType;
  fileSizeBytes: number | null;
  releaseOption: ReleaseOption;
  scheduledReleaseDate: string | null;
  dateReleased: Date | null;
  status: ResultStatus;
  remarks: string | null;
  uploadedById: number;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Bcrypt hash of the document-specific access code; null until issued. */
  accessCodeHash: string | null;
  /** AES-GCM envelope of the current plaintext code for print / email-retry. */
  accessCodeEncrypted: string | null;
  accessCodeIssuedAt: Date | null;
  accessCodeEmailedAt: Date | null;
  accessCodeEmailStatus: ResultAccessCodeEmailStatus | null;
}

export type PrescriptionStatus = "active" | "completed" | "cancelled";

export interface PrescriptionRow {
  id: number;
  patientId: number;
  physicianId: number;
  status: PrescriptionStatus;
  diagnosisOrIndication: string | null;
  generalInstructions: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrescriptionItemRow {
  id: number;
  prescriptionId: number;
  medicineName: string;
  genericName: string | null;
  dosage: string | null;
  dosageUnit: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrescriptionWithItems extends PrescriptionRow {
  items: PrescriptionItemRow[];
  physicianName?: string;
}

export interface AuditLog {
  id: number;
  action: AuditAction;
  userId: number | null;
  userName: string | null;
  patientHisId: string | null;
  resultId: number | null;
  ipAddress: string;
  details: string | null;
  createdAt: Date;
}

export interface AssignedPhysician {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  assignedAt: Date;
}

export interface AuthSession {
  id: number;
  userId: number;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Public session handle. Null on legacy rows created before H.5.2. */
  publicId: string | null;
  /** Login channel. Null on legacy rows. Not an authorization role. */
  portal: string | null;
}

export type NotificationPriority = "normal" | "important" | "urgent";

export interface NotificationRow {
  id: number;
  recipientUserId: number;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  priority: NotificationPriority;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export type AnnouncementTargetType =
  | "all_staff"
  | "all_physicians"
  | "department"
  | "all_patients";

export interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  priority: NotificationPriority;
  createdById: number;
  isPublished: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementTargetRow {
  id: number;
  announcementId: number;
  targetType: AnnouncementTargetType;
  targetValue: string | null;
  createdAt: Date;
}

export interface MessageThreadRow {
  id: number;
  subject: string;
  patientId: number | null;
  createdById: number;
  isClosed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageParticipantRow {
  threadId: number;
  userId: number;
  lastReadAt: Date | null;
  joinedAt: Date;
}

export interface MessageRow {
  id: number;
  threadId: number;
  senderUserId: number;
  body: string;
  isDeleted: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

