import { DoctorLayout } from "@/components/layout/doctor-layout";
import { MessagesWorkspace } from "@/components/comms/messages-workspace";

export default function PhysicianMessagesPage() {
  return (
    <DoctorLayout title="Messages" fill>
      <MessagesWorkspace variant="doctor" />
    </DoctorLayout>
  );
}
