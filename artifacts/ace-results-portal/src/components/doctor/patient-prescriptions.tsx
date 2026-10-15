import { useMemo, useState } from "react";
import {
  getListPatientPrescriptionsPhysicianQueryKey,
  useCreatePatientPrescriptionPhysician,
  useListPatientPrescriptionsPhysician,
  type CreatePrescriptionRequest,
  type Prescription,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/doctor/shared";
import { useToast } from "@/hooks/use-toast";
import { Pill, Plus, X } from "lucide-react";

type ItemDraft = {
  key: string;
  medicineName: string;
  genericName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

function emptyItem(): ItemDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    medicineName: "",
    genericName: "",
    dosage: "",
    route: "Oral",
    frequency: "",
    duration: "",
    quantity: "",
    instructions: "",
  };
}

function formatRxDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide doc-muted">{label}</p>
      <p className="text-sm text-[hsl(var(--doc-text))]">{value}</p>
    </div>
  );
}

function PrescriptionDetailBody({ prescription }: { prescription: Prescription }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <FieldRow label="Date prescribed" value={formatRxDate(prescription.createdAt)} />
        <FieldRow label="Prescribing physician" value={prescription.physicianName} />
        <FieldRow label="Status" value={prescription.status} />
        <FieldRow label="Indication" value={prescription.diagnosisOrIndication} />
      </div>
      {prescription.generalInstructions ? (
        <FieldRow label="General instructions" value={prescription.generalInstructions} />
      ) : null}

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide doc-muted">Medication items</p>
        {prescription.items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))] px-3 py-3 space-y-2">
            <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">
              {index + 1}. {item.medicineName}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <FieldRow label="Dosage" value={item.dosage} />
              <FieldRow label="Frequency" value={item.frequency} />
              <FieldRow label="Route" value={item.route} />
              <FieldRow label="Duration" value={item.duration} />
              <FieldRow label="Quantity" value={item.quantity} />
              <FieldRow label="Generic name" value={item.genericName} />
            </div>
            <FieldRow label="Instructions" value={item.instructions} />
          </div>
        ))}
      </div>
    </div>
  );
}

function NewPrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  patientName: string;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const createMutation = useCreatePatientPrescriptionPhysician();
  const [diagnosis, setDiagnosis] = useState("");
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);

  const reset = () => {
    setDiagnosis("");
    setGeneralInstructions("");
    setItems([emptyItem()]);
  };

  const updateItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createMutation.isPending) return;

    for (const item of items) {
      if (!item.medicineName.trim()) {
        toast({ title: "Each medication item requires a medicine name.", variant: "destructive" });
        return;
      }
      if (!item.dosage.trim()) {
        toast({ title: "Each medication item requires dosage.", variant: "destructive" });
        return;
      }
      if (!item.frequency.trim()) {
        toast({ title: "Each medication item requires frequency.", variant: "destructive" });
        return;
      }
    }

    const payload: CreatePrescriptionRequest = {
      diagnosisOrIndication: diagnosis.trim() || undefined,
      generalInstructions: generalInstructions.trim() || undefined,
      items: items.map((item) => ({
        medicineName: item.medicineName.trim(),
        genericName: item.genericName.trim() || undefined,
        dosage: item.dosage.trim(),
        route: item.route.trim() || undefined,
        frequency: item.frequency.trim(),
        duration: item.duration.trim() || undefined,
        quantity: item.quantity.trim() || undefined,
        instructions: item.instructions.trim() || undefined,
      })),
    };

    createMutation.mutate(
      { patientId, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Prescription created" });
          reset();
          onOpenChange(false);
          onCreated();
        },
        onError: (err) => {
          toast({
            title: err instanceof Error ? err.message : "Unable to create prescription.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !createMutation.isPending) {
          onOpenChange(false);
        } else if (next) {
          onOpenChange(true);
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Prescription</DialogTitle>
          <DialogDescription>
            Create a prescription for {patientName}. A prescription may include multiple medication items.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rx-dx">Diagnosis / Indication</Label>
            <Input id="rx-dx" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} maxLength={500} />
          </div>

          {items.map((item, index) => (
            <div key={item.key} className="rounded-xl border border-[hsl(var(--doc-border))] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">
                  Medication item {index + 1}
                </p>
                {items.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={createMutation.isPending}
                    onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Medicine name <span className="text-destructive">*</span></Label>
                  <Input
                    value={item.medicineName}
                    onChange={(e) => updateItem(item.key, { medicineName: e.target.value })}
                    required
                    maxLength={255}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Generic name</Label>
                  <Input
                    value={item.genericName}
                    onChange={(e) => updateItem(item.key, { genericName: e.target.value })}
                    maxLength={255}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Dosage <span className="text-destructive">*</span></Label>
                  <Input
                    value={item.dosage}
                    onChange={(e) => updateItem(item.key, { dosage: e.target.value })}
                    required
                    maxLength={100}
                    placeholder="e.g. 500 mg"
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Route</Label>
                  <select
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                    value={item.route}
                    onChange={(e) => updateItem(item.key, { route: e.target.value })}
                    disabled={createMutation.isPending}
                  >
                    <option>Oral</option>
                    <option>IV</option>
                    <option>IM</option>
                    <option>Topical</option>
                    <option>Inhalation</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Frequency <span className="text-destructive">*</span></Label>
                  <Input
                    value={item.frequency}
                    onChange={(e) => updateItem(item.key, { frequency: e.target.value })}
                    required
                    maxLength={100}
                    placeholder="e.g. 3 times daily"
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Duration</Label>
                  <Input
                    value={item.duration}
                    onChange={(e) => updateItem(item.key, { duration: e.target.value })}
                    maxLength={100}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input
                    value={item.quantity}
                    onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                    maxLength={100}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Instructions</Label>
                  <Input
                    value={item.instructions}
                    onChange={(e) => updateItem(item.key, { instructions: e.target.value })}
                    maxLength={500}
                    disabled={createMutation.isPending}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={items.length >= 20 || createMutation.isPending}
            onClick={() => setItems((current) => [...current, emptyItem()])}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add another medication item
          </Button>

          <div className="space-y-1.5">
            <Label htmlFor="rx-general">General instructions</Label>
            <textarea
              id="rx-general"
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background resize-none"
              value={generalInstructions}
              onChange={(e) => setGeneralInstructions(e.target.value)}
              maxLength={4000}
              disabled={createMutation.isPending}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" disabled={createMutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Prescription"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrescriptionHistoryRow({
  prescription,
  onView,
}: {
  prescription: Prescription;
  onView: () => void;
}) {
  const count = prescription.items.length;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-card))] px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">
          {formatRxDate(prescription.createdAt)}
        </p>
        <p className="text-xs doc-muted">{prescription.physicianName}</p>
        <p className="text-xs doc-muted mt-0.5">
          {count} medication{count === 1 ? "" : "s"}
          {prescription.status !== "active" ? ` · ${prescription.status}` : ""}
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onView}>
        View
      </Button>
    </div>
  );
}

export function PhysicianPatientPrescriptions({
  patientId,
  patientName,
}: {
  patientId: number;
  patientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Prescription | null>(null);
  const query = useListPatientPrescriptionsPhysician(patientId, {
    query: {
      queryKey: getListPatientPrescriptionsPhysicianQueryKey(patientId),
      enabled: Number.isFinite(patientId) && patientId > 0,
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  return (
    <section className="doc-card rounded-2xl p-4 space-y-4 flex-shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Prescription History</h2>
          <p className="text-xs doc-muted">Recorded prescriptions for this patient (newest first).</p>
        </div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Prescription
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={Pill}
          title="Unable to load prescriptions"
          description="Please try again."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="No prescriptions have been recorded for this patient."
          description="Use New Prescription to create the first record."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <PrescriptionHistoryRow
              key={row.id}
              prescription={row}
              onView={() => setDetail(row)}
            />
          ))}
        </div>
      )}

      <NewPrescriptionDialog
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        patientName={patientName}
        onCreated={() => void query.refetch()}
      />

      <Dialog open={detail != null} onOpenChange={(next) => { if (!next) setDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prescription Details</DialogTitle>
            <DialogDescription>
              Historical prescription record. Content is informational documentation.
            </DialogDescription>
          </DialogHeader>
          {detail ? <PrescriptionDetailBody prescription={detail} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
