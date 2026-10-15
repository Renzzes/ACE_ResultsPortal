import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton } from "./shared";

export function ActivityChart({
  data,
  loading,
  error,
  onRetry,
  onChangeRange,
}: {
  data: { day: string; uploaded: number }[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onChangeRange?: () => void;
}) {
  return (
    <WidgetFrame title="System Activity Overview">
      {loading ? (
        <WidgetSkeleton rows={6} />
      ) : error ? (
        <WidgetError onRetry={onRetry} />
      ) : data.length === 0 ? (
        <WidgetEmpty
          action={
            onChangeRange ? (
              <button type="button" onClick={onChangeRange} className="mt-3 text-[12px] font-semibold text-[#1F6B45]">
                Change Date Range
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#E3E8E4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#66756C" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#66756C" }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="uploaded" name="Results uploaded" stroke="#2F8F57" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-[#66756C]">
            Daily registration, release, and login series are not stored. Only result uploads for the last 30 days are available.
          </p>
        </>
      )}
    </WidgetFrame>
  );
}
