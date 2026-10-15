/** Staff and doctor roles whose sign-in is gated by dbo.users.is_active. */
export const ACCOUNT_STATUS_ROLES = [
  "laboratory",
  "radiology",
  "endoscopy",
  "medical_records",
  "physician",
] as const;

const ACCOUNT_STATUS_ROLE_SET = new Set<string>(ACCOUNT_STATUS_ROLES);

export function isAccountStatusRole(role: string | null | undefined): boolean {
  return role != null && ACCOUNT_STATUS_ROLE_SET.has(role);
}
