import { loadRootEnv, initDb, patientsRepo, closePool, closeHisPool } from "@workspace/db";
import { comparePassword, compareAccessCode } from "../../artifacts/api-server/src/lib/auth.js";
import { resolvePortalPatientForLogin } from "../../artifacts/api-server/src/lib/portal-registration.js";
import { resolveActivePortalAccount, resolveOrActivatePortalPatientForLogin } from "../../artifacts/api-server/src/lib/portal-activation.js";

loadRootEnv();

const hisId = process.argv[2] ?? "1240";
const password = process.argv[3] ?? "Joehphel@2026";
const lastName = process.argv[4] ?? "ROSAROSO";

async function main() {
  await initDb();

  const patient = await patientsRepo.findPatientByHisId(hisId);
  console.log(
    "patient:",
    patient
      ? {
          id: patient.id,
          hisId: patient.patientHisId,
          lastName: patient.lastName,
          portalUserId: patient.portalUserId,
          hasAccessCodeHash: Boolean(patient.accessCodeHash),
        }
      : null,
  );

  const resolved = await resolvePortalPatientForLogin(hisId);
  console.log(
    "resolved:",
    resolved ? { portalUserId: resolved.portalUserId, lastName: resolved.patient.lastName } : null,
  );

  const activated = await resolveOrActivatePortalPatientForLogin({ identifier: hisId, lastName, password });
  console.log("activateLogin:", activated ? { portalUserId: activated.portalUserId, activated: activated.activated } : null);

  const resolvedAfter = await resolvePortalPatientForLogin(hisId);
  console.log(
    "resolvedAfter:",
    resolvedAfter ? { portalUserId: resolvedAfter.portalUserId, lastName: resolvedAfter.patient.lastName } : null,
  );

  if (resolvedAfter) {
    const portal = await resolveActivePortalAccount(resolvedAfter.patient);
    console.log("portalAccount ok:", portal.ok);
    if (portal.ok) {
      console.log("user:", {
        id: portal.user.id,
        username: portal.user.username,
        isActive: portal.user.isActive,
        lockedUntil: portal.user.lockedUntil,
        failedAttempts: portal.user.failedLoginAttempts,
      });
      const pwMatch = await comparePassword(password, resolvedAfter.passwordHash);
      const acMatch = resolvedAfter.patient.accessCodeHash
        ? await compareAccessCode(password, resolvedAfter.patient.accessCodeHash)
        : false;
      console.log("passwordMatch:", pwMatch, "accessCodeMatch:", acMatch);
      console.log("lastNameMatch:", resolvedAfter.patient.lastName.toLowerCase() === lastName.toLowerCase());
    }
  }

  const res = await fetch("http://127.0.0.1:5000/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: hisId, lastName, password }),
  });
  console.log("api status:", res.status);
  console.log("api body:", await res.json());
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeHisPool();
  });
