import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { PatientLayout } from "@/components/layout/patient-layout";
import { useAuth } from "@/lib/auth";
import {
  fetchPortalNotificationUnreadCount,
  fetchPortalNotifications,
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
  type PortalNotification,
} from "@/lib/comms-api";
import { formatRelativeTime, notificationHref } from "@/lib/notification-utils";
import { Bell, FileText, Megaphone } from "lucide-react";

function iconForType(type: string) {
  if (type === "announcement") return Megaphone;
  return FileText;
}

export default function PortalNotificationsPage() {
  const { portalAuth } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ["portal-notifications-unread"],
    queryFn: fetchPortalNotificationUnreadCount,
    enabled: Boolean(portalAuth.token),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const listQuery = useQuery({
    queryKey: ["portal-notifications-page"],
    queryFn: () => fetchPortalNotifications({ page: 1, limit: 50 }),
    enabled: Boolean(portalAuth.token),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const markReadMut = useMutation({
    mutationFn: markPortalNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-page"] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: markAllPortalNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-notifications-page"] });
    },
  });

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login" />;
  }

  const unread = unreadQuery.data?.count ?? 0;
  const items = listQuery.data?.data ?? [];

  const openItem = async (item: PortalNotification) => {
    if (!item.isRead) {
      try {
        await markReadMut.mutateAsync(item.id);
      } catch {
        /* still navigate — server remains authoritative */
      }
    }
    setLocation(notificationHref(item, "portal"));
  };

  return (
    <PatientLayout title="NOTIFICATIONS">
      <div className="mx-auto max-w-3xl">
        <section className="rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-[#8E3344]" />
              <h2 className="text-lg font-semibold text-[#17221D]">Notifications</h2>
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 ? (
                <>
                  <span className="rounded-full bg-[#F8ECEF] px-2.5 py-1 text-[11px] font-semibold text-[#8E3344]">
                    {unread > 99 ? "99+" : unread} new
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#2F7D4A] hover:underline"
                    onClick={() => markAllMut.mutate()}
                    disabled={markAllMut.isPending}
                  >
                    Mark all
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {listQuery.isLoading ? (
            <div className="mt-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-[#E8F4EC]/60" />
              ))}
            </div>
          ) : null}

          {listQuery.isError ? (
            <div className="mt-8 py-10 text-center">
              <p className="text-sm font-semibold text-[#17221D]">
                Unable to load notifications. Please try again.
              </p>
              <button
                type="button"
                className="mt-3 text-sm font-semibold text-[#2F7D4A] hover:underline"
                onClick={() => void listQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : null}

          {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
            <p className="mt-10 py-10 text-center text-sm text-[#64706A]">No notifications yet.</p>
          ) : null}

          {!listQuery.isLoading && !listQuery.isError && items.length > 0 ? (
            <ul className="mt-6 divide-y divide-[#DDE5E0]">
              {items.map((item) => {
                const Icon = iconForType(item.type);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={`flex w-full items-start gap-3 py-4 text-left ${
                        !item.isRead ? "bg-[#F6FBF8]/80" : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                          item.type === "announcement"
                            ? "bg-[#F8ECEF] text-[#8E3344]"
                            : "bg-[#E8F4EC] text-[#2F7D4A]"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-[#17221D] ${
                              !item.isRead ? "font-semibold" : "font-medium"
                            }`}
                          >
                            {item.title}
                          </p>
                          {!item.isRead ? (
                            <span className="h-2 w-2 rounded-full bg-[#8E3344]" aria-label="Unread" />
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-sm text-[#64706A]">{item.body}</p>
                        <p className="mt-1 text-xs text-[#64706A]">
                          {formatRelativeTime(item.createdAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </PatientLayout>
  );
}
