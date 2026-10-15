import {
  getGetPortalCareHistoryQueryKey,
  useGetPortalCareHistory,
} from "@workspace/api-client-react";
import { PatientLayout } from "@/components/layout/patient-layout";
import {
  CareHistoryHeader,
  CareHistoryLoadingSkeleton,
  CareHistoryTimeline,
} from "@/components/portal/care-history-timeline";

export default function PortalHistoryPage() {
  const query = useGetPortalCareHistory({
    query: { queryKey: getGetPortalCareHistoryQueryKey() },
  });

  const events = query.data?.events ?? [];
  const sources = query.data?.sources;
  const appointmentsSoft =
    sources?.appointments.status === "unavailable" ||
    sources?.appointments.status === "unconfigured";

  return (
    <PatientLayout title="HISTORY">
      <div className="mx-auto max-w-3xl">
        <section className="rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] sm:p-8">
          <CareHistoryHeader />

          {appointmentsSoft ? (
            <p className="mt-4 rounded-xl bg-[#F6F9F7] px-3 py-3 text-[13px] text-[#64706A]" role="status">
              {sources?.appointments.message ??
                "Appointment information is temporarily unavailable."}{" "}
              Results and prescriptions may still appear below.
            </p>
          ) : null}

          {query.isLoading ? (
            <div className="mt-8">
              <CareHistoryLoadingSkeleton count={5} />
            </div>
          ) : query.isError ? (
            <div className="mt-10 text-center">
              <p className="font-semibold text-[#17221D]">Unable to load your care history. Please try again.</p>
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="mt-4 rounded-lg bg-[#2F7D4A] px-4 py-2 text-sm font-semibold text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mt-8">
              <CareHistoryTimeline
                events={events}
                emptyMessage="No care history yet."
              />
            </div>
          )}
        </section>
      </div>
    </PatientLayout>
  );
}
