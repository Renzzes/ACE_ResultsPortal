export {
  loadRootEnv,
  findRepoRoot,
  resetRootEnvCache,
  type RootEnvLoadResult,
} from "./load-env";
export * from "./result-files";
export { initDb, closePool, getPool, withTransaction, sql } from "./pool";
export { getHisPool, closeHisPool, checkHisConnectivity } from "./his-pool";
export { getSchedulerPool, closeSchedulerPool, checkSchedulerConnectivity } from "./scheduler-pool";
export type { Transaction as DbTransaction } from "mssql";
export { loadDbConfig } from "./config";
export { loadHospitalDatabaseName, isHospitalUnavailableError } from "./hospital-config";
export { loadSchedulerDatabaseName, isSchedulerUnavailableError } from "./scheduler-config";
export * from "./types";

export * as usersRepo from "./repos/users";
export * as patientsRepo from "./repos/patients";
export * as patientSupportRequestsRepo from "./repos/patient-support-requests";
export * as patientPhysiciansRepo from "./repos/patient-physicians";
export * as patientDepartmentsRepo from "./repos/patient-departments";
export { PatientDepartmentSchemaError } from "./errors";
export type { PatientDepartmentMembership } from "./repos/patient-departments";
export * as resultPhysiciansRepo from "./repos/result-physicians";
export type { ResultPhysicianAssignment } from "./repos/result-physicians";
export * as resultReviewsRepo from "./repos/result-reviews";
export { ResultReviewSchemaError } from "./repos/result-reviews";
export type { ResultReview } from "./repos/result-reviews";
export * as prescriptionsRepo from "./repos/prescriptions";
export type {
  CreatePrescriptionInput,
  CreatePrescriptionItemInput,
} from "./repos/prescriptions";
export * as resultsRepo from "./repos/results";
export * as auditLogsRepo from "./repos/audit-logs";
export * as authSessionsRepo from "./repos/auth-sessions";
export * as adminOverviewRepo from "./repos/admin-overview";
export * as portalStorageRepo from "./repos/portal-storage";
export * as rolePermissionsRepo from "./repos/role-permissions";
export * as adminOpsRepo from "./repos/admin-ops";
export * as hospitalPatientsRepo from "./repos/hospital-patients";
export * as departmentsRepo from "./repos/departments";
export * as notificationsRepo from "./repos/notifications";
export * as announcementsRepo from "./repos/announcements";
export * as messagesRepo from "./repos/messages";
export * as schedulerAppointmentsRepo from "./repos/scheduler-appointments";
export {
  EXCLUDED_APPOINTMENT_STATUSES,
  PATIENT_HIS_ID_COLUMN,
  SchedulerQueryError,
  configuredPatientHisIdColumn,
  normalizePatientHisIdForLookup,
  type SchedulerAppointmentRow,
  type SchedulerPatientAppointmentsResult,
} from "./repos/scheduler-appointments";
export type { Department, DepartmentResultScope } from "./repos/departments";
export {
  seedPermissionsForDepartment,
  listRbacRoles,
} from "./repos/role-permissions";
export type {
  AdminOverviewResponse,
  AdminOverviewMetrics,
  AdminOverviewSeriesPoint,
  AdminOverviewRegistration,
  AdminOverviewPendingResult,
  AdminOverviewHealthItem,
} from "./repos/admin-overview";
export type { PortalStorageCompactSummary } from "./repos/portal-storage";
export type {
  RolePermissionRow,
  RolePermissionsMatrix,
  RolePermissionKey,
  RbacRole,
} from "./repos/role-permissions";
export {
  ROLE_PERMISSION_KEYS,
  RBAC_ROLES,
  roleHasPermission,
  ensureRolePermissionsCache,
  refreshRolePermissionsCache,
} from "./repos/role-permissions";
export { HospitalQueryError } from "./errors";
export type {
  HospitalIdentityMatch,
  HospitalIdentityQuery,
  HospitalPatientRecord,
  HospitalHisIdentityQuery,
} from "./repos/hospital-patients";
