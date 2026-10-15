export const DEPARTMENT_LABELS: Record<string, string> = {
  super_admin: "Hospital Operations",
  physician: "Physician",
};

export function departmentForRole(role?: string | null) {
  if (!role) return "Hospital Staff";
  if (DEPARTMENT_LABELS[role]) return DEPARTMENT_LABELS[role];
  return role
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function staffEmployeeName(user?: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
} | null) {
  const first = String(user?.firstName ?? "").trim();
  const last = String(user?.lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (!full || /^system\s+administrator$/i.test(full)) {
    return String(user?.username ?? "Staff");
  }
  return full;
}

export function staffInitials(user?: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
} | null) {
  const name = staffEmployeeName(user);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "ST";
}
