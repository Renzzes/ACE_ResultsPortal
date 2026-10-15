import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatDept } from "@/lib/admin-reports-range";
import { WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton } from "./shared";

const COLORS = ["#2F8F57", "#1F6B45", "#0F3D2E", "#8B3A46", "#B7791F", "#66756C", "#3D5A80", "#6B8F71", "#9AA59E"];

export function DepartmentChart({
  rows,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  rows: { category: string; count: number }[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSelect?: (category: string) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <WidgetFrame title="Results by Department">
      {loading ? (
        <WidgetSkeleton />
      ) : error ? (
        <WidgetError onRetry={onRetry} />
      ) : rows.length === 0 || total === 0 ? (
        <WidgetEmpty title="No department data" body="No results are available to group by department." />
      ) : (
        <div className="grid items-center gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div className="relative mx-auto h-32 w-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="count" innerRadius={38} outerRadius={58} paddingAngle={2} stroke="none">
                  {rows.map((row, index) => (
                    <Cell key={row.category} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[10px] uppercase tracking-wide text-[#66756C]">Total</p>
              <p className="text-sm font-bold tabular-nums text-[#0F3D2E]">{total.toLocaleString("en-PH")}</p>
            </div>
          </div>
          <ul className="space-y-1.5 text-[12px]">
            {rows.map((row, index) => (
              <li key={row.category}>
                <button
                  type="button"
                  onClick={() => onSelect?.(row.category)}
                  className="flex w-full items-center justify-between gap-2 text-left hover:text-[#1F6B45]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                    <span className="truncate">{formatDept(row.category)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[#66756C]">
                    {row.count.toLocaleString("en-PH")} · {total ? ((row.count / total) * 100).toFixed(1) : "0"}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}
