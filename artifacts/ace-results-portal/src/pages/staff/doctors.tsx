import { useState } from "react";
import { useListPhysicians, getListPhysiciansQueryKey } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Input } from "@/components/ui/input";
import { Search, Stethoscope } from "lucide-react";

export default function ActiveDoctorsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListPhysicians(
    { search: search || undefined },
    { query: { queryKey: getListPhysiciansQueryKey({ search: search || undefined }) } },
  );
  const doctors = Array.isArray(data) ? data : [];

  return (
    <StaffLayout title="Active Doctors" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="st-muted text-sm">
            Physicians currently available for patient assignment.
          </p>
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 st-muted" />
            <Input
              className="pl-9 bg-[hsl(var(--st-card))] border-[hsl(var(--st-border))]"
              placeholder="Search by name or username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="st-card flex-1 min-h-0 overflow-auto rounded-2xl">
          {isLoading ? (
            <div className="p-8 text-center st-muted">Loading doctors...</div>
          ) : doctors.length === 0 ? (
            <div className="flex h-full min-h-[16rem] flex-col items-center justify-center p-12 text-center">
              <Stethoscope className="mb-3 h-8 w-8 text-[hsl(var(--st-green))]" />
              <p className="text-lg text-[hsl(var(--st-text))]">No active doctors found.</p>
              <p className="mt-1 text-sm st-muted">Try a different search, or check physician accounts.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[hsl(var(--st-cream))] border-b border-[hsl(var(--st-border))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium st-muted">Physician</th>
                  <th className="text-left px-4 py-3 font-medium st-muted">Username</th>
                  <th className="text-left px-4 py-3 font-medium st-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--st-border))]">
                {doctors.map((doctor) => (
                  <tr key={doctor.id} className="hover:bg-[hsl(var(--st-cream))]/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--st-green-soft))] text-xs font-semibold text-[hsl(var(--st-green))]">
                          {doctor.name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                        </span>
                        <span className="font-medium text-[hsl(var(--st-text))]">{doctor.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs st-muted">{doctor.username}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-[hsl(var(--st-green-soft))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--st-green))]">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs st-muted">{doctors.length} active {doctors.length === 1 ? "doctor" : "doctors"}</p>
      </div>
    </StaffLayout>
  );
}
