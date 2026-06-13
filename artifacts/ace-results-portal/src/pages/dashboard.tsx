import {
  useGetDashboardStats,
  getGetDashboardStatsQueryKey,
  useGetUploadsByDepartment,
  getGetUploadsByDepartmentQueryKey,
  useGetDailyUploads,
  getGetDailyUploadsQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useGetTopActiveUsers,
  getGetTopActiveUsersQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { StaffLayout } from "@/components/layout/staff-layout";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import {
  Users, FileText, Clock, Download, Upload, Activity,
  UserPlus, Search, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Lab", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehab", other: "Other",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Login", logout: "Logout", upload: "Upload", edit: "Edit",
  delete: "Delete", view: "View", download: "Download",
  access_denied: "Access Denied", access_code_regen: "Code Regen",
};

const ACTION_COLORS: Record<string, string> = {
  login: "text-blue-600", logout: "text-slate-500", upload: "text-green-600",
  edit: "text-yellow-600", delete: "text-red-600", view: "text-purple-600",
  download: "text-teal-600", access_denied: "text-red-700", access_code_regen: "text-orange-600",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", medical_records: "Medical Records",
  laboratory: "Laboratory Staff", radiology: "Radiology Staff", physician: "Physician",
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded-lg ${className ?? ""}`} />;
}

function StatCard({ icon: Icon, label, value, colorClass }: { icon: any; label: string; value: number | string; colorClass?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass ?? "bg-primary/10"}`}>
          <Icon className={`w-5 h-5 ${colorClass ? "text-white" : "text-primary"}`} />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

// ─── Staff Quick-Action Card ───────────────────────────────────────────────
function ActionCard({
  icon: Icon, title, description, href, colorClass,
}: {
  icon: any; title: string; description: string; href: string; colorClass: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer no-underline"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-base text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
    </Link>
  );
}

// ─── Simplified Staff Dashboard ────────────────────────────────────────────
function StaffDashboard() {
  const { auth } = useAuth();
  const role = auth.user?.role ?? "";
  const isPhysician = role === "physician";

  const { data: stats, isLoading: loadingStats } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });

  const actions = isPhysician
    ? [
        {
          icon: Search, title: "Search Patients", href: "/physician/search",
          description: "Find a patient and view their released results",
          colorClass: "bg-primary",
        },
        {
          icon: FileText, title: "All Results", href: "/results",
          description: "Browse all released diagnostic results",
          colorClass: "bg-teal-600",
        },
      ]
    : [
        {
          icon: UserPlus, title: "Add New Patient", href: "/patients/new",
          description: "Register a new patient and generate an access code",
          colorClass: "bg-primary",
        },
        {
          icon: Upload, title: "Upload Result", href: "/results/upload",
          description: "Upload a diagnostic result file for a patient",
          colorClass: "bg-teal-600",
        },
        {
          icon: Users, title: "All Patients", href: "/patients",
          description: "Search and manage existing patient records",
          colorClass: "bg-slate-600",
        },
        {
          icon: FileText, title: "All Results", href: "/results",
          description: "Browse and manage uploaded diagnostic results",
          colorClass: "bg-indigo-600",
        },
      ];

  return (
    <StaffLayout>
      <div className="space-y-8 max-w-3xl">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">
            Good day, {auth.user?.firstName}!
          </h2>
          <p className="text-muted-foreground mt-1">
            {ROLE_LABELS[role] ?? role} · ACE Medical Center Cebu
          </p>
        </div>

        {/* Stats */}
        {loadingStats ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            <StatCard icon={Users} label="Total Patients" value={stats?.totalPatients ?? 0} />
            <StatCard icon={FileText} label="Total Results" value={stats?.totalResults ?? 0} />
            <StatCard
              icon={Clock} label="Pending Release" value={stats?.totalPending ?? 0}
              colorClass={stats?.totalPending ? "bg-amber-500" : undefined}
            />
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Quick Actions
          </h3>
          <div className="flex flex-col gap-3">
            {actions.map((a) => (
              <ActionCard key={a.href} {...a} />
            ))}
          </div>
        </div>
      </div>
    </StaffLayout>
  );
}

// ─── Full Admin Dashboard ──────────────────────────────────────────────────
function AdminDashboard() {
  const { auth } = useAuth();

  const { data: stats, isLoading: loadingStats } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  const { data: byDept, isLoading: loadingDept } = useGetUploadsByDepartment({
    query: { queryKey: getGetUploadsByDepartmentQueryKey() }
  });
  const { data: daily, isLoading: loadingDaily } = useGetDailyUploads({
    query: { queryKey: getGetDailyUploadsQueryKey() }
  });
  const { data: recentActivity } = useGetRecentActivity(
    { limit: 10 },
    { query: { queryKey: getGetRecentActivityQueryKey({ limit: 10 }) } }
  );
  const { data: topUsers } = useGetTopActiveUsers({
    query: { queryKey: getGetTopActiveUsersQueryKey() }
  });

  const deptData = Array.isArray(byDept)
    ? byDept.map(d => ({ name: CATEGORY_LABELS[d.category] ?? d.category, count: d.count }))
    : [];
  const dailyData = Array.isArray(daily)
    ? daily.map(d => ({ date: d.date.slice(5), count: d.count }))
    : [];
  const activity = Array.isArray(recentActivity) ? recentActivity : [];
  const users = Array.isArray(topUsers) ? topUsers : [];

  return (
    <StaffLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary">Dashboard</h2>
          <p className="text-muted-foreground">Welcome back, {auth.user?.firstName}. Here is an overview of ACE Medical Portal.</p>
        </div>

        {loadingStats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Total Patients" value={stats?.totalPatients ?? 0} />
            <StatCard icon={FileText} label="Total Results" value={stats?.totalResults ?? 0} />
            <StatCard icon={Clock} label="Pending Release" value={stats?.totalPending ?? 0} colorClass={stats?.totalPending ? "bg-amber-500" : undefined} />
            <StatCard icon={Download} label="Total Downloads" value={stats?.totalDownloads ?? 0} />
            <StatCard icon={Upload} label="Uploads Today" value={stats?.uploadsToday ?? 0} />
            <StatCard icon={Activity} label="This Month" value={stats?.uploadsThisMonth ?? 0} />
            <StatCard icon={Users} label="Staff Users" value={stats?.totalStaffUsers ?? 0} />
            <StatCard icon={Users} label="Physicians" value={stats?.totalPhysicians ?? 0} />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold mb-4">Uploads by Department</h3>
            {loadingDept ? (
              <Skeleton className="h-48" />
            ) : deptData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={deptData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Uploads" fill="hsl(180, 70%, 35%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold mb-4">Daily Uploads (Last 30 Days)</h3>
            {loadingDaily ? (
              <Skeleton className="h-48" />
            ) : dailyData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" name="Uploads" stroke="hsl(220, 85%, 20%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold mb-4">Recent Activity</h3>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
            ) : (
              <div className="space-y-2">
                {activity.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-1.5">
                    <Activity className={`w-4 h-4 flex-shrink-0 ${ACTION_COLORS[a.action] ?? "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{a.userName ?? "Unknown"}</span>
                        {" "}<span className="text-muted-foreground">{ACTION_LABELS[a.action] ?? a.action}</span>
                        {a.patientHisId && <span className="text-muted-foreground"> · {a.patientHisId}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-PH")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold mb-4">Top Uploaders</h3>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No upload data yet</p>
            ) : (
              <div className="space-y-3">
                {users.slice(0, 8).map((u, i) => (
                  <div key={u.userId} className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.userName}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[u.role] ?? u.role}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">{u.uploadCount}</p>
                      <p className="text-xs text-muted-foreground">uploads</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </StaffLayout>
  );
}

// ─── Route to correct dashboard by role ───────────────────────────────────
export default function Dashboard() {
  const { auth } = useAuth();
  if (auth.user?.role === "super_admin") return <AdminDashboard />;
  return <StaffDashboard />;
}
