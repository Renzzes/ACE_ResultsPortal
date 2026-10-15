import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { fetchAdminNotifications, type AdminNotificationItem } from "@/lib/admin-api";

const READ_KEY = "ace_admin_notification_reads";

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
}

export default function AdminNotificationsPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: fetchAdminNotifications,
    refetchInterval: 30_000,
  });
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());

  useEffect(() => {
    saveReadIds(readIds);
  }, [readIds]);

  const items = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.map((item) => ({
      ...item,
      unread: item.unread && !readIds.has(item.id),
    }));
  }, [data?.data, readIds]);

  function markRead(item: AdminNotificationItem) {
    setReadIds((current) => new Set(current).add(item.id));
    setLocation(item.href);
  }

  return (
    <AdminLayout title="Notifications" subtitle="Operational alerts from pending work, security events, and storage.">
      <section className="ad-card overflow-hidden rounded-xl">
        {isError ? (
          <div className="px-4 py-6 text-sm text-[#8B3A46]">
            Unable to load notifications.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        ) : null}
        {isLoading ? <p className="px-4 py-6 text-sm text-[#66756C]">Loading notifications…</p> : null}
        {!isLoading && !isError && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#66756C]">No notifications right now.</p>
        ) : null}
        <ul>
          {items.map((item) => (
            <li key={item.id} className="border-b border-[#E3E8E4] last:border-0">
              <button
                type="button"
                className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#EAF5EE] ${item.unread ? "bg-[#EAF5EE]/50" : ""}`}
                onClick={() => markRead(item)}
              >
                {item.unread ? (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#8B3A46]" />
                ) : (
                  <span className="mt-2 h-2 w-2 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#17251E]">{item.title}</p>
                  <p className="text-sm text-[#66756C]">{item.body}</p>
                </div>
                <span className="text-[11px] text-[#66756C]">
                  {new Date(item.createdAt).toLocaleString("en-PH", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </AdminLayout>
  );
}
