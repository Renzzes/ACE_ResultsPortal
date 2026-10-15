import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AdminCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-[#E3E8E4] bg-white shadow-[0_8px_24px_rgb(15_61_46_/_0.05)]", className)}>
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = "green",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "green" | "maroon" | "gold";
}) {
  const tones = {
    green: "bg-[#dceee3] text-[#2F7D4A]",
    maroon: "bg-[#f8ecef] text-[#8E3344]",
    gold: "bg-[#f4e9d8] text-[#8a5a2b]",
  };
  return (
    <AdminCard className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64706A]">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-[#153D2B]">{value}</p>
      {hint ? <p className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{hint}</p> : null}
    </AdminCard>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        active ? "bg-[#dceee3] text-[#2F7D4A]" : "bg-[#F1EEE8] text-[#64706A]"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function RolePill({ role, label }: { role: string; label: string }) {
  const tone =
    role === "super_admin"
      ? "bg-[#f8ecef] text-[#8E3344]"
      : role === "physician"
        ? "bg-[#dceee3] text-[#2F7D4A]"
        : "bg-[#f4e9d8] text-[#8a5a2b]";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

export function AdminTable({
  headers,
  children,
  empty,
  loading,
}: {
  headers: string[];
  children: ReactNode;
  empty?: string;
  loading?: boolean;
}) {
  return (
    <div className="ace-scroll min-h-0 flex-1 overflow-auto">
      {loading ? (
        <p className="p-8 text-center text-sm text-[#64706A]">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F6F4EF]">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64706A]">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFEBE3]">{children}</tbody>
        </table>
      )}
      {!loading && empty ? <p className="p-10 text-center text-sm text-[#64706A]">{empty}</p> : null}
    </div>
  );
}
