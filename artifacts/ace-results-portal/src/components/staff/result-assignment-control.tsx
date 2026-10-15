import { useState } from "react";
import {
  customFetch,
  getListPhysiciansQueryKey,
  useListPhysicians,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/staff-permissions";
import { preselectAttendingPhysicians } from "@/lib/result-upload-physicians";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

type Assigned = { id: number; name: string };

/**
 * Staff-only: assign, change, or clear the optional physician copies for a result.
 * Does not change patient visibility or release status.
 */
export function StaffResultAssignmentControl({
  resultId,
  assignedPhysician,
  assignedPhysicians,
  enabled,
  onUpdated,
}: {
  resultId: number;
  assignedPhysician?: Assigned | null;
  assignedPhysicians?: Assigned[];
  enabled: boolean;
  onUpdated?: (next: Assigned[]) => void;
}) {
  const { toast } = useToast();
  const initial = assignedPhysicians?.length
    ? assignedPhysicians
    : assignedPhysician
      ? [assignedPhysician]
      : [];
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Assigned[]>(initial);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const [open, setOpen] = useState(false);

  const { data: physicians, isLoading, isError } = useListPhysicians(
    { search: debounced || undefined },
    {
      query: {
        queryKey: getListPhysiciansQueryKey({ search: debounced || undefined }),
        enabled: enabled && editing,
      },
    },
  );

  const save = async (next: Assigned[]) => {
    const unique = preselectAttendingPhysicians(next);
    setSaving(true);
    try {
      await customFetch(`/api/results/${resultId}/assignment`, {
        method: "PUT",
        body: JSON.stringify({ physicianIds: unique.map((row) => row.id) }),
      });
      toast({ title: unique.length === 0 ? "Physician assignment removed" : "Physician assignment saved" });
      setSelected(unique);
      onUpdated?.(unique);
      setEditing(false);
      setSearch("");
      setOpen(false);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Unable to assign result.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) {
    return (
      <p className="text-xs st-muted">
        Assigned to:{" "}
        <span className="font-medium text-[hsl(var(--st-text))]">
          {initial.length ? initial.map((row) => row.name).join(", ") : "No physician assigned"}
        </span>
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs st-muted">
          Assigned to:{" "}
          <span className="font-medium text-[hsl(var(--st-text))]">
            {initial.length ? initial.map((row) => row.name).join(", ") : "No physician assigned"}
          </span>
        </p>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setSelected(initial); setEditing(true); }}>
          {initial.length ? "Change" : "Assign"}
        </Button>
        {initial.length ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void save([])}>
            Remove
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative space-y-1.5 max-w-sm">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((doctor) => (
            <span key={doctor.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
              {doctor.name}
              <button type="button" aria-label={`Remove ${doctor.name}`} onClick={() => setSelected((current) => current.filter((row) => row.id !== doctor.id))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No physician assigned</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-xs"
          placeholder="Search doctor..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={saving}
        />
        <Button type="button" size="sm" className="h-8 px-2" disabled={saving} onClick={() => void save(selected)}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {saving ? <p className="text-xs text-muted-foreground">Saving assignment...</p> : null}
      {open ? (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            onMouseDown={() => {
              setSelected([]);
              setOpen(false);
            }}
          >
            No physician assigned
          </button>
          {isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading doctors...</p>
          ) : isError ? (
            <p className="px-3 py-2 text-xs text-destructive">Unable to load doctors.</p>
          ) : !physicians?.length ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No doctors available</p>
          ) : (
            physicians.map((doctor) => (
              <button
                key={doctor.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted"
                onMouseDown={() => {
                  setSelected((current) => preselectAttendingPhysicians([...current, { id: doctor.id, name: doctor.name }]));
                  setSearch("");
                  setOpen(false);
                }}
              >
                <p className="text-xs font-medium">{doctor.name}</p>
                {doctor.username ? <p className="text-[10px] text-muted-foreground font-mono">{doctor.username}</p> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
