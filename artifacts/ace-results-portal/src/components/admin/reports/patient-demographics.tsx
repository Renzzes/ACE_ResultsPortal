import { WidgetEmpty, WidgetFrame } from "./shared";

export function PatientDemographics() {
  return (
    <WidgetFrame title="Patient Demographics">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">Gender distribution</p>
          <WidgetEmpty
            title="Gender data unavailable"
            body="Portal patient records do not include gender. This chart is not populated."
          />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">Age group distribution</p>
          <WidgetEmpty
            title="Age aggregates unavailable"
            body="Date of birth exists on patient records, but there is no privacy-safe age aggregation endpoint."
          />
        </div>
      </div>
    </WidgetFrame>
  );
}
