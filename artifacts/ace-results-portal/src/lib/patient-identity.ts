export const RESULT_CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "laboratory", label: "Laboratory" },
  { id: "radiology", label: "Radiology" },
  { id: "ultrasound", label: "Ultrasound" },
  { id: "ct_scan", label: "CT Scan" },
  { id: "mri", label: "MRI" },
  { id: "ecg", label: "ECG" },
  { id: "echo_2d", label: "2D Echo" },
  { id: "rehabilitation", label: "Rehabilitation" },
  { id: "other", label: "Other" },
] as const;

export const RESULT_CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation",
  other: "Other Diagnostics",
};

export type PortalPatientIdentity = {
  id?: number | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  patientHisId?: string | null;
  dateOfBirth?: string | null;
  mobileNumber?: string | null;
  email?: string | null;
} | null | undefined;

export function portalFullName(patient?: PortalPatientIdentity) {
  const name = [
    patient?.firstName,
    patient?.middleName,
    patient?.lastName,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || "Patient";
}

export function portalInitials(firstName?: string | null, lastName?: string | null) {
  const first = String(firstName ?? "").trim().charAt(0);
  const last = String(lastName ?? "").trim().charAt(0);
  return `${first}${last}`.toUpperCase() || "P";
}

export function portalInitialsFromName(name?: string | null) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "DR").toUpperCase();
}

export function parsePortalDate(value?: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ageFromDob(dob?: string | null) {
  const born = parsePortalDate(dob);
  if (!born) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function formatPortalDate(value?: string | null, fallback = "—") {
  const date = parsePortalDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function formatPortalLongDate(value?: string | null, fallback = "—") {
  const date = parsePortalDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

export function formatPortalDateTime(value?: string | null, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const day = date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  return `${day} — ${time}`;
}

export function resultCategoryLabel(category?: string | null) {
  if (!category) return "Result";
  return RESULT_CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

export function resultStatusLabel(status?: string | null) {
  if (!status) return "Released";
  if (status === "released") return "Released";
  return status.replace(/_/g, " ");
}

export function portalPhotoKey(patientHisId?: string | null, fallbackId?: number | string | null) {
  const his = String(patientHisId ?? "").trim();
  if (his) return his;
  if (fallbackId != null && String(fallbackId).trim()) return String(fallbackId);
  return "patient";
}

export function resultReleasedAt(result: { dateReleased?: string | null; uploadedAt?: string | null }) {
  return result.dateReleased || result.uploadedAt || null;
}

export function sortPortalResultsByRelease<T extends { dateReleased?: string | null; uploadedAt?: string | null }>(
  results: T[],
) {
  return [...results].sort((a, b) => {
    const aTime = Date.parse(resultReleasedAt(a) ?? "") || 0;
    const bTime = Date.parse(resultReleasedAt(b) ?? "") || 0;
    return bTime - aTime;
  });
}

export const DEPT_BADGE_CLASS: Record<string, string> = {
  laboratory: "bg-[#E8F4EC] text-[#2F7D4A]",
  Laboratory: "bg-[#E8F4EC] text-[#2F7D4A]",
  radiology: "bg-[#F8ECEF] text-[#8E3344]",
  Radiology: "bg-[#F8ECEF] text-[#8E3344]",
  ultrasound: "bg-[#EAF1F8] text-[#2F5F8E]",
  ct_scan: "bg-[#F1ECF8] text-[#5B3D8E]",
  mri: "bg-[#F1ECF8] text-[#5B3D8E]",
  ecg: "bg-[#F8EEDC] text-[#c47a22]",
  ECG: "bg-[#F8EEDC] text-[#c47a22]",
  echo_2d: "bg-[#F8EEDC] text-[#c47a22]",
  rehabilitation: "bg-[#E8F4EC] text-[#2F7D4A]",
  other: "bg-gray-100 text-gray-700",
};

export function formatFileSize(bytes?: number | null) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
