import type {
  AuditAction,
  AuditLog,
  AuthSession,
  AssignedPhysician,
  FileType,
  Patient,
  PatientPhysician,
  ReleaseOption,
  ResultAccessCodeEmailStatus,
  ResultCategory,
  ResultRow,
  ResultStatus,
  User,
  UserRole,
} from "./types";
import {
  asBool,
  asDate,
  asNumber,
  asRequiredDate,
  asRequiredNumber,
  asRequiredString,
  asString,
  isoDateOnly,
} from "./sql-helpers";

type Row = Record<string, unknown>;

export function mapUser(row: Row): User {
  return {
    id: asRequiredNumber(row.id),
    username: asRequiredString(row.username),
    passwordHash: asRequiredString(row.password_hash),
    firstName: asRequiredString(row.first_name),
    lastName: asRequiredString(row.last_name),
    email: asString(row.email),
    role: asRequiredString(row.role) as UserRole,
    isActive: asBool(row.is_active),
    failedLoginAttempts: asRequiredNumber(row.failed_login_attempts),
    lockedUntil: asDate(row.locked_until),
    lastLoginAt: asDate(row.last_login_at),
    mustChangePassword: row.must_change_password == null ? false : asBool(row.must_change_password),
    passwordExpiresAt: asDate(row.password_expires_at),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
  };
}

export function mapPatient(row: Row): Patient {
  return {
    id: asRequiredNumber(row.id),
    patientHisId: asRequiredString(row.patient_his_id),
    lastName: asRequiredString(row.last_name),
    firstName: asRequiredString(row.first_name),
    middleName: asString(row.middle_name),
    dateOfBirth: isoDateOnly(row.date_of_birth),
    mobileNumber: asString(row.mobile_number),
    email: asString(row.email),
    accessCodeHash: asString(row.access_code_hash),
    createdById: asNumber(row.created_by_id),
    portalUserId: asNumber(row.portal_user_id),
    accessCodeRequestedAt: asDate(row.access_code_requested_at),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
  };
}

export function mapPatientPhysician(row: Row): PatientPhysician {
  return {
    id: asRequiredNumber(row.id),
    patientId: asRequiredNumber(row.patient_id),
    physicianId: asRequiredNumber(row.physician_id),
    assignedAt: asRequiredDate(row.assigned_at),
    assignedById: asNumber(row.assigned_by_id),
  };
}

export function mapAssignedPhysician(row: Row): AssignedPhysician {
  return {
    id: asRequiredNumber(row.id),
    firstName: asRequiredString(row.first_name),
    lastName: asRequiredString(row.last_name),
    username: asRequiredString(row.username),
    assignedAt: asRequiredDate(row.assigned_at),
  };
}

export function mapResult(row: Row): ResultRow {
  const emailStatus = asString(row.access_code_email_status);
  return {
    id: asRequiredNumber(row.id),
    patientId: asRequiredNumber(row.patient_id),
    category: asRequiredString(row.category) as ResultCategory,
    fileName: asRequiredString(row.file_name),
    originalFileName: asRequiredString(row.original_file_name),
    fileType: asRequiredString(row.file_type) as FileType,
    fileSizeBytes: asNumber(row.file_size_bytes),
    releaseOption: asRequiredString(row.release_option) as ReleaseOption,
    scheduledReleaseDate: row.scheduled_release_date
      ? isoDateOnly(row.scheduled_release_date)
      : null,
    dateReleased: asDate(row.date_released),
    status: asRequiredString(row.status) as ResultStatus,
    remarks: asString(row.remarks),
    uploadedById: asRequiredNumber(row.uploaded_by_id),
    uploadedAt: asRequiredDate(row.uploaded_at),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
    accessCodeHash: asString(row.access_code_hash),
    accessCodeEncrypted: asString(row.access_code_encrypted),
    accessCodeIssuedAt: asDate(row.access_code_issued_at),
    accessCodeEmailedAt: asDate(row.access_code_emailed_at),
    accessCodeEmailStatus:
      emailStatus === "none" || emailStatus === "accepted" || emailStatus === "failed"
        ? (emailStatus as ResultAccessCodeEmailStatus)
        : null,
  };
}

export function mapAuditLog(row: Row): AuditLog {
  return {
    id: asRequiredNumber(row.id),
    action: asRequiredString(row.action) as AuditAction,
    userId: asNumber(row.user_id),
    userName: asString(row.user_name),
    patientHisId: asString(row.patient_his_id),
    resultId: asNumber(row.result_id),
    ipAddress: asRequiredString(row.ip_address),
    details: asString(row.details),
    createdAt: asRequiredDate(row.created_at),
  };
}

export function mapAuthSession(row: Row): AuthSession {
  return {
    id: asRequiredNumber(row.id),
    userId: asRequiredNumber(row.user_id),
    refreshTokenHash: asRequiredString(row.refresh_token_hash).trim(),
    expiresAt: asRequiredDate(row.expires_at),
    revokedAt: asDate(row.revoked_at),
    createdAt: asRequiredDate(row.created_at),
    lastUsedAt: asDate(row.last_used_at),
    publicId: asString(row.public_id)?.trim() || null,
    portal: asString(row.portal)?.trim() || null,
  };
}

export function mapNotification(row: Row): import("./types").NotificationRow {
  return {
    id: asRequiredNumber(row.id),
    recipientUserId: asRequiredNumber(row.recipient_user_id),
    type: asRequiredString(row.type),
    title: asRequiredString(row.title),
    body: asRequiredString(row.body),
    entityType: asString(row.entity_type),
    entityId: asNumber(row.entity_id),
    priority: asRequiredString(row.priority) as import("./types").NotificationPriority,
    isRead: asBool(row.is_read),
    readAt: asDate(row.read_at),
    createdAt: asRequiredDate(row.created_at),
    expiresAt: asDate(row.expires_at),
  };
}

export function mapAnnouncement(row: Row): import("./types").AnnouncementRow {
  return {
    id: asRequiredNumber(row.id),
    title: asRequiredString(row.title),
    body: asRequiredString(row.body),
    priority: asRequiredString(row.priority) as import("./types").NotificationPriority,
    createdById: asRequiredNumber(row.created_by_id),
    isPublished: asBool(row.is_published),
    publishedAt: asDate(row.published_at),
    expiresAt: asDate(row.expires_at),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
  };
}

export function mapAnnouncementTarget(row: Row): import("./types").AnnouncementTargetRow {
  return {
    id: asRequiredNumber(row.id),
    announcementId: asRequiredNumber(row.announcement_id),
    targetType: asRequiredString(row.target_type) as import("./types").AnnouncementTargetType,
    targetValue: asString(row.target_value),
    createdAt: asRequiredDate(row.created_at),
  };
}

export function mapMessageThread(row: Row): import("./types").MessageThreadRow {
  return {
    id: asRequiredNumber(row.id),
    subject: asRequiredString(row.subject),
    patientId: asNumber(row.patient_id),
    createdById: asRequiredNumber(row.created_by_id),
    isClosed: asBool(row.is_closed),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
  };
}

export function mapMessageParticipant(row: Row): import("./types").MessageParticipantRow {
  return {
    threadId: asRequiredNumber(row.thread_id),
    userId: asRequiredNumber(row.user_id),
    lastReadAt: asDate(row.last_read_at),
    joinedAt: asRequiredDate(row.joined_at),
  };
}

export function mapMessage(row: Row): import("./types").MessageRow {
  return {
    id: asRequiredNumber(row.id),
    threadId: asRequiredNumber(row.thread_id),
    senderUserId: asRequiredNumber(row.sender_user_id),
    body: asRequiredString(row.body),
    isDeleted: asBool(row.is_deleted),
    createdAt: asRequiredDate(row.created_at),
    editedAt: asDate(row.edited_at),
  };
}
