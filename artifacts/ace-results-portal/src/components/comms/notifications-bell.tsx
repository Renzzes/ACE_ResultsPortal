import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import {
  fetchNotificationUnreadCount,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type PortalNotification,
} from "@/lib/comms-api";
import { formatRelativeTime, notificationHref, priorityDotClass } from "@/lib/notification-utils";

type Variant = "staff" | "doctor" | "admin";

const shell: Record<Variant, { trigger: string; content: string; title: string; muted: string; accent: string; unreadBg: string; badge: string }> = {
  staff: {
    trigger: "relative h-11 w-11 rounded-xl border border-[hsl(var(--st-border))] bg-white text-[hsl(var(--st-text))] shadow-sm",
    content: "staff-shell w-[min(22rem,calc(100vw-2rem))] border-[hsl(var(--st-border))] bg-[hsl(var(--st-card))] p-0",
    title: "text-[hsl(var(--st-text))]",
    muted: "st-muted",
    accent: "text-[hsl(var(--st-green))]",
    unreadBg: "bg-[hsl(var(--st-green-soft))]/50",
    badge: "bg-[hsl(var(--st-green))]",
  },
  doctor: {
    trigger: "relative rounded-full h-12 w-12 text-[hsl(var(--doc-text))]",
    content: "w-[min(22rem,calc(100vw-2rem))] p-0 doctor-shell border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-card))]",
    title: "text-[hsl(var(--doc-text))]",
    muted: "doc-muted",
    accent: "text-[hsl(var(--doc-green))]",
    unreadBg: "bg-[hsl(var(--doc-green-soft))]/50",
    badge: "bg-[hsl(var(--doc-green))]",
  },
  admin: {
    trigger: "relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#E3E8E4] bg-white text-[#17251E]",
    content: "admin-shell w-[min(22rem,calc(100vw-2rem))] p-0",
    title: "text-[#17251E]",
    muted: "text-[#66756C]",
    accent: "text-[#1F6B45]",
    unreadBg: "bg-[#EAF5EE]/60",
    badge: "bg-[#8B3A46]",
  },
};

export function PortalNotificationsBell({
  variant,
  allHref,
}: {
  variant: Variant;
  allHref?: string;
}) {
  const { auth } = useAuth();
  const role = auth.user?.role ?? "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const styles = shell[variant];

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: fetchNotificationUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const listQuery = useQuery({
    queryKey: ["notifications-preview"],
    queryFn: () => fetchNotifications({ page: 1, limit: 15 }),
    enabled: open,
    refetchOnWindowFocus: true,
  });

  const prevUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    if (variant !== "staff") return;
    const count = unreadQuery.data?.count;
    if (typeof count !== "number") return;
    if (prevUnreadRef.current != null && count > prevUnreadRef.current) {
      // New desk notifications (e.g. doctor comments) — refresh Recent Activity promptly.
      void queryClient.invalidateQueries({ queryKey: ["staff-desk-overview"] });
    }
    prevUnreadRef.current = count;
  }, [variant, unreadQuery.data?.count, queryClient]);

  useEffect(() => {
    if (!open) return;
    void listQuery.refetch();
  }, [open]);

  const markReadMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-preview"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      void queryClient.invalidateQueries({ queryKey: ["staff-desk-overview"] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-preview"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
    },
  });

  const unread = unreadQuery.data?.count ?? 0;
  const items = listQuery.data?.data ?? [];

  const openItem = async (item: PortalNotification) => {
    if (!item.isRead) {
      try {
        await markReadMut.mutateAsync(item.id);
      } catch {
        /* still navigate */
      }
    }
    setOpen(false);
    setLocation(notificationHref(item, role));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "admin" ? (
          <button type="button" className={styles.trigger} aria-label="Notifications" title="Notifications">
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 ? (
              <span className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full ${styles.badge} px-1 text-[9px] font-bold text-white`}>
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={styles.trigger}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className={variant === "doctor" ? "w-7 h-7 sm:w-8 sm:h-8" : "h-5 w-5"} />
            {unread > 0 ? (
              <span
                className={`absolute ${variant === "doctor" ? "top-1.5 right-1.5" : "top-1 right-1"} min-w-4 h-4 px-1 rounded-full ${styles.badge} text-white text-[9px] font-bold flex items-center justify-center`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.content}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <p className={`font-semibold ${styles.title}`}>Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              className={`text-xs font-medium ${styles.accent} hover:underline`}
              onClick={() => markAllMut.mutate()}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <ul className="max-h-[22rem] overflow-y-auto">
          {listQuery.isLoading ? (
            <li className={`px-4 py-8 text-center text-sm ${styles.muted}`}>Loading…</li>
          ) : null}
          {listQuery.isError ? (
            <li className={`px-4 py-8 text-center text-sm ${styles.muted}`}>Unable to load notifications.</li>
          ) : null}
          {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
            <li className={`px-4 py-10 text-center text-sm ${styles.muted}`}>No new notifications.</li>
          ) : null}
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void openItem(item)}
                className={`w-full border-b px-4 py-3 text-left last:border-b-0 hover:opacity-90 ${
                  !item.isRead ? styles.unreadBg : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityDotClass(item.priority)}`} />
                    <p className={`text-sm ${!item.isRead ? "font-semibold" : "font-medium"} ${styles.title} line-clamp-1`}>
                      {item.title}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[11px] ${styles.muted}`}>{formatRelativeTime(item.createdAt)}</span>
                </div>
                <p className={`mt-0.5 pl-4 text-xs ${styles.muted} line-clamp-2`}>{item.body}</p>
              </button>
            </li>
          ))}
        </ul>
        {allHref ? (
          <div className="border-t px-4 py-2">
            <button
              type="button"
              className={`text-xs font-semibold ${styles.accent}`}
              onClick={() => {
                setOpen(false);
                setLocation(allHref);
              }}
            >
              View all
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function StaffNotificationsMenu() {
  return <PortalNotificationsBell variant="staff" allHref="/notifications" />;
}

export function DoctorNotificationsMenu() {
  return <PortalNotificationsBell variant="doctor" allHref="/physician/overview" />;
}

export function AdminNotificationsBell() {
  return <PortalNotificationsBell variant="admin" allHref="/admin/inbox" />;
}

