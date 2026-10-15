import { Link } from "wouter";
import { formatDept } from "@/lib/admin-reports-range";
import { WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton } from "./shared";

export function ResultCategoriesTable({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: { category: string; count: number }[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <WidgetFrame
      title="Top Result Categories"
      action={
        <Link href="/admin/results" className="text-[12px] font-semibold text-[#1F6B45] no-underline">
          View full report →
        </Link>
      }
    >
      {loading ? (
        <WidgetSkeleton />
      ) : error ? (
        <WidgetError onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <WidgetEmpty title="No aggregated result-type data available." body="The system stores department categories, not named exam types such as CBC Panel." />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.category} className="flex items-center justify-between text-sm">
                <span className="font-medium text-[#17251E]">{formatDept(row.category)}</span>
                <span className="tabular-nums text-[#66756C]">{row.count.toLocaleString("en-PH")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[#66756C]">Exam-level result types are not stored. Counts are grouped by department category.</p>
        </>
      )}
    </WidgetFrame>
  );
}
