import { WidgetEmpty, WidgetFrame } from "./shared";

export function RecentReports({ onCreate }: { onCreate: () => void }) {
  return (
    <WidgetFrame
      title="Recent Reports"
      action={
        <button type="button" onClick={onCreate} className="text-[12px] font-semibold text-[#1F6B45]">
          View all reports →
        </button>
      }
    >
      <WidgetEmpty
        title="No reports generated yet."
        body="Report generation history is not stored in the current application."
        action={
          <button type="button" onClick={onCreate} className="mt-3 rounded-lg bg-[#0F3D2E] px-3 py-1.5 text-[12px] font-semibold text-white">
            Create Report
          </button>
        }
      />
    </WidgetFrame>
  );
}
