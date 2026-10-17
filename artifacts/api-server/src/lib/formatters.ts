import { roleHasPermission, type Patient, type ResultRow, type User } from "@workspace/db";

/**
 * Patients may store HIS contact + portal email as "hisEmail\\nportalEmail".
 * API responses and outbound mail must use the portal address (after the newline).
 */
export function resolvePatientPortalEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const separator = email.indexOf("\n");
  const visible = (separator === -1 ? email : email.slice(separator + 1)).trim().toLowerCase();
  if (!visible || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visible)) return null;
  return visible;
}

export function formatUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email ?? null,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    permissions: {
      uploadResults:
        u.role !== "physician" &&
        u.role !== "patient" &&
        roleHasPermission(u.role, "upload_results"),
    },
  };
}

export function formatPatient(
  p: Patient,
  resultCount = 0,
  assignedPhysicians: Array<{ id: number; name: string }> = [],
  accessCode: string | null = null,
) {
  return {
    id: p.id,
    patientHisId: p.patientHisId,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName ?? null,
    dateOfBirth: p.dateOfBirth,
    mobileNumber: p.mobileNumber ?? null,
    email: resolvePatientPortalEmail(p.email),
    accessCode,
    accessCodeRequestedAt: p.accessCodeRequestedAt ? p.accessCodeRequestedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    resultCount,
    assignedPhysicians,
  };
}

export function formatResult(
  r: ResultRow,
  extras: {
    patientHisId?: string;
    patientName?: string;
    uploadedByName?: string;
    assignedPhysician?: { id: number; name: string } | null;
    assignedPhysicians?: Array<{ id: number; name: string }>;
    reviews?: Array<{
      physicianId: number;
      physicianName: string;
      reviewed: boolean;
      reviewedAt: string | null;
      comment: string | null;
    }>;
    myReview?: {
      reviewed: boolean;
      reviewedAt: string | null;
      comment: string | null;
    };
  } = {},
) {
  const assignedPhysicians = extras.assignedPhysicians
    ?? (extras.assignedPhysician ? [extras.assignedPhysician] : []);
  return {
    id: r.id,
    patientId: r.patientId,
    patientHisId: extras.patientHisId ?? "",
    patientName: extras.patientName ?? "",
    category: r.category,
    fileName: r.fileName,
    originalFileName: r.originalFileName,
    fileType: r.fileType,
    fileSizeBytes: r.fileSizeBytes ?? 0,
    releaseOption: r.releaseOption,
    scheduledReleaseDate: r.scheduledReleaseDate ?? null,
    dateReleased: r.dateReleased ? r.dateReleased.toISOString() : null,
    status: r.status,
    remarks: r.remarks ?? null,
    uploadedById: r.uploadedById,
    uploadedByName: extras.uploadedByName ?? `Staff #${r.uploadedById}`,
    uploadedAt: r.uploadedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    assignedPhysician: assignedPhysicians[0] ?? null,
    assignedPhysicians,
    hasAccessCode: Boolean(r.accessCodeHash),
    accessCodeIssuedAt: r.accessCodeIssuedAt ? r.accessCodeIssuedAt.toISOString() : null,
    accessCodeEmailedAt: r.accessCodeEmailedAt ? r.accessCodeEmailedAt.toISOString() : null,
    accessCodeEmailStatus: r.accessCodeEmailStatus ?? null,
    ...(extras.reviews !== undefined ? { reviews: extras.reviews } : {}),
    ...(extras.myReview !== undefined ? { myReview: extras.myReview } : {}),
  };
}

export function physicianName(lastName: string, firstName: string): string {
  return `Dr. ${lastName}, ${firstName}`;
}
