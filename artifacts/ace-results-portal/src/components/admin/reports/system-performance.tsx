import { WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton } from "./shared";

export function SystemPerformance({
  health,
  loading,
  error,
  onRetry,
}: {
  health: "ok" | "down" | "checking";
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <WidgetFrame title="System Performance">
      {loading || health === "checking" ? (
        <WidgetSkeleton />
      ) : error ? (
        <WidgetError onRetry={onRetry} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#17251E]">API / database</span>
            <span className={`font-semibold ${health === "ok" ? "text-[#1F6B45]" : "text-[#8B3A46]"}`}>
              {health === "ok" ? "Operational" : "Unavailable"}
            </span>
          </div>
          <WidgetEmpty
            title="Performance telemetry is not currently available."
            body="Average response time, uptime, storage performance, and error rate are not collected by the API."
          />
        </div>
      )}
    </WidgetFrame>
  );
}
