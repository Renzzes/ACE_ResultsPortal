import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/admin-layout";
import { ADMIN_STORAGE_BROWSER_FILES } from "@/lib/admin-mock-data";

const STATUS_TONE: Record<(typeof ADMIN_STORAGE_BROWSER_FILES)[number]["status"], string> = {
  Released: "bg-[#EAF5EE] text-[#1F6B45]",
  Pending: "bg-[#F8EEDC] text-[#B7791F]",
  Archived: "bg-[#F1EEE8] text-[#66756C]",
};

export default function AdminStorageFilesPage() {
  return (
    <AdminLayout title="Storage Files" subtitle="Result files in logical storage. Server filesystem paths are never shown." fill>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[#66756C]">{ADMIN_STORAGE_BROWSER_FILES.length} files in this preview list</p>
          <Link href="/admin/storage" className="text-sm font-semibold text-[#1F6B45] no-underline">
            ← Back to Storage
          </Link>
        </div>
        <section className="ad-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
          <div className="ace-scroll min-h-0 flex-1 overflow-auto">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#F7F8F5] text-[11px] uppercase tracking-wide text-[#66756C]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">File</th>
                  <th className="px-4 py-2.5 font-semibold">Patient</th>
                  <th className="px-4 py-2.5 font-semibold">Department</th>
                  <th className="px-4 py-2.5 font-semibold">Result</th>
                  <th className="px-4 py-2.5 font-semibold">Size</th>
                  <th className="px-4 py-2.5 font-semibold">Uploaded</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ADMIN_STORAGE_BROWSER_FILES.map((row) => (
                  <tr key={row.id} className="border-t border-[#F0F3F0]">
                    <td className="px-4 py-3 font-semibold text-[#17251E]">{row.file}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.patient}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.department}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.result}</td>
                    <td className="px-4 py-3 tabular-nums text-[#66756C]">{row.size}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.uploaded}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href="/admin/results" className="text-[12px] font-semibold text-[#1F6B45] no-underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
