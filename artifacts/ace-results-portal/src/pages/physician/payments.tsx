import { DoctorLayout } from "@/components/layout/doctor-layout";
import { EmptyState } from "@/components/doctor/shared";
import { CreditCard } from "lucide-react";

export default function PhysicianPaymentsPage() {
  return (
    <DoctorLayout title="Payments" fill>
      <div className="doc-card rounded-2xl h-full min-h-[60vh] flex items-center justify-center">
        <EmptyState
          icon={CreditCard}
          title="Payments are not available yet."
          description="Billing and payouts are deferred to hospital systems. No payment figures are shown from mock data."
        />
      </div>
    </DoctorLayout>
  );
}
