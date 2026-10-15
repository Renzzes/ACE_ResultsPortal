import { useState } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useListPatients, getListPatientsQueryKey } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/staff-permissions";
import { Eye, Search } from "lucide-react";

function formatRegistered(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function patientName(lastName: string, firstName: string, middleName?: string | null) {
  const middle = middleName?.trim();
  return middle ? `${lastName}, ${firstName} ${middle}` : `${lastName}, ${firstName}`;
}

export default function PatientHistoryPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const { auth } = useAuth();
  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("search") ?? "");
  const debouncedSearch = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const role = auth.user?.role;

  const { data, isLoading, isError, refetch } = useListPatients(
    { search: debouncedSearch || undefined, page, limit: 20 },
    {
      query: {
        enabled: role !== "physician" && role !== "patient",
        queryKey: getListPatientsQueryKey({ search: debouncedSearch || undefined, page, limit: 20 }),
      },
    },
  );

  if (role === "physician") return <Redirect to="/physician/patients" />;
  if (role === "patient") return <Redirect to="/portal/dashboard" />;

  const patients = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <StaffLayout title="Patient History" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="st-muted text-sm">Patients registered for your department</p>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 st-muted" />
            <Input
              className="pl-9"
              placeholder="Search HIS ID, first or last name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="st-card flex-1 min-h-0 overflow-auto rounded-2xl">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground text-lg">Could not load patient history.</p>
              <Button className="mt-4" variant="outline" onClick={() => void refetch()}>Retry</Button>
            </div>
          ) : patients.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground text-lg">No patients found.</p>
              {debouncedSearch ? (
                <p className="text-sm text-muted-foreground mt-1">Try a different search.</p>
              ) : null}
            </div>
          ) : (
            <>
              <table className="hidden md:table w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-[hsl(var(--st-cream))] border-b border-[hsl(var(--st-border))]">
                  <tr>
                    <th className="w-[46%] text-left px-4 py-3 font-medium text-muted-foreground">Patient Name</th>
                    <th className="w-[22%] text-left px-4 py-3 font-medium text-muted-foreground">Patient ID</th>
                    <th className="w-[22%] text-left px-4 py-3 font-medium text-muted-foreground">Registered Date</th>
                    <th className="w-[10%] text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {patients.map((patient) => (
                    <tr
                      key={patient.id}
                      className="hover:bg-[hsl(var(--st-cream))]/80 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/patients/${patient.id}`)}
                    >
                      <td className="px-4 py-3 font-medium truncate">{patientName(patient.lastName, patient.firstName, patient.middleName)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[hsl(var(--st-green))] font-medium truncate">{patient.patientHisId}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatRegistered(patient.createdAt)}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setLocation(`/patients/${patient.id}`)}>
                            <Eye className="w-4 h-4 mr-1" />View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="md:hidden divide-y divide-border">
                {patients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    className="w-full text-left p-4 hover:bg-[hsl(var(--st-cream))]/80 transition-colors"
                    onClick={() => setLocation(`/patients/${patient.id}`)}
                  >
                    <p className="font-semibold truncate">{patientName(patient.lastName, patient.firstName, patient.middleName)}</p>
                    <p className="font-mono text-xs text-[hsl(var(--st-green))] mt-0.5">{patient.patientHisId}</p>
                    <p className="text-xs text-muted-foreground mt-2">Registered {formatRegistered(patient.createdAt)}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {patients.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Showing {patients.length} of {total} patients</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
