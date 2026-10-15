import {
  PORTAL_USER_ROLE,
  patientPhysiciansRepo,
  patientsRepo,
  usersRepo,
  type Patient,
  type User,
} from "@workspace/db";
import { resolveActivePortalAccount } from "./portal-activation";
import {
  canMessageRole,
  isAdminMessagingRole,
  isPhysicianRole,
} from "./messaging-rbac";

export const MESSAGE_BODY_MAX = 4000;
export const MESSAGE_SUBJECT_MAX = 255;

export type PortalMessageRecipient = {
  id: number;
  name: string;
  role: string;
  category: "doctor" | "staff" | "admin";
};

export type PatientRecipientAuthDeps = {
  findUserById: (id: number) => Promise<User | undefined>;
  findAssignment: (
    patientId: number,
    physicianId: number,
  ) => Promise<{ id: number } | undefined>;
};

export async function resolvePortalMessagingIdentity(
  patientId: number,
  patientHisId: string,
): Promise<
  | { ok: true; patient: Patient; portalUser: User; portalUserId: number }
  | { ok: false }
> {
  const patient =
    (Number.isFinite(patientId) ? await patientsRepo.findPatientById(patientId) : undefined) ??
    (await patientsRepo.findPatientByHisId(patientHisId));
  if (!patient) return { ok: false };
  const account = await resolveActivePortalAccount(patient);
  if (!account.ok) return { ok: false };
  return {
    ok: true,
    patient,
    portalUser: account.user,
    portalUserId: account.user.id,
  };
}

function displayName(u: Pick<User, "firstName" | "lastName" | "role">): string {
  if (u.role === "physician") return `Dr. ${u.lastName}, ${u.firstName}`;
  if (u.role === "medical_records") return "ACE Medical Records";
  if (u.role === "super_admin") return "Patient Support";
  return `${u.lastName}, ${u.firstName}`;
}

function categoryForRole(role: string): "doctor" | "staff" | "admin" {
  if (isPhysicianRole(role)) return "doctor";
  if (role === "super_admin") return "admin";
  if (role === "medical_records") return "staff";
  return "staff";
}

/**
 * Recipients a patient may contact:
 * - assigned physicians (patient_physicians + active physician users)
 * - medical_records / super_admin (active)
 */
export async function listPortalAuthorizedRecipients(
  patientId: number,
): Promise<PortalMessageRecipient[]> {
  const recipients: PortalMessageRecipient[] = [];
  const seen = new Set<number>();

  const assigned = await patientsRepo.listAssignedPhysicians(patientId);
  for (const row of assigned) {
    const user = await usersRepo.findUserById(row.id);
    if (!user || !user.isActive || user.role !== "physician") continue;
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    recipients.push({
      id: user.id,
      name: displayName(user),
      role: user.role,
      category: "doctor",
    });
  }

  for (const role of ["medical_records", "super_admin"] as const) {
    const listed = await usersRepo.listUsers({ role, isActive: true, page: 1, limit: 50 });
    for (const user of listed.data) {
      if (!user.isActive || !isAdminMessagingRole(user.role)) continue;
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      recipients.push({
        id: user.id,
        name: displayName(user),
        role: user.role,
        category: categoryForRole(user.role),
      });
    }
  }

  return recipients;
}

/**
 * Validate that a patient may start messaging a recipient user.
 * Role matrix + physician assignment. Never trusts client alone.
 */
export async function assertPatientMayMessageRecipient(
  patientId: number,
  portalUserId: number,
  recipientUserId: number,
  deps: PatientRecipientAuthDeps = {
    findUserById: (id) => usersRepo.findUserById(id),
    findAssignment: (pid, phyId) => patientPhysiciansRepo.findAssignment(pid, phyId),
  },
): Promise<{ ok: true; recipient: User } | { ok: false; reason: "forbidden" | "not_found" }> {
  if (!Number.isFinite(recipientUserId) || recipientUserId <= 0) {
    return { ok: false, reason: "not_found" };
  }
  if (recipientUserId === portalUserId) {
    return { ok: false, reason: "forbidden" };
  }

  const recipient = await deps.findUserById(recipientUserId);
  if (!recipient || !recipient.isActive) {
    return { ok: false, reason: "not_found" };
  }
  if (recipient.role === PORTAL_USER_ROLE) {
    return { ok: false, reason: "forbidden" };
  }
  if (!canMessageRole(PORTAL_USER_ROLE, recipient.role)) {
    return { ok: false, reason: "forbidden" };
  }

  if (isPhysicianRole(recipient.role)) {
    const assignment = await deps.findAssignment(patientId, recipient.id);
    if (!assignment) {
      return { ok: false, reason: "forbidden" };
    }
  } else if (!isAdminMessagingRole(recipient.role)) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, recipient };
}

/**
 * Staff/Doctor/Admin → Patient: role allow + physician assignment when sender is physician.
 */
export async function assertStaffMayMessagePatient(
  sender: { userId: number; role: string },
  recipientUserId: number,
): Promise<
  | { ok: true; recipient: User; patient: Patient }
  | { ok: false; reason: "forbidden" | "not_found" }
> {
  const recipient = await usersRepo.findUserById(recipientUserId);
  if (!recipient || !recipient.isActive || recipient.role !== PORTAL_USER_ROLE) {
    return { ok: false, reason: "not_found" };
  }
  if (!canMessageRole(sender.role, recipient.role)) {
    return { ok: false, reason: "forbidden" };
  }

  const patient = await patientsRepo.findPatientByPortalUserId(recipient.id);
  if (!patient || patient.portalUserId !== recipient.id) {
    return { ok: false, reason: "not_found" };
  }

  const account = await resolveActivePortalAccount(patient);
  if (!account.ok) {
    return { ok: false, reason: "forbidden" };
  }

  if (isPhysicianRole(sender.role)) {
    const assignment = await patientPhysiciansRepo.findAssignment(patient.id, sender.userId);
    if (!assignment) {
      return { ok: false, reason: "forbidden" };
    }
  } else if (!isAdminMessagingRole(sender.role)) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, recipient, patient };
}

export const RECIPIENT_SEARCH_MIN = 2;

/** Patient-facing subtitle. Does not include internal usernames or department codes. */
export function portalRecipientSubtitle(role: string): string {
  if (role === "physician") return "Assigned physician";
  if (role === "medical_records") return "Medical Records";
  if (role === "super_admin") return "Patient Support";
  return "Care team";
}

/** Filter an already-authorized recipient list. Short queries match nobody. */
export function filterPortalRecipientsBySearch<T extends { name: string; role: string }>(
  recipients: T[],
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  if (q.length < RECIPIENT_SEARCH_MIN) return [];
  return recipients.filter((recipient) => {
    const haystack = `${recipient.name} ${portalRecipientSubtitle(recipient.role)}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function optionalMessageSubject(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const subject = raw.trim();
  if (!subject) return { ok: true, value: null };
  if (subject.length > MESSAGE_SUBJECT_MAX) return { ok: false };
  return { ok: true, value: subject };
}

export function optionalMessageBody(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const body = raw.trim();
  if (!body) return { ok: true, value: null };
  if (body.length > MESSAGE_BODY_MAX) return { ok: false };
  return { ok: true, value: body };
}

export function sanitizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim();
  if (!body || body.length > MESSAGE_BODY_MAX) return null;
  return body;
}

export function sanitizeMessageSubject(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const subject = raw.trim();
  if (!subject || subject.length > MESSAGE_SUBJECT_MAX) return null;
  return subject;
}

/** Generic message notification — never includes message body / PHI. entityId = threadId for deep links. */
export function messageReceivedNotificationInput(threadId: number) {
  return {
    type: "message_received",
    title: "New Message",
    body: "You have received a new message.",
    entityType: "thread",
    entityId: threadId,
    priority: "normal" as const,
  };
}
