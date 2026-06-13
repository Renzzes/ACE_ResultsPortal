import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";

const isPortalRoute = () => window.location.pathname.includes("/portal");

// Wire the token getter once — picks the right token based on the current route:
// portal pages use the patient session token, everything else uses the staff token.
setAuthTokenGetter(() => {
  if (isPortalRoute()) {
    return localStorage.getItem("ace_portal_token");
  }
  return localStorage.getItem("ace_access_token");
});

// On a 401 for staff routes, silently exchange the refresh token for a new
// access token and retry the original request once. A single in-flight refresh
// is shared across concurrent 401s.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshStaffToken(): Promise<boolean> {
  // The patient portal has its own short-lived token with no refresh flow.
  if (isPortalRoute()) return false;

  const refreshToken = localStorage.getItem("ace_refresh_token");
  if (!refreshToken) return false;

  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      // Refresh token is invalid/expired — clear the stale session.
      localStorage.removeItem("ace_user");
      localStorage.removeItem("ace_access_token");
      localStorage.removeItem("ace_refresh_token");
      if (!window.location.pathname.endsWith("/login")) {
        window.location.assign(`${import.meta.env.BASE_URL}login`);
      }
      return false;
    }
    const data = await res.json();
    localStorage.setItem("ace_access_token", data.accessToken);
    localStorage.setItem("ace_refresh_token", data.refreshToken);
    if (data.user) localStorage.setItem("ace_user", JSON.stringify(data.user));
    return true;
  } catch {
    return false;
  }
}

setUnauthorizedHandler(() => {
  if (!refreshInFlight) {
    refreshInFlight = refreshStaffToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
});

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import PatientsPage from "@/pages/patients/index";
import NewPatientPage from "@/pages/patients/new";
import PatientDetailPage from "@/pages/patients/detail";
import ResultsPage from "@/pages/results/index";
import UploadResultPage from "@/pages/results/upload";
import UsersPage from "@/pages/users/index";
import NewUserPage from "@/pages/users/new";
import AuditLogsPage from "@/pages/audit-logs/index";
import ArchivePage from "@/pages/archive/index";
import SettingsPage from "@/pages/settings/index";
import PatientPortalPage from "@/pages/portal/index";
import PortalResultsPage from "@/pages/portal/results";
import PhysicianSearchPage from "@/pages/physician/search";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { auth } = useAuth();
  if (!auth.user) return <Redirect to="/login" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />

      {/* Auth */}
      <Route path="/login" component={Login} />

      {/* Staff Portal */}
      <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/patients/new">{() => <ProtectedRoute component={NewPatientPage} />}</Route>
      <Route path="/patients/:id">{() => <ProtectedRoute component={PatientDetailPage} />}</Route>
      <Route path="/patients">{() => <ProtectedRoute component={PatientsPage} />}</Route>
      <Route path="/results/upload">{() => <ProtectedRoute component={UploadResultPage} />}</Route>
      <Route path="/results">{() => <ProtectedRoute component={ResultsPage} />}</Route>
      <Route path="/users/new">{() => <ProtectedRoute component={NewUserPage} />}</Route>
      <Route path="/users">{() => <ProtectedRoute component={UsersPage} />}</Route>
      <Route path="/audit-logs">{() => <ProtectedRoute component={AuditLogsPage} />}</Route>
      <Route path="/archive">{() => <ProtectedRoute component={ArchivePage} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} />}</Route>

      {/* Physician Portal */}
      <Route path="/physician/search">{() => <ProtectedRoute component={PhysicianSearchPage} />}</Route>

      {/* Patient Portal (own auth) */}
      <Route path="/portal/results" component={PortalResultsPage} />
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
