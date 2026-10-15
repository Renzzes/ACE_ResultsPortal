import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/comms-api";
import { formatRelativeTime, notificationHref, priorityDotClass } from "@/lib/notification-utils";

export default function AdminInboxPage() {
  const { auth } = useAuth();
  const role = auth.user?.role ?? "super_admin";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ["notifications-page", tab, page],
    queryFn: () => fetchNotifications({ page, limit: 20, unreadOnly: tab === "unread" }),
  });

  const markReadMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const data = listQuery.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <AdminLayout title="Inbox" subtitle="Your personal notifications for results, messages, and announcements.">
      <section className="ad-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3E8E4] px-4 py-3">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={tab === "all" ? "default" : "outline"} onClick={() => { setTab("all"); setPage(1); }}>
              All
            </Button>
            <Button type="button" size="sm" variant={tab === "unread" ? "default" : "outline"} onClick={() => { setTab("unread"); setPage(1); }}>
              Unread
            </Button>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => markAllMut.mutate()}>
            Mark all read
          </Button>
        </div>
        {listQuery.isLoading ? <p className="px-4 py-6 text-sm text-[#66756C]">Loading…</p> : null}
        {listQuery.isError ? <p className="px-4 py-6 text-sm text-[#66756C]">Unable to load notifications.</p> : null}
        {!listQuery.isLoading && !listQuery.isError && (data?.data.length ?? 0) === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[#66756C]">No new notifications.</p>
        ) : null}
        <ul>
          {(data?.data ?? []).map((item) => (
            <li key={item.id} className="border-b border-[#E3E8E4] last:border-0">
              <button
                type="button"
                className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#EAF5EE] ${!item.isRead ? "bg-[#EAF5EE]/50" : ""}`}
                onClick={() => {
                  void markReadMut.mutateAsync(item.id).finally(() => setLocation(notificationHref(item, role)));
                }}
              >
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${priorityDotClass(item.priority)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <p className={`text-sm ${!item.isRead ? "font-semibold" : "font-medium"} text-[#17251E]`}>{item.title}</p>
                    <span className="shrink-0 text-[11px] text-[#66756C]">{formatRelativeTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#66756C]">{item.body}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {data && data.total > data.limit ? (
          <div className="flex items-center justify-between gap-2 border-t border-[#E3E8E4] px-4 py-3">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs text-[#66756C]">
              Page {page} of {totalPages}
            </span>
            <Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </section>
    </AdminLayout>
  );
}
