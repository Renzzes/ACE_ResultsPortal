import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { revokeCurrentTabSession, useAuth, useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAdminOverview } from "@/lib/workflow-stability";
import {
  getListPatientsQueryKey,
  getListUsersQueryKey,
  getGetAdminOverviewQueryKey,
  useGetAdminOverview,
  useListPatients,
  useListUsers,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { publicAsset } from "@/components/layout/auth-split-layout";
import { StaffSettingsDialog } from "@/components/staff/settings-dialog";
import { staffEmployeeName, staffInitials } from "@/lib/staff-identity";
import { useStaffPhoto } from "@/lib/staff-photo";
import { fetchNotificationUnreadCount } from "@/lib/comms-api";
import { AdminNotificationsBell } from "@/components/comms/notifications-bell";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  Database,
  FileText,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Search,
  Settings,
  Shield,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";

type Leaf = { href: string; label: string; icon?: React.ElementType; badge?: number };

const USER_ITEMS: Leaf[] = [
  { href: "/admin/staff", label: "Staff", icon: Shield },
  { href: "/admin/doctors", label: "Doctors", icon: Stethoscope },
  { href: "/admin/patients", label: "Patients", icon: Users },
  { href: "/admin/support-requests", label: "Support requests", icon: MessageSquare },
  { href: "/admin/departments", label: "Departments", icon: Building2 },
  { href: "/admin/roles", label: "Roles & Permissions", icon: KeyRound },
];

function isActive(location: string, href: string) {
  if (href === "/admin") return location === "/admin";
  return location === href || location.startsWith(`${href}/`);
}

function formatSidebarGb(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  if (value < 0.001) return `${(value * 1024 * 1024).toFixed(0)} KB`;
  if (value < 1) return `${(value * 1024).toFixed(1)} MB`;
  return `${value.toFixed(2)} GB`;
}

function NavLink({
  item,
  location,
  onNavigate,
  nested,
}: {
  item: Leaf;
  location: string;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const Icon = item.icon;
  const active = isActive(location, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium no-underline transition-colors ${
        nested ? "pl-9" : ""
      } ${
        active
          ? "bg-[#1F6B45] text-white before:absolute before:left-0 before:h-5 before:w-[3px] before:rounded-full before:bg-white"
          : "text-white/75 hover:bg-white/8 hover:text-white"
      }`}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#8B3A46] px-1 text-[10px] font-bold text-white">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
      {children}
    </p>
  );
}

function SidebarNav({
  location,
  onNavigate,
  notificationCount = 0,
}: {
  location: string;
  onNavigate?: () => void;
  notificationCount?: number;
}) {
  const usersOpen = USER_ITEMS.some((item) => isActive(location, item.href));
  const [open, setOpen] = useState(usersOpen);
  useEffect(() => {
    if (usersOpen) setOpen(true);
  }, [usersOpen]);

  return (
    <nav className="ace-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <SectionLabel>Main</SectionLabel>
      <NavLink item={{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }} location={location} onNavigate={onNavigate} />

      <SectionLabel>User management</SectionLabel>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/75 hover:bg-white/8 hover:text-white">
          <Users className="h-4 w-4" />
          <span className="flex-1 text-left">User Management</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-0.5 pb-1">
          {USER_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} location={location} onNavigate={onNavigate} nested />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <SectionLabel>Clinical operations</SectionLabel>
      <NavLink item={{ href: "/admin/results", label: "Results Management", icon: FileText }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/archive", label: "Archive", icon: Archive }} location={location} onNavigate={onNavigate} />

      <SectionLabel>Communication</SectionLabel>
      <NavLink item={{ href: "/admin/messages", label: "Messages", icon: MessageSquare }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/announcements", label: "Announcements", icon: Megaphone }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/inbox", label: "Inbox", icon: Bell, badge: notificationCount > 0 ? notificationCount : undefined }} location={location} onNavigate={onNavigate} />
      <NavLink
        item={{
          href: "/admin/notifications",
          label: "Ops Alerts",
          icon: Activity,
        }}
        location={location}
        onNavigate={onNavigate}
      />

      <SectionLabel>System</SectionLabel>
      <NavLink item={{ href: "/admin/storage", label: "Storage", icon: HardDrive }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/reports", label: "Reports & Analytics", icon: BarChart3 }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/history", label: "Audit Logs / History", icon: Activity }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/monitor", label: "System Monitor", icon: Database }} location={location} onNavigate={onNavigate} />
      <NavLink item={{ href: "/admin/settings", label: "Settings", icon: Settings }} location={location} onNavigate={onNavigate} />
    </nav>
  );
}

function Sidebar({
  location,
  onNavigate,
  onSignOut,
  notificationCount = 0,
}: {
  location: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  notificationCount?: number;
}) {
  const role = useAuthoritativeRole();
  const { data: overview } = useGetAdminOverview({
    query: { queryKey: getGetAdminOverviewQueryKey(), enabled: mayRequestAdminOverview(role) },
  });
  const storage = overview?.storage;
  const usedPct = storage?.databaseUsedPercent ?? null;
  const usedGb = (storage?.databaseDataUsedGB ?? 0) + (storage?.logUsedGB ?? 0);
  const allocated = storage?.databaseAllocatedGB ?? null;
  const usedLabel =
    allocated != null
      ? `${formatSidebarGb(usedGb)} / ${formatSidebarGb(allocated)}`
      : null;

  return (
    <div className="flex h-full flex-col bg-[#0F3D2E] text-white">
      <div className="px-4 pb-3 pt-5">
        <div className="flex items-center justify-center overflow-hidden rounded-xl bg-[#EAF5EE] px-3 py-3">
          <img src={publicAsset("ACE-NOBG.png")} alt="ACE Medical Center Cebu" className="block h-auto max-h-14 w-full object-contain" />
        </div>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#9ED0B3]">Admin Control</p>
        <p className="mt-0.5 text-[12px] text-white/55">Hospital Management System</p>
      </div>
      <SidebarNav location={location} onNavigate={onNavigate} notificationCount={notificationCount} />
      <div className="mx-3 mb-2 rounded-xl bg-white/8 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">Storage Summary</p>
        {storage?.available && usedPct != null && allocated != null ? (
          <>
            <p className="mt-1.5 text-[12px] font-semibold text-white">{usedPct}% used</p>
            <p className="text-[11px] text-white/60">{usedLabel}</p>
            <p className="mt-0.5 text-[10px] text-white/45">ACE_ResultsPortal allocated</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-[#2F8F57]" style={{ width: `${Math.min(100, Math.max(0, usedPct))}%` }} />
            </div>
            <ul className="mt-2.5 space-y-1 text-[11px] text-white/70">
              {storage.databaseDataUsedGB != null ? (
                <li className="flex justify-between gap-2">
                  <span>Database data</span>
                  <span className="tabular-nums text-white/90">{formatSidebarGb(storage.databaseDataUsedGB)}</span>
                </li>
              ) : null}
              {storage.logUsedGB != null ? (
                <li className="flex justify-between gap-2">
                  <span>Transaction log</span>
                  <span className="tabular-nums text-white/90">{formatSidebarGb(storage.logUsedGB)}</span>
                </li>
              ) : null}
              {storage.resultFilesGB != null ? (
                <li className="flex justify-between gap-2">
                  <span>Result files</span>
                  <span className="tabular-nums text-white/90">{formatSidebarGb(storage.resultFilesGB)}</span>
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <p className="mt-1.5 text-[12px] text-white/60">Storage information unavailable.</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          onSignOut();
          onNavigate?.();
        }}
        className="mx-3 mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/75 hover:bg-[#8B3A46] hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </button>
    </div>
  );
}

function NotificationsBell() {
  return <AdminNotificationsBell />;
}

function GlobalSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim();
  const enabled = q.length >= 2;
  const patientParams = { search: enabled ? q : undefined, limit: 5 };
  const userParams = { search: enabled ? q : undefined, limit: 5 };
  const { data: patients } = useListPatients(patientParams, {
    query: { enabled, queryKey: getListPatientsQueryKey(patientParams) },
  });
  const { data: users } = useListUsers(userParams, {
    query: { enabled, queryKey: getListUsersQueryKey(userParams) },
  });
  const patientHits = patients?.data ?? [];
  const userHits = users?.data ?? [];
  const show = open && enabled;

  return (
    <div className="relative min-w-0 flex-1 max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#66756C]" />
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        placeholder="Search patients, results, users..."
        className="h-10 border-[#E3E8E4] bg-white pl-9 pr-12 text-sm"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[#E3E8E4] bg-[#F7F8F5] px-1.5 py-0.5 text-[10px] text-[#66756C] sm:inline">
        ⌘K
      </kbd>
      {show ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-[#E3E8E4] bg-white shadow-lg">
          {patientHits.length === 0 && userHits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-[#66756C]">No matching patients or users.</p>
          ) : (
            <div className="ace-scroll max-h-80 overflow-y-auto py-1">
              {patientHits.length > 0 ? (
                <div>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#66756C]">Patients</p>
                  {patientHits.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#EAF5EE]"
                      onMouseDown={() => {
                        setLocation(`/patients/${patient.id}`);
                        setOpen(false);
                      }}
                    >
                      <span className="text-sm font-semibold text-[#17251E]">{patient.firstName} {patient.lastName}</span>
                      <span className="text-[11px] text-[#66756C]">{patient.patientHisId}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {userHits.length > 0 ? (
                <div>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#66756C]">Users</p>
                  {userHits.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#EAF5EE]"
                      onMouseDown={() => {
                        setLocation(user.role === "physician" ? "/admin/doctors" : "/admin/staff");
                        setOpen(false);
                      }}
                    >
                      <span className="text-sm font-semibold text-[#17251E]">{user.firstName} {user.lastName}</span>
                      <span className="text-[11px] text-[#66756C]">@{user.username}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AdminLayout({
  children,
  title,
  subtitle,
  fill = false,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  fill?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { auth, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { photo } = useStaffPhoto(auth.user?.id);
  const displayName = useMemo(() => staffEmployeeName(auth.user) || "System Administrator", [auth.user]);
  const { data: unreadData } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: fetchNotificationUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const notificationCount = unreadData?.count ?? 0;

  function signOut() {
    void revokeCurrentTabSession().finally(() => {
      logout();
      setLocation("/login?as=admin");
    });
  }

  return (
    <div className="admin-shell flex h-screen overflow-hidden">
      <aside className="hidden w-[248px] shrink-0 md:flex md:flex-col">
        <Sidebar location={location} onSignOut={signOut} notificationCount={notificationCount} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F7F8F5]">
        <header className="flex shrink-0 flex-col gap-2 border-b border-[#E3E8E4] bg-white px-3 py-2 sm:px-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="rounded-lg p-2 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-[#0F3D2E] sm:text-xl">{title}</h1>
              <p className="hidden truncate text-[12px] text-[#66756C] sm:block">
                {subtitle ?? "Welcome back, System Administrator. Here's what's happening in your EMR system."}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 lg:ml-auto lg:w-[min(100%,40rem)]">
            <GlobalSearch />
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-2 rounded-xl border border-[#E3E8E4] bg-white py-1 pl-1 pr-2 text-left">
                  <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#EAF5EE] text-[11px] font-bold text-[#1F6B45]">
                    {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : staffInitials(auth.user)}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block truncate text-[12px] font-semibold leading-tight text-[#17251E]">{displayName}</span>
                    <span className="block text-[10px] text-[#66756C]">Super Administrator</span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-[#66756C] sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="admin-shell min-w-48">
                <DropdownMenuItem className="gap-2" onSelect={() => setSettingsOpen(true)}>
                  <UserRound className="h-4 w-4" /> My Profile
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => setLocation("/admin/settings")}>
                  <Settings className="h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => setSettingsOpen(true)}>
                  <KeyRound className="h-4 w-4" /> Security
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-[#8B3A46]" onSelect={signOut}>
                  <LogOut className="h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className={fill ? "ace-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 xl:overflow-hidden" : "ace-scroll flex-1 overflow-y-auto px-3 py-4 sm:px-5"}>
          <div className={fill ? "min-h-full xl:flex xl:h-full xl:min-h-0 xl:flex-col" : undefined}>{children}</div>
        </main>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] border-0 bg-[#0F3D2E] p-0 text-white">
          <Sidebar location={location} onNavigate={() => setMobileOpen(false)} onSignOut={signOut} notificationCount={notificationCount} />
        </SheetContent>
      </Sheet>
      <StaffSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
