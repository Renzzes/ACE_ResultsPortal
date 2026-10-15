import { useQuery } from "@tanstack/react-query";
import { useAuth, useAuthoritativeRole } from "@/lib/auth";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Redirect } from "wouter";
import { departmentForRole, staffEmployeeName } from "@/lib/staff-identity";
import { fetchStaffDeskOverview } from "@/lib/staff-dashboard-api";
import { canCreatePatientsUi, canUploadResultFileUi } from "@/lib/staff-permissions";
import {
  DeskErrorState,
  DeskPrimaryActions,
  RecentActivityPanel,
  ResultsRequiringActionPanel,
  SummaryMetricCards,
  TodaysAppointmentsPanel,
} from "@/components/staff/dashboard-desk";

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StaffDashboard() {
  const { auth } = useAuth();
  const role = String(auth.user?.role ?? "");
  const department = departmentForRole(role);

  const deskQuery = useQuery({
    queryKey: ["staff-desk-overview"],
    queryFn: fetchStaffDeskOverview,
    retry: 1,
    // Keep Recent Activity live so doctor comments surface at the top without a manual refresh.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const desk = deskQuery.data;
  const loading = deskQuery.isLoading;
  const failed = deskQuery.isError;

  return (
    <StaffLayout
      title={`${greetingForNow()}, ${staffEmployeeName(auth.user)}`}
      clock
      fill
      subtitle={department}
      actions={(
        <DeskPrimaryActions
          canRegister={canCreatePatientsUi(role)}
          canUpload={canUploadResultFileUi(role, auth.user?.permissions)}
        />
      )}
    >
      {failed ? (
        <DeskErrorState onRetry={() => void deskQuery.refetch()} />
      ) : (
        <div className="flex min-h-0 flex-col gap-4 xl:h-full xl:flex-row xl:gap-4">
          {/* Main column scrolls on all sizes; appointments stacks below until xl rail */}
          <div className="st-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
            <SummaryMetricCards
              pending={desk?.stats.totalPending ?? 0}
              reviewedToday={desk?.stats.reviewedToday ?? 0}
              uploadedToday={desk?.stats.uploadsToday ?? 0}
              loading={loading || !desk}
            />

            <div className="grid min-h-0 gap-4 lg:grid-cols-2 xl:flex-1">
              <RecentActivityPanel desk={desk} loading={loading || !desk} />
              <ResultsRequiringActionPanel
                pending={desk?.pendingResults ?? []}
                loading={loading || !desk}
              />
            </div>

            <div className="xl:hidden">
              <TodaysAppointmentsPanel />
            </div>
          </div>

          <div className="hidden w-full flex-shrink-0 xl:flex xl:h-full xl:w-[22rem]">
            <TodaysAppointmentsPanel />
          </div>
        </div>
      )}
    </StaffLayout>
  );
}

export default function Dashboard() {
  const role = useAuthoritativeRole();
  if (role === "physician") return <Redirect to="/physician/overview" />;
  return <StaffDashboard />;
}
