import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AdminCard, Kpi } from "@/components/admin/shared";
import { fetchAdminMonitor } from "@/lib/admin-api";

export default function AdminMonitorPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-monitor"],
    queryFn: fetchAdminMonitor,
    refetchInterval: 15_000,
  });

  const sessions = data?.sessions ?? [];
  const alerts = data?.alerts ?? [];
  const events = data?.activity ?? [];

  return (
    <AdminLayout title="Live monitor" subtitle="Live sessions, alerts, and audit event stream from ACE_ResultsPortal.">
      <div className="space-y-5">
        {isError ? (
          <div className="ad-card rounded-xl p-4 text-sm text-[#8B3A46]">
            Unable to load monitor data.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="API"
            value={isError ? "Down" : isLoading ? "Checking" : "Healthy"}
            hint={isError ? "Monitor API failed" : "Database reachable"}
            tone={isError ? "maroon" : "green"}
          />
          <Kpi
            label="Open sessions"
            value={isLoading ? "—" : (data?.openSessions ?? 0)}
            hint="Active staff auth sessions"
          />
          <Kpi
            label="Pending work"
            value={isLoading ? "—" : (data?.pendingWork ?? 0)}
            hint="Results waiting"
            tone="maroon"
          />
          <Kpi
            label="Uploads today"
            value={isLoading ? "—" : (data?.uploadsToday ?? 0)}
            hint={isFetching ? "Refreshing…" : "Live count"}
            tone="gold"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <AdminCard className="p-5">
            <h2 className="mb-4 text-sm font-bold text-[#153D2B]">Who is on the site</h2>
            {isLoading ? (
              <p className="text-sm text-[#64706A]">Loading sessions…</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-[#64706A]">No open staff sessions right now.</p>
            ) : (
              <ul className="space-y-3">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#F6F4EF] px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-[#17221D]">{session.name}</p>
                      <p className="text-[12px] text-[#64706A]">
                        {session.role.replaceAll("_", " ")} · @{session.username}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[12px] font-semibold ${session.status === "active" ? "text-[#2F7D4A]" : "text-[#8a5a2b]"}`}>
                        {session.status === "active" ? "Active" : "Idle"}
                      </p>
                      <p className="text-[11px] text-[#64706A]">
                        {session.started} · {session.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
          <AdminCard className="p-5">
            <h2 className="mb-4 text-sm font-bold text-[#153D2B]">Alerts</h2>
            {isLoading ? (
              <p className="text-sm text-[#64706A]">Loading alerts…</p>
            ) : alerts.length === 0 ? (
              <p className="text-sm text-[#64706A]">No alerts.</p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((alert) => (
                  <li key={alert.id} className="rounded-xl border border-[#EFEBE3] px-3 py-2.5">
                    <p className="text-sm font-semibold text-[#17221D]">{alert.title}</p>
                    <p className="text-[12px] text-[#64706A]">{alert.body}</p>
                    <p className="mt-1 text-[11px] text-[#64706A]">{alert.time}</p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>

        <AdminCard className="p-5">
          <h2 className="mb-4 text-sm font-bold text-[#153D2B]">Event stream</h2>
          <ul className="space-y-2">
            {events.map((item) => (
              <li
                key={item.id}
                className="grid gap-1 border-b border-[#F1EEE8] py-2 text-sm last:border-0 sm:grid-cols-[9rem_8rem_minmax(0,1fr)] sm:items-center"
              >
                <span className="text-[#64706A]">{new Date(item.createdAt).toLocaleTimeString("en-PH")}</span>
                <span className="font-semibold capitalize text-[#153D2B]">{String(item.action).replaceAll("_", " ")}</span>
                <span className="text-[#17221D]">
                  {item.userName || "System"}
                  {item.details ? ` — ${item.details}` : ""}
                </span>
              </li>
            ))}
            {!isLoading && events.length === 0 ? (
              <li className="text-sm text-[#64706A]">No recent system activity</li>
            ) : null}
            {isLoading ? <li className="text-sm text-[#64706A]">Loading events…</li> : null}
          </ul>
        </AdminCard>
      </div>
    </AdminLayout>
  );
}
