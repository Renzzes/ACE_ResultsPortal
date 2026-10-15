import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRootEnv,
  initDb,
  closePool,
  patientsRepo,
  usersRepo,
  withTransaction,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import bcrypt from "bcryptjs";

loadRootEnv();

export interface PatientBootstrapConfig {
  username: string;
  password: string;
  patientHisId: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

function sqlErrorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const direct = "number" in err ? Number((err as { number?: unknown }).number) : undefined;
  if (Number.isFinite(direct)) return direct;
  const original = (err as { originalError?: { number?: unknown } }).originalError;
  const nested = original && typeof original === "object" ? Number(original.number) : undefined;
  return Number.isFinite(nested) ? nested : undefined;
}

export function assertPatientBootstrapAllowed(env = process.env) {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("Patient bootstrap is development-only and must not run in production.");
  }
}

export function getPatientBootstrapConfig(env = process.env): PatientBootstrapConfig {
  const username = env.PATIENT_BOOTSTRAP_USERNAME?.trim();
  const password = env.PATIENT_BOOTSTRAP_PASSWORD;
  if (!username || !password) {
    throw new Error("PATIENT_BOOTSTRAP_USERNAME and PATIENT_BOOTSTRAP_PASSWORD are required.");
  }
  return {
    username,
    password,
    patientHisId: env.PATIENT_BOOTSTRAP_HIS_ID?.trim() || "DEV-PT-001",
    firstName: env.PATIENT_BOOTSTRAP_FIRST_NAME?.trim() || "Development",
    lastName: env.PATIENT_BOOTSTRAP_LAST_NAME?.trim() || "Patient",
    email: env.PATIENT_BOOTSTRAP_EMAIL?.trim() || "dev.patient@localhost",
    dateOfBirth: env.PATIENT_BOOTSTRAP_BIRTH_DATE?.trim() || "1990-01-01",
  };
}

async function passwordMatches(hash: string | null | undefined, password: string) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function seedPatient(config = getPatientBootstrapConfig()) {
  assertPatientBootstrapAllowed();
  await initDb();
  const passwordHash = await bcrypt.hash(config.password, 12);
  const portalEmail = `${config.username}\n${config.email}`;

  const existingUser = await usersRepo.findUserByUsername(config.username);
  if (existingUser && existingUser.role !== PORTAL_USER_ROLE) {
    throw new Error(`Username "${config.username}" already belongs to a non-patient account.`);
  }

  const existingByHisId = await patientsRepo.findPatientByHisId(config.patientHisId);
  const existingByUsername = await patientsRepo.findPatientByPortalUsername(config.username);
  const existingPatient =
    existingByHisId ??
    existingByUsername ??
    (existingUser ? await patientsRepo.findPatientByPortalUserId(existingUser.id) : undefined);

  if (existingUser && existingPatient) {
    await usersRepo.updateUser(existingUser.id, { isActive: true });
    await usersRepo.setUserPassword(existingUser.id, passwordHash, true);
    const updated = await usersRepo.findUserById(existingUser.id);
    return {
      created: false as const,
      updated: true as const,
      username: config.username,
      patientHisId: existingPatient.patientHisId,
      lastName: existingPatient.lastName,
      passwordOk: updated ? await passwordMatches(updated.passwordHash, config.password) : false,
    };
  }

  if (existingPatient && !existingUser) {
    await patientsRepo.updateAccessCodeHash(existingPatient.id, passwordHash);
    await patientsRepo.updatePatient(existingPatient.id, {
      lastName: config.lastName,
      firstName: config.firstName,
      email: portalEmail,
    });
    const updated = await patientsRepo.findPatientById(existingPatient.id);
    return {
      created: false as const,
      updated: true as const,
      username: config.username,
      patientHisId: existingPatient.patientHisId,
      lastName: config.lastName,
      passwordOk: updated ? await passwordMatches(updated.accessCodeHash, config.password) : false,
    };
  }

  try {
    const patient = await withTransaction(async (tx) => {
      const user = await usersRepo.insertUser(
        {
          username: config.username,
          passwordHash,
          firstName: config.firstName,
          lastName: config.lastName,
          email: config.email,
          role: PORTAL_USER_ROLE,
        },
        tx,
      );
      return patientsRepo.insertPatient(
        {
          patientHisId: config.patientHisId,
          lastName: config.lastName,
          firstName: config.firstName,
          middleName: null,
          dateOfBirth: config.dateOfBirth,
          mobileNumber: null,
          email: config.email,
          accessCodeHash: passwordHash,
          createdById: null,
          portalUserId: user.id,
        },
        tx,
      );
    });
    return {
      created: true as const,
      updated: false as const,
      username: config.username,
      patientHisId: patient.patientHisId,
      lastName: patient.lastName,
      passwordOk: true,
    };
  } catch (err) {
    if (sqlErrorNumber(err) !== 547) throw err;
    const patient = await patientsRepo.insertPatient({
      patientHisId: config.patientHisId,
      lastName: config.lastName,
      firstName: config.firstName,
      middleName: null,
      dateOfBirth: config.dateOfBirth,
      mobileNumber: null,
      email: portalEmail,
      accessCodeHash: passwordHash,
      createdById: null,
      portalUserId: null,
    });
    return {
      created: true as const,
      updated: false as const,
      username: config.username,
      patientHisId: patient.patientHisId,
      lastName: patient.lastName,
      passwordOk: true,
    };
  }
}

async function main() {
  loadRootEnv();
  try {
    const result = await seedPatient();
    if (result.created) {
      console.log("Development patient portal account created.");
    } else {
      console.log("Development patient portal account updated.");
    }
    console.log(`Username: ${result.username}`);
    console.log(`Patient ID: ${result.patientHisId}`);
    console.log(`Last name: ${result.lastName}`);
    console.log(`Password matches .env: ${result.passwordOk ? "yes" : "no"}`);
  } finally {
    await closePool();
  }
}

if (isMainModule()) {
  main().catch(async () => {
    console.error("Seed failed.");
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
