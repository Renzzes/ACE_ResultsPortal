import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Wire the token getter once — picks the right token based on the current route:
// portal pages use the patient session token, everything else uses the staff token.
setAuthTokenGetter(() => {
  if (window.location.pathname.includes("/portal")) {
    return localStorage.getItem("ace_portal_token");
  }
  return localStorage.getItem("ace_access_token");
});

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
      <Route path="/" component={() => <Redirect to="/login" />} />

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
