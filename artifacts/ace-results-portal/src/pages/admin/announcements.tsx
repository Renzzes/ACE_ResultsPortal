import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createAnnouncement,
  fetchAnnouncements,
  publishAnnouncement,
  type Announcement,
} from "@/lib/comms-api";
import { formatRelativeTime } from "@/lib/notification-utils";

const TARGET_OPTIONS = [
  { key: "all_staff", label: "All Staff", targetType: "all_staff" as const, targetValue: null },
  { key: "all_physicians", label: "All Physicians", targetType: "all_physicians" as const, targetValue: null },
  { key: "all_patients", label: "All Patients", targetType: "all_patients" as const, targetValue: null },
  { key: "laboratory", label: "Laboratory", targetType: "department" as const, targetValue: "laboratory" },
  { key: "radiology", label: "Radiology", targetType: "department" as const, targetValue: "radiology" },
  { key: "medical_records", label: "Medical Records", targetType: "department" as const, targetValue: "medical_records" },
];

export default function AdminAnnouncementsPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [selectedTargets, setSelectedTargets] = useState<string[]>(["all_staff"]);

  const listQuery = useQuery({
    queryKey: ["announcements-admin"],
    queryFn: () => fetchAnnouncements({ includeDrafts: true, page: 1 }),
  });

  const createMut = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: () => {
      setTitle("");
      setBody("");
      setPriority("normal");
      setSelectedTargets(["all_staff"]);
      void queryClient.invalidateQueries({ queryKey: ["announcements-admin"] });
    },
  });

  const publishMut = useMutation({
    mutationFn: publishAnnouncement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["announcements-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const toggleTarget = (key: string) => {
    setSelectedTargets((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };

  const submit = () => {
    const targets = TARGET_OPTIONS.filter((o) => selectedTargets.includes(o.key)).map((o) => ({
      targetType: o.targetType,
      targetValue: o.targetValue,
    }));
    if (!title.trim() || !body.trim() || targets.length === 0) return;
    createMut.mutate({ title: title.trim(), body: body.trim(), priority, targets });
  };

  const items: Announcement[] = listQuery.data?.data ?? [];

  return (
    <AdminLayout title="Announcements" subtitle="Publish operational notices to staff, physicians, and patients.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <section className="ad-card rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-[#0F3D2E]">Create announcement</h2>
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
          <Textarea placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
          <label className="block text-xs font-semibold text-[#66756C]">
            Priority
            <select
              className="mt-1 w-full rounded-md border border-[#E3E8E4] px-2 py-2 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <div>
            <p className="text-xs font-semibold text-[#66756C] mb-2">Audience</p>
            <div className="space-y-1">
              {TARGET_OPTIONS.map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 text-sm text-[#17251E]">
                  <input
                    type="checkbox"
                    checked={selectedTargets.includes(opt.key)}
                    onChange={() => toggleTarget(opt.key)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {createMut.isError ? <p className="text-xs text-[#8B3A46]">Could not save announcement.</p> : null}
          <Button
            type="button"
            className="w-full bg-[#1F6B45] text-white hover:bg-[#185536]"
            disabled={createMut.isPending || !title.trim() || !body.trim() || selectedTargets.length === 0}
            onClick={submit}
          >
            Save draft
          </Button>
        </section>

        <section className="ad-card rounded-xl overflow-hidden">
          {listQuery.isLoading ? <p className="px-4 py-6 text-sm text-[#66756C]">Loading…</p> : null}
          {listQuery.isError ? (
            <p className="px-4 py-6 text-sm text-[#66756C]">Unable to load announcements.</p>
          ) : null}
          {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#66756C]">No announcements.</p>
          ) : null}
          <ul>
            {items.map((item) => (
              <li key={item.id} className="border-b border-[#E3E8E4] px-4 py-4 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#17251E]">{item.title}</p>
                    <p className="mt-1 text-sm text-[#66756C] line-clamp-3">{item.body}</p>
                    <p className="mt-2 text-[11px] text-[#66756C]">
                      {item.isPublished ? "Published" : "Draft"} · {item.priority} ·{" "}
                      {formatRelativeTime(item.createdAt)}
                      {" · "}
                      {item.targets
                        .map((t) => (t.targetType === "department" ? t.targetValue : t.targetType))
                        .join(", ")}
                    </p>
                  </div>
                  {!item.isPublished ? (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#1F6B45] text-white"
                      disabled={publishMut.isPending}
                      onClick={() => publishMut.mutate(item.id)}
                    >
                      Publish
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminLayout>
  );
}
