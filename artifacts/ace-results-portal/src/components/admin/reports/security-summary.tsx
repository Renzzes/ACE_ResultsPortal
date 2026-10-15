import { WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton } from "./shared";

export function SecuritySummary({
  loading,
  error,
  onRetry,
  loginCount,
  logoutCount,
  deniedCount,
  downloadCount,
  alerts,
}: {
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  loginCount?: number;
  logoutCount?: number;
  deniedCount?: number;
  downloadCount?: number;
  alerts: { id: number; title: string; body: string; time: string }[];
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <WidgetFrame title="Security overview">
        {loading ? (
          <WidgetSkeleton />
        ) : error ? (
          <WidgetError onRetry={onRetry} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Metric label="Successful logins" value={loginCount} />
            <Metric label="Logout events" value={logoutCount} />
            <Metric label="Access denied / failed logins" value={deniedCount} warn />
            <Metric label="Downloads" value={downloadCount} />
          </dl>
        )}
      </WidgetFrame>
      <WidgetFrame title="Security alerts">
        {loading ? (
          <WidgetSkeleton />
        ) : error ? (
          <WidgetError onRetry={onRetry} />
        ) : alerts.length === 0 ? (
          <WidgetEmpty title="No security alerts in this period" body="Access denied events will appear here when they occur." />
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-lg border border-[#E8D5D8] bg-[#FBF6F6] px-3 py-2">
                <p className="text-sm font-semibold text-[#8B3A46]">{alert.title}</p>
                <p className="text-[12px] text-[#66756C]">{alert.body}</p>
                <p className="mt-1 text-[11px] text-[#66756C]">{alert.time}</p>
              </li>
            ))}
          </ul>
        )}
      </WidgetFrame>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value?: number; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-[#F7F8F5] px-3 py-2">
      <dt className="text-[11px] text-[#66756C]">{label}</dt>
      <dd className={`mt-1 text-lg font-bold tabular-nums ${warn ? "text-[#8B3A46]" : "text-[#0F3D2E]"}`}>
        {value === undefined ? "—" : value.toLocaleString("en-PH")}
      </dd>
    </div>
  );
}
