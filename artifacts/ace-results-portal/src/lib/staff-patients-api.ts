import { customFetch } from "@workspace/api-client-react";

export type StaffPatientRow = {
  id: number;
  patientHisId: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  dateOfBirth: string;
  mobileNumber?: string | null;
  email?: string | null;
  createdAt: string;
  updatedAt: string;
  resultCount?: number;
  assignedPhysicians?: Array<{ id: number; name: string }>;
  portalActive?: boolean;
};

export type StaffPatientDirectorySummary = {
  totalPatients: number;
  registeredThisMonth: number;
  withResults: number;
};

export type StaffPatientListFilter = {
  search?: string;
  page?: number;
  limit?: number;
  hasResults?: boolean;
  hasPhysician?: boolean;
};

export function fetchStaffPatientDirectorySummary() {
  return customFetch<StaffPatientDirectorySummary>("/api/patients/directory-summary");
}

export function fetchStaffPatientList(filters: StaffPatientListFilter = {}) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.hasResults === true) params.set("hasResults", "1");
  if (filters.hasResults === false) params.set("hasResults", "0");
  if (filters.hasPhysician === true) params.set("hasPhysician", "1");
  if (filters.hasPhysician === false) params.set("hasPhysician", "0");
  const qs = params.toString();
  return customFetch<{
    data: StaffPatientRow[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/patients${qs ? `?${qs}` : ""}`);
}

export function patientDisplayName(p: Pick<StaffPatientRow, "lastName" | "firstName" | "middleName">) {
  const middle = p.middleName ? ` ${p.middleName}` : "";
  return `${p.lastName}, ${p.firstName}${middle}`.replace(/\s+/g, " ").trim();
}

export function patientInitials(p: Pick<StaffPatientRow, "lastName" | "firstName">) {
  const a = (p.firstName?.trim()?.[0] ?? "").toUpperCase();
  const b = (p.lastName?.trim()?.[0] ?? "").toUpperCase();
  return `${a}${b}` || "PT";
}

export function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

const AVATAR_TONES = [
  "bg-[#D6EAF8] text-[#1A5276]",
  "bg-[#D5F5E3] text-[#196F3D]",
  "bg-[#F5D6DE] text-[#922B21]",
  "bg-[#FCF3CF] text-[#7D6608]",
  "bg-[#E8DAEF] text-[#6C3483]",
  "bg-[#D6F5EE] text-[#0E6655]",
];

export function avatarToneForName(name: string) {
  const sum = name.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length]!;
}
