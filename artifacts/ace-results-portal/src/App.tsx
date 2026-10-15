import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, normalizeUser, noteStaffRefreshOutcome, useAuth, useAuthoritativeRole } from "@/lib/auth";
import {
  ACCESS_TOKEN_KEY,
  PORTAL_TOKEN_KEY,
  SESSION_PUBLIC_ID_KEY,
  STAFF_PORTAL_ROLES,
  USER_PROFILE_KEY,
  clearTabAuth,
  decideRoleRoute,
  readSessionPublicId,
  sessionRefreshPath,
} from "@/lib/workflow-stability";
import { setAuthTokenGetter, setPortalAccessCodeGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { getStoredPortalResultsAccessCode } from "@/lib/portal-results-access";

const isPortalRoute = () => window.location.pathname.includes("/portal");

// Wire the token getter once — picks the right token based on the current route:
// portal pages use the patient session token, everything else uses the staff token.
setAuthTokenGetter(() => {
  if (isPortalRoute()) {
    return sessionStorage.getItem(PORTAL_TOKEN_KEY);
  }
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
});

setPortalAccessCodeGetter(() => getStoredPortalResultsAccessCode());

// On a 401 for staff routes, silently exchange the refresh token for a new
// access token and retry the original request once. A single in-flight refresh
// is shared across concurrent 401s.
let refreshInFlight: Promise<boolean> | null = null;

function clearRejectedTabSession() {
  clearTabAuth(sessionStorage);
  noteStaffRefreshOutcome("rejected");
  if (!window.location.pathname.endsWith("/login")) {
    const login = isPortalRoute() ? "login?as=patient" : "login";
    window.location.assign(`${import.meta.env.BASE_URL}${login}`);
  }
}

async function refreshTabSession(): Promise<boolean> {
  const sessionPublicId = readSessionPublicId(sessionStorage);
  if (!sessionPublicId) {
    clearRejectedTabSession();
    return false;
  }

  try {
    const res = await fetch(sessionRefreshPath(sessionPublicId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      clearRejectedTabSession();
      return false;
    }
    const data = (await res.json()) as { accessToken?: string; sessionPublicId?: string };
    if (!data.accessToken) {
      clearRejectedTabSession();
      return false;
    }
    if (isPortalRoute()) {
      sessionStorage.setItem(PORTAL_TOKEN_KEY, data.accessToken);
    } else {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
      const raw = sessionStorage.getItem(USER_PROFILE_KEY);
      if (raw) {
        sessionStorage.setItem(USER_PROFILE_KEY, JSON.stringify(normalizeUser(JSON.parse(raw), data.accessToken)));
      }
    }
    if (data.sessionPublicId) sessionStorage.setItem(SESSION_PUBLIC_ID_KEY, data.sessionPublicId);
    window.dispatchEvent(new Event("ace-staff-auth"));
    noteStaffRefreshOutcome("refreshed");
    return true;
  } catch {
    noteStaffRefreshOutcome("network");
    return false;
  }
}

setUnauthorizedHandler(() => {
  if (!refreshInFlight) {
    refreshInFlight = refreshTabSession().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
});

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import RecoverPage from "@/pages/recover";
import Dashboard from "@/pages/dashboard";
import PatientsPage from "@/pages/patients/index";
import PatientHistoryPage from "@/pages/patients/history";
import NewPatientPage from "@/pages/patients/new";
import PatientDetailPage from "@/pages/patients/detail";
import ResultsPage from "@/pages/results/index";
import ResultDetailPage from "@/pages/results/detail";
import UploadResultPage from "@/pages/results/upload";
import UsersPage from "@/pages/users/index";
import NewUserPage from "@/pages/users/new";
import AuditLogsPage from "@/pages/audit-logs/index";
import ArchivePage from "@/pages/archive/index";
import SettingsPage from "@/pages/settings/index";
import StaffMessagesPage from "@/pages/staff/messages";
import StaffNotificationsPage from "@/pages/staff/notifications";
import ActiveDoctorsPage from "@/pages/staff/doctors";
import PortalHomePage from "@/pages/portal/home";
import PatientPortalPage from "@/pages/portal/index";
import PortalDashboardPage from "@/pages/portal/dashboard";
import PortalResultsPage from "@/pages/portal/results";
import PortalHistoryPage from "@/pages/portal/history";
import PortalMedicationsPage from "@/pages/portal/medications";
import PortalNotificationsPage from "@/pages/portal/notifications";
import PortalMessagesPage from "@/pages/portal/messages";
import PhysicianSearchPage from "@/pages/physician/search";
import PhysicianOverview from "@/pages/physician/overview";
import PhysicianAppointmentsPage from "@/pages/physician/appointments";
import PhysicianPatientsPage from "@/pages/physician/patients";
import PhysicianPatientDetail from "@/pages/physician/patient-detail";
import PhysicianResultsPage from "@/pages/physician/results";
import PhysicianPaymentsPage from "@/pages/physician/payments";
import PhysicianMessagesPage from "@/pages/physician/messages";
import PhysicianSettings from "@/pages/physician/settings";
import AdminOverviewPage from "@/pages/admin/overview";
import AdminStaffPage from "@/pages/admin/staff";
import AdminDoctorsPage from "@/pages/admin/doctors";
import AdminPatientsPage from "@/pages/admin/patients";
import AdminSupportRequestsPage from "@/pages/admin/support-requests";
import PortalChangePasswordPage from "@/pages/portal/change-password";
import AdminMessagesPage from "@/pages/admin/messages";
import AdminAnnouncementsPage from "@/pages/admin/announcements";
import AdminInboxPage from "@/pages/admin/inbox";
import AdminStoragePage from "@/pages/admin/storage";
import AdminStorageFilesPage from "@/pages/admin/storage-files";
import AdminHistoryPage from "@/pages/admin/history";
import AdminReportsPage from "@/pages/admin/reports";
import AdminMonitorPage from "@/pages/admin/monitor";
import AdminRolesPage from "@/pages/admin/roles";
import AdminDepartmentsPage from "@/pages/admin/departments";
import AdminResultsPage from "@/pages/admin/results";
import AdminArchivePage from "@/pages/admin/archive";
import AdminNotificationsPage from "@/pages/admin/notifications";
import AdminSettingsPage from "@/pages/admin/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RouteDecisionView({
  decision,
  component: Component,
}: {
  decision: ReturnType<typeof decideRoleRoute>;
  component: React.ComponentType;
}) {
  if (decision.kind === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading session…</div>;
  }
  if (decision.kind === "login" || decision.kind === "redirect") return <Redirect to={decision.to} />;
  return <Component />;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { auth, sessionReady } = useAuth();
  if (!sessionReady) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading session…</div>;
  }
  if (!auth.user) return <Redirect to="/login" />;
  return <Component />;
}

function StaffPortalRoute({ component: Component }: { component: React.ComponentType }) {
  const { auth, sessionReady } = useAuth();
  const role = useAuthoritativeRole();
  const decision = decideRoleRoute({
    sessionReady,
    hasUser: Boolean(auth.user),
    role,
    allowedRoles: [...STAFF_PORTAL_ROLES, "super_admin"],
    loginTo: "/login",
  });
  return <RouteDecisionView decision={decision} component={Component} />;
}

function RoleRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles: string[];
}) {
  const { auth, sessionReady } = useAuth();
  const role = useAuthoritativeRole();
  const loginTo = roles.length === 1 && roles[0] === "physician" ? "/login?as=doctor" : "/login";
  const decision = decideRoleRoute({
    sessionReady,
    hasUser: Boolean(auth.user),
    role,
    allowedRoles: roles,
    loginTo,
  });
  return <RouteDecisionView decision={decision} component={Component} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />

      {/* Auth */}
      <Route path="/login" component={Login} />
      <Route path="/register">{() => <Redirect to="/login?as=patient&register=1" />}</Route>
      <Route path="/recover" component={RecoverPage} />

      {/* Staff Portal */}
      <Route path="/dashboard">{() => <StaffPortalRoute component={Dashboard} />}</Route>
      <Route path="/patients/new">{() => <StaffPortalRoute component={NewPatientPage} />}</Route>
      <Route path="/patients/history">{() => <StaffPortalRoute component={PatientHistoryPage} />}</Route>
      <Route path="/patients/:id">{() => <StaffPortalRoute component={PatientDetailPage} />}</Route>
      <Route path="/patients">{() => <StaffPortalRoute component={PatientsPage} />}</Route>
      <Route path="/results/upload">{() => <StaffPortalRoute component={UploadResultPage} />}</Route>
      <Route path="/results/:id">{() => <StaffPortalRoute component={ResultDetailPage} />}</Route>
      <Route path="/results">{() => <StaffPortalRoute component={ResultsPage} />}</Route>
      <Route path="/users/new">{() => <RoleRoute component={NewUserPage} roles={["super_admin"]} />}</Route>
      <Route path="/users">{() => <RoleRoute component={UsersPage} roles={["super_admin"]} />}</Route>
      <Route path="/audit-logs">{() => <RoleRoute component={AuditLogsPage} roles={["super_admin", "medical_records"]} />}</Route>
      <Route path="/archive">{() => <RoleRoute component={ArchivePage} roles={["super_admin", "medical_records"]} />}</Route>
      <Route path="/doctors">{() => <RoleRoute component={ActiveDoctorsPage} roles={["super_admin", "medical_records", "laboratory", "radiology"]} />}</Route>
      <Route path="/messages">{() => <RoleRoute component={StaffMessagesPage} roles={["super_admin", "medical_records", "laboratory", "radiology"]} />}</Route>
      <Route path="/notifications">{() => <RoleRoute component={StaffNotificationsPage} roles={["super_admin", "medical_records", "laboratory", "radiology"]} />}</Route>
      <Route path="/settings">{() => <StaffPortalRoute component={SettingsPage} />}</Route>

      {/* Admin Control */}
      <Route path="/admin/staff">{() => <RoleRoute component={AdminStaffPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/doctors">{() => <RoleRoute component={AdminDoctorsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/patients">{() => <RoleRoute component={AdminPatientsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/support-requests">{() => <RoleRoute component={AdminSupportRequestsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/roles">{() => <RoleRoute component={AdminRolesPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/departments">{() => <RoleRoute component={AdminDepartmentsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/results">{() => <RoleRoute component={AdminResultsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/archive">{() => <RoleRoute component={AdminArchivePage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/messages">{() => <RoleRoute component={AdminMessagesPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/announcements">{() => <RoleRoute component={AdminAnnouncementsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/inbox">{() => <RoleRoute component={AdminInboxPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/notifications">{() => <RoleRoute component={AdminNotificationsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/storage/files">{() => <RoleRoute component={AdminStorageFilesPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/storage">{() => <RoleRoute component={AdminStoragePage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/history">{() => <RoleRoute component={AdminHistoryPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/reports">{() => <RoleRoute component={AdminReportsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/monitor">{() => <RoleRoute component={AdminMonitorPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin/settings">{() => <RoleRoute component={AdminSettingsPage} roles={["super_admin"]} />}</Route>
      <Route path="/admin">{() => <RoleRoute component={AdminOverviewPage} roles={["super_admin"]} />}</Route>

      {/* Physician Portal */}
      <Route path="/physician/overview">{() => <RoleRoute component={PhysicianOverview} roles={["physician"]} />}</Route>
      <Route path="/physician/appointments">{() => <RoleRoute component={PhysicianAppointmentsPage} roles={["physician"]} />}</Route>
      <Route path="/physician/patients/:id">{() => <RoleRoute component={PhysicianPatientDetail} roles={["physician"]} />}</Route>
      <Route path="/physician/patients">{() => <RoleRoute component={PhysicianPatientsPage} roles={["physician"]} />}</Route>
      <Route path="/physician/results">{() => <RoleRoute component={PhysicianResultsPage} roles={["physician"]} />}</Route>
      <Route path="/physician/payments">{() => <RoleRoute component={PhysicianPaymentsPage} roles={["physician"]} />}</Route>
      <Route path="/physician/messages">{() => <RoleRoute component={PhysicianMessagesPage} roles={["physician"]} />}</Route>
      <Route path="/physician/settings">{() => <RoleRoute component={PhysicianSettings} roles={["physician"]} />}</Route>
      <Route path="/physician/search">{() => <ProtectedRoute component={PhysicianSearchPage} />}</Route>

      {/* Patient Portal (own auth) */}
      <Route path="/portal/change-password" component={PortalChangePasswordPage} />
      <Route path="/portal/home" component={PortalHomePage} />
      <Route path="/portal/dashboard" component={PortalDashboardPage} />
      <Route path="/portal/history" component={PortalHistoryPage} />
      <Route path="/portal/results" component={PortalResultsPage} />
      <Route path="/portal/messages" component={PortalMessagesPage} />
      <Route path="/portal/medications" component={PortalMedicationsPage} />
      <Route path="/portal/notifications" component={PortalNotificationsPage} />
      <Route path="/portal" component={PatientPortalPage} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
