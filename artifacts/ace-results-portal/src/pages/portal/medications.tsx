import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import {
  getGetPortalMedicationQueryKey,
  getListPortalMedicationsQueryKey,
  useGetPortalMedication,
  useListPortalMedications,
  type Prescription,
  type PrescriptionItem,
} from "@workspace/api-client-react";
import { PatientLayout } from "@/components/layout/patient-layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pill } from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64706A]">{label}</p>
      <p className="text-[14px] text-[#17221D]">{value}</p>
    </div>
  );
}

function MedicationItemFields({ item }: { item: PrescriptionItem }) {
  return (
    <div className="space-y-2 rounded-xl border border-[#E8EEEA] bg-[#F7FAF8] px-3 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F4EC] text-[#2F7D4A]">
          <Pill className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <DetailField label="Medication" value={item.medicineName} />
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailField label="Dosage" value={item.dosage} />
            <DetailField label="Frequency" value={item.frequency} />
            <DetailField label="Route" value={item.route} />
            <DetailField label="Duration" value={item.duration} />
            <DetailField label="Quantity" value={item.quantity} />
            <DetailField label="Generic name" value={item.genericName} />
          </div>
          <DetailField label="Instructions" value={item.instructions} />
        </div>
      </div>
    </div>
  );
}

function PrescriptionSummaryCard({
  prescription,
  highlight,
  cardRef,
  onOpen,
}: {
  prescription: Prescription;
  highlight: boolean;
  cardRef?: (node: HTMLElement | null) => void;
  onOpen: () => void;
}) {
  const first = prescription.items[0];
  return (
    <article
      ref={cardRef}
      id={`prescription-${prescription.id}`}
      className={`rounded-2xl border bg-white p-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] sm:p-5 space-y-3 ${
        highlight ? "border-[#2F7D4A] ring-2 ring-[#2F7D4A]/20" : "border-[#DDE5E0]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-[#17221D]">
            {first?.medicineName ?? "Prescription"}
            {prescription.items.length > 1
              ? ` +${prescription.items.length - 1} more`
              : ""}
          </p>
          <p className="text-[13px] text-[#64706A]">
            Prescribed by {prescription.physicianName}
          </p>
          <p className="text-[12px] text-[#64706A]">{formatDate(prescription.createdAt)}</p>
        </div>
      </div>

      {first ? (
        <div className="grid gap-2 sm:grid-cols-2 text-[13px]">
          <DetailField label="Dosage" value={first.dosage} />
          <DetailField label="Frequency" value={first.frequency} />
          <DetailField label="Duration" value={first.duration} />
          <DetailField label="Instructions" value={first.instructions} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="text-sm font-semibold text-[#2F7D4A] hover:underline"
      >
        View prescription details
      </button>
    </article>
  );
}

function PrescriptionDetailDialog({
  prescriptionId,
  open,
  onOpenChange,
}: {
  prescriptionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enabled = open && prescriptionId != null && prescriptionId > 0;
  const detail = useGetPortalMedication(prescriptionId ?? 0, {
    query: {
      queryKey: getGetPortalMedicationQueryKey(prescriptionId ?? 0),
      enabled,
      retry: false,
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prescription Details</DialogTitle>
          <DialogDescription>
            What your physician prescribed. This is informational documentation only.
          </DialogDescription>
        </DialogHeader>

        {!enabled ? null : detail.isLoading ? (
          <div className="space-y-3">
            <div className="h-16 animate-pulse rounded-xl bg-[#E8EEEA]" />
            <div className="h-24 animate-pulse rounded-xl bg-[#E8EEEA]" />
          </div>
        ) : detail.isError ? (
          <p className="text-sm text-[#17221D]">
            Unable to load this prescription. It may be unavailable or you may not have access.
          </p>
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailField label="Prescribed by" value={detail.data.physicianName} />
              <DetailField label="Date prescribed" value={formatDate(detail.data.createdAt)} />
              <DetailField label="Indication" value={detail.data.diagnosisOrIndication} />
            </div>
            {detail.data.generalInstructions ? (
              <DetailField label="General instructions" value={detail.data.generalInstructions} />
            ) : null}
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64706A]">
                Medications
              </p>
              {detail.data.items.map((item) => (
                <MedicationItemFields key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function PortalMedicationsPage() {
  const search = useSearch();
  const highlightId = useMemo(() => {
    const raw = new URLSearchParams(search).get("prescriptionId");
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [search]);

  const [detailId, setDetailId] = useState<number | null>(null);

  const query = useListPortalMedications({
    query: { queryKey: getListPortalMedicationsQueryKey() },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const highlightRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!highlightId || !query.isSuccess) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setDetailId(highlightId);
  }, [highlightId, query.isSuccess, query.data]);

  return (
    <PatientLayout title="MEDICATIONS">
      <div className="mx-auto max-w-xl space-y-5">
        {query.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-[#E8EEEA]" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-[#DDE5E0] bg-white p-6 text-center">
            <p className="font-semibold text-[#17221D]">Unable to load medications. Please try again.</p>
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-[#2F7D4A]"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-[#DDE5E0] bg-white p-8 text-center">
            <Pill className="mx-auto h-8 w-8 text-[#2F7D4A]" />
            <p className="mt-3 font-semibold text-[#17221D]">No prescriptions yet.</p>
            <p className="mt-1 text-sm text-[#64706A]">
              When your physician creates a prescription, it will appear here.
            </p>
          </div>
        ) : (
          <section className="space-y-3">
            <h2 className="text-[18px] font-bold text-[#17221D]">Your prescriptions</h2>
            <p className="text-sm text-[#64706A]">
              Medications as prescribed by your physician. Newest first.
            </p>
            {rows.map((row) => (
              <PrescriptionSummaryCard
                key={row.id}
                prescription={row}
                highlight={highlightId === row.id}
                cardRef={
                  highlightId === row.id
                    ? (node) => {
                        highlightRef.current = node;
                      }
                    : undefined
                }
                onOpen={() => setDetailId(row.id)}
              />
            ))}
          </section>
        )}
      </div>

      <PrescriptionDetailDialog
        prescriptionId={detailId}
        open={detailId != null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null);
        }}
      />
    </PatientLayout>
  );
}
