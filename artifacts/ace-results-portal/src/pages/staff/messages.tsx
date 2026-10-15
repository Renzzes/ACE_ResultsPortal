import { StaffLayout } from "@/components/layout/staff-layout";
import { MessagesWorkspace } from "@/components/comms/messages-workspace";

export default function StaffMessagesPage() {
  return (
    <StaffLayout title="Messages" fill>
      <MessagesWorkspace variant="staff" />
    </StaffLayout>
  );
}
