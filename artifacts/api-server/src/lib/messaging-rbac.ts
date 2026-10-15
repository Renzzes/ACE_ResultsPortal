/** Messaging RBAC helpers — backend authoritative. */

export function isStaffMessagingRole(role: string): boolean {
  return role !== "patient" && role !== "physician";
}

export function isPhysicianRole(role: string): boolean {
  return role === "physician";
}

export function isAdminMessagingRole(role: string): boolean {
  return role === "super_admin" || role === "medical_records";
}

/**
 * Communication rules:
 * Staff ↔ Doctor, Staff ↔ Admin, Doctor ↔ Admin (Phase 4).
 * Patient ↔ Assigned Doctor / Medical Records / Admin (Phase 6E role gate).
 * Assignment checks for physicians are enforced in routes.
 * No Doctor ↔ Doctor. No Patient ↔ Patient.
 * Department staff cannot message patients (role gate).
 */
export function canMessageRole(senderRole: string, recipientRole: string): boolean {
  if (senderRole === "physician" && recipientRole === "physician") return false;
  if (senderRole === "patient" && recipientRole === "patient") return false;

  if (senderRole === "patient") {
    return (
      recipientRole === "physician" ||
      isAdminMessagingRole(recipientRole)
    );
  }
  if (recipientRole === "patient") {
    return (
      senderRole === "physician" ||
      isAdminMessagingRole(senderRole)
    );
  }

  const senderIsPhysician = isPhysicianRole(senderRole);
  const recipientIsPhysician = isPhysicianRole(recipientRole);
  const senderIsAdmin = isAdminMessagingRole(senderRole);
  const recipientIsAdmin = isAdminMessagingRole(recipientRole);
  const senderIsStaff = isStaffMessagingRole(senderRole) && !senderIsAdmin;
  const recipientIsStaff = isStaffMessagingRole(recipientRole) && !recipientIsAdmin;

  if (senderIsPhysician) {
    return recipientIsAdmin || recipientIsStaff;
  }
  if (senderIsAdmin) {
    return recipientIsPhysician || recipientIsStaff || recipientIsAdmin;
  }
  // department staff
  return recipientIsPhysician || recipientIsAdmin;
}

/** Drop inactive accounts, the caller, and roles the caller may not message. */
export function filterAuthorizedMessagingUsers<T extends { id: number; role: string; isActive: boolean }>(
  caller: { userId: number; role: string },
  candidates: T[],
): T[] {
  return candidates.filter(
    (user) => user.isActive && user.id !== caller.userId && canMessageRole(caller.role, user.role),
  );
}

export function messagingDepartmentLabel(role: string, departmentName: string | null | undefined): string {
  if (departmentName?.trim()) return departmentName.trim();
  if (role === "physician") return "Physician";
  if (role === "super_admin") return "Administration";
  if (role === "medical_records") return "Medical Records";
  if (role === "patient") return "Patient";
  return role;
}

export function canManageAnnouncements(role: string): boolean {
  return role === "super_admin";
}

export function canAssociatePatientInMessage(role: string): boolean {
  // Staff/admin/physician may attach patient clinical context on staff threads.
  // Portal routes set patient_id from JWT and never accept client patient_id.
  return role !== "patient";
}
