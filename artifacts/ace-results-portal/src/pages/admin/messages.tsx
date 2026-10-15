import { AdminLayout } from "@/components/layout/admin-layout";
import { MessagesWorkspace } from "@/components/comms/messages-workspace";

export default function AdminMessagesPage() {
  return (
    <AdminLayout title="Messages" subtitle="Secure staff and physician conversations.">
      <div className="h-[min(70vh,48rem)]">
        <MessagesWorkspace variant="admin" />
      </div>
    </AdminLayout>
  );
}
