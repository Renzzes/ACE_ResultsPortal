import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { revokeCurrentTabSession, useAuth, useAuthoritativeRole } from "@/lib/auth";
import { publicAsset } from "@/components/layout/auth-split-layout";
import { StaffSettingsDialog } from "@/components/staff/settings-dialog";
import { StaffNotificationsMenu } from "@/components/staff/notifications-menu";
import { STAFF_MONTHS } from "@/lib/staff-mock-data";
import { staffInitials } from "@/lib/staff-identity";
import { useStaffPhoto } from "@/lib/staff-photo";
import { StaffMonthProvider, useStaffMonth } from "@/lib/staff-month";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users, FileText, LogOut, LayoutDashboard,
  Archive, Menu, X, MessageSquare, CalendarDays, ChevronDown, UserRound, Search,
} from "lucide-react";

type NavItem = {
  href?: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  onClick?: () => void;
  badge?: number;
};

function StaffNav({
  items,
  location,
  onNavigate,
}: {
  items: NavItem[];
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = Boolean(
          item.href && (
            location === item.href ||
            (item.href !== "/dashboard" &&
              location.startsWith(`${item.href}/`) &&
              !items.some((other) => other.href && other.href.length > item.href!.length && location.startsWith(other.href)))
          ),
        );
        const className = `group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left no-underline transition-colors ${
          active
            ? "bg-[hsl(var(--st-cream))] text-[hsl(var(--st-rail))] shadow-sm"
            : item.onClick
              ? "text-white/80 hover:bg-[hsl(var(--st-maroon))] hover:text-white"
              : "text-white/80 hover:bg-white/8 hover:text-white"
        }`;
        const body = (
          <>
            {active && (
              <span className="absolute left-0 top-1/2 h-9 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--st-maroon))]" />
            )}
            <span className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
              active ? "bg-[hsl(var(--st-green))] text-white" : "bg-white/10 text-white"
            }`}>
              <Icon className="h-[18px] w-[18px]" />
              {item.badge ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--st-maroon))] px-1 text-[9px] font-bold text-white">
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">{item.label}</span>
              <span className={`mt-0.5 block text-[11px] leading-tight ${active ? "text-[hsl(var(--st-muted))]" : "text-white/50"}`}>
                {item.hint}
              </span>
            </span>
          </>
        );
        if (item.onClick) {
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onClick?.();
                onNavigate?.();
              }}
              className={className}
            >
              {body}
            </button>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href!}
            onClick={onNavigate}
            className={className}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  location,
  items,
  onNavigate,
}: {
  location: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-[hsl(var(--st-rail))] text-white">
      <div className="relative overflow-hidden px-4 pb-4 pt-5">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-[hsl(var(--st-maroon))]" />
        <div className="flex items-center justify-center overflow-hidden rounded-2xl bg-[hsl(var(--st-cream))] px-3 py-3">
          <img
            src={publicAsset("ACE-NOBG.png")}
            alt="ACE Medical Center Cebu"
            className="block h-auto max-h-[5.5rem] w-full object-contain object-center"
          />
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--st-gold))]">
          Staff Portal
        </p>
        <p className="mt-1 text-sm font-medium text-white/80">Results operations</p>
      </div>

      <StaffNav items={items} location={location} onNavigate={onNavigate} />
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="hidden items-center gap-2 rounded-2xl border border-[hsl(var(--st-border))] bg-white px-3 py-2 shadow-sm lg:flex">
      <CalendarDays className="h-4 w-4 text-[hsl(var(--st-green))]" />
      <div className="flex flex-col items-start leading-tight">
        <p className="text-xs font-semibold text-[hsl(var(--st-text))]">
          {now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
        <p className="text-[11px] st-muted">
          {now.toLocaleDateString("en-US", { weekday: "short" })},{" "}
          {now.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function MonthFilter({ month, onChange }: { month: number; onChange: (month: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-2xl border border-[hsl(var(--st-border))] bg-white px-3 py-2 text-sm font-medium text-[hsl(var(--st-text))] shadow-sm sm:inline-flex"
        >
          <CalendarDays className="h-4 w-4" />
          {STAFF_MONTHS[month] ?? "Month"}
          <ChevronDown className="h-4 w-4 st-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="staff-shell max-h-72 overflow-y-auto">
        {STAFF_MONTHS.map((label, index) => (
          <DropdownMenuItem key={label} onClick={() => onChange(index)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu({
  photo,
  initials,
  onAccount,
}: {
  photo: string | null;
  initials: string;
  onAccount: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-semibold text-[hsl(var(--st-green))] shadow-sm ring-1 ring-[hsl(var(--st-border))]"
          aria-label="Account menu"
        >
          {photo ? (
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="staff-shell min-w-40">
        <DropdownMenuItem onClick={onAccount} className="gap-2">
          <UserRound className="h-4 w-4" />
          Account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PatientSearch() {
  const [, setLocation] = useLocation();
  const [value, setValue] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const q = value.trim();
    if (!q) {
      setLocation("/patients");
      return;
    }
    setLocation(`/patients?search=${encodeURIComponent(q)}`);
  };

  return (
    <form
      onSubmit={submit}
      className="relative hidden min-w-0 flex-1 md:block md:max-w-md lg:max-w-lg"
      role="search"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search patient (Name or HIS ID)..."
        className="h-11 w-full rounded-2xl border border-[hsl(var(--st-border))] bg-white pl-10 pr-16 text-sm text-[hsl(var(--st-text))] shadow-sm outline-none ring-0 placeholder:text-[hsl(var(--st-muted))] focus-visible:border-[hsl(var(--st-green))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--st-green))]/25"
        aria-label="Search patient by name or HIS ID"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--st-muted))] sm:inline">
        Ctrl + K
      </kbd>
    </form>
  );
}

export function StaffLayout(props: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  contextLine?: string;
  actions?: ReactNode;
  fill?: boolean;
  clock?: boolean;
  showSearch?: boolean;
}) {
  return (
    <StaffMonthProvider>
      <StaffShell {...props} />
    </StaffMonthProvider>
  );
}

function StaffShell({
  children,
  title,
  subtitle,
  contextLine,
  actions,
  fill,
  clock,
  showSearch = true,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  contextLine?: string;
  actions?: ReactNode;
  fill?: boolean;
  clock?: boolean;
  showSearch?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { auth, logout } = useAuth();
  const role = useAuthoritativeRole();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { photo } = useStaffPhoto(auth.user?.id);
  const { month, setMonth } = useStaffMonth();

  const handleLogout = () => {
    void revokeCurrentTabSession().finally(() => {
      logout();
      setLocation("/login");
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Search patient by name or HIS ID"]');
        input?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!auth.user) {
    setLocation("/login");
    return null;
  }

  const canSeeArchive = role === "super_admin" || role === "medical_records";

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", hint: "Today's workload", icon: LayoutDashboard },
    { href: "/patients", label: "Patients", hint: "Register and manage", icon: Users },
    { href: "/results", label: "Results", hint: "Upload and review", icon: FileText },
    { href: "/messages", label: "Messages", hint: "Desk conversations", icon: MessageSquare },
    ...(canSeeArchive ? [{ href: "/archive", label: "Archive", hint: "Stored files", icon: Archive }] : []),
    { label: "Sign out", hint: "End this session", icon: LogOut, onClick: handleLogout },
  ];

  return (
    <div className="staff-shell flex h-screen overflow-hidden">
      <aside className="hidden w-[288px] flex-shrink-0 flex-col md:flex">
        <SidebarBody location={location} items={navItems} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="staff-shell h-full w-[min(20rem,90vw)] border-0 p-0 [&>button]:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-full p-1 text-white/70 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
          <SidebarBody
            location={location}
            items={navItems}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex-shrink-0 px-3 py-3 sm:px-5 lg:px-6 lg:py-4">
          <div className="flex flex-wrap items-start gap-3 lg:items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-[hsl(var(--st-text))] md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="min-w-0 flex-1 basis-[min(100%,16rem)]">
              {title ? (
                <h1 className="text-xl font-bold leading-tight tracking-tight text-[hsl(var(--st-text))] [overflow-wrap:anywhere] sm:text-[1.85rem] lg:text-[2.05rem]">
                  {title}
                </h1>
              ) : (
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--st-maroon))]">
                  ACE Medical Center Cebu
                </p>
              )}
              {subtitle ? (
                <p className="mt-1.5 inline-flex max-w-full items-center rounded-full bg-[hsl(var(--st-green-soft))] px-3 py-1 text-sm font-bold tracking-wide text-[hsl(var(--st-green))] sm:text-base">
                  <span className="truncate">{subtitle}</span>
                </p>
              ) : null}
              {contextLine ? (
                <p className="mt-0.5 text-sm st-muted [overflow-wrap:anywhere]">{contextLine}</p>
              ) : null}
            </div>

            <div className="ml-auto flex w-full max-w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3 lg:flex-1">
              {showSearch ? <PatientSearch /> : null}
              <StaffNotificationsMenu />
              {clock ? <LiveClock /> : <MonthFilter month={month} onChange={setMonth} />}
              <AccountMenu
                photo={photo}
                initials={staffInitials(auth.user)}
                onAccount={() => setSettingsOpen(true)}
              />
            </div>
          </div>

          {actions ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2 sm:mt-4">{actions}</div>
          ) : null}
        </header>

        <div
          className={
            fill
              ? "min-h-0 flex-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 lg:overflow-hidden lg:px-6"
              : "min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8"
          }
        >
          <div className={fill ? "min-h-0 lg:h-full" : "w-full"}>{children}</div>
        </div>
      </main>

      <StaffSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
