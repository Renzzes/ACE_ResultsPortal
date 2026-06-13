import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListPatients,
  getListPatientsQueryKey,
  useRegenerateAccessCode,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, RefreshCw, Eye, Plus, Search } from "lucide-react";

function formatDOB(dob: string) {
  return new Date(dob).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default function PatientsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data, isLoading } = useListPatients(
    { search: search || undefined, page, limit: 20 },
    { query: { queryKey: getListPatientsQueryKey({ search: search || undefined, page, limit: 20 }) } }
  );

  const regenerate = useRegenerateAccessCode();

  const copyCode = (id: number, code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleRegenerate = (id: number, hisId: string) => {
    regenerate.mutate({ id }, {
      onSuccess: () => toast({ title: "Access code regenerated", description: `New code issued for ${hisId}` }),
      onError: () => toast({ title: "Failed to regenerate code", variant: "destructive" }),
    });
  };

  const patients = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">Patients</h2>
            <p className="text-muted-foreground">Manage patient records and access codes</p>
          </div>
          <Button onClick={() => setLocation("/patients/new")}>
            <Plus className="w-4 h-4 mr-2" />
            New Patient
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or HIS ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading patients...</div>
          ) : patients.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground text-lg">No patients found.</p>
              <p className="text-sm text-muted-foreground mt-1">Register a new patient to get started.</p>
              <Button className="mt-4" onClick={() => setLocation("/patients/new")}>
                <Plus className="w-4 h-4 mr-2" />New Patient
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">HIS ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date of Birth</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Access Code</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Results</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {patients.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-primary font-medium">{p.patientHisId}</td>
                    <td className="px-4 py-3 font-medium">{p.lastName}, {p.firstName} {p.middleName ?? ""}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDOB(p.dateOfBirth)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{p.accessCode}</span>
                        <button
                          onClick={() => copyCode(p.id, p.accessCode)}
                          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Copy access code"
                        >
                          {copiedId === p.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.resultCount ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setLocation(`/patients/${p.id}`)}>
                          <Eye className="w-4 h-4 mr-1" />View
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRegenerate(p.id, p.patientHisId)}
                          disabled={regenerate.isPending}
                          title="Regenerate access code"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Showing {patients.length} of {total} patients</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
