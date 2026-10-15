import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getGetPortalOverviewQueryKey,
  useGetPortalOverview,
} from "@workspace/api-client-react";
import { revokeCurrentTabSession, useAuth } from "@/lib/auth";
import { fetchPortalNotificationUnreadCount, fetchPortalMessageUnreadCount } from "@/lib/comms-api";
import { PatientProfileAvatar } from "@/components/portal/patient-profile-avatar";
import { PatientAccountDialog } from "@/components/portal/patient-account-dialog";
import { PortalPwaInstallDialog } from "@/components/portal/pwa-install-dialog";
import { ContactSupportDialog } from "@/components/portal/contact-support-dialog";
import { publicAsset } from "@/components/layout/auth-split-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { portalFullName, portalPhotoKey } from "@/lib/patient-identity";
import {
  runPortalPwaInstall,
  shouldShowPortalPwaMenuInstall,
  subscribePortalPwaPrompt,
} from "@/lib/portal-pwa";
import {
  LayoutDashboard,
  FileText,
  CalendarDays,
  Bell,
  LogOut,
  Menu,
  Search,
  MessageCircle,
  UserRound,
  MonitorDown,
  CircleHelp,
  ChevronDown,
  Clock3,
  Pill,
} from "lucide-react";

const NAV = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/results", label: "My Results", icon: FileText },
  { href: "/portal/history", label: "Appointments", icon: CalendarDays },
  { href: "/portal/messages", label: "Messages", icon: MessageCircle },
  { href: "__help__", label: "Help & Support", icon: CircleHelp, help: true },
] as const;

function isActive(location: string, href: string) {
  if (href === "__help__") return false;
  return location === href || (href !== "/portal/dashboard" && location.startsWith(href));
}

function LeafWatermark() {
  return (
    <svg
      className="pointer-events-none absolute -bottom-4 -left-2 h-56 w-56 text-white opacity-[0.08]"
      viewBox="0 0 120 120"
      fill="currentColor"
      aria-hidden
    >
      <path d="M60 8c18 16 36 38 36 62 0 20-16 36-36 36S24 90 24 70C24 46 42 24 60 8z" />
      <path d="M60 18c0 40 0 64 0 88" fill="none" stroke="currentColor" strokeWidth="3" />
      <path
        d="M60 42c12 6 20 14 26 24M60 58c-12 6-20 14-26 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function NavLinks({
  location,
  onNavigate,
  onSignOut,
  onHelp,
  messageUnreadCount = 0,
}: {
  location: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  onHelp: () => void;
  messageUnreadCount?: number;
}) {
  return (
    <>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(location, item.href);
        const showBadge = item.href === "/portal/messages" && messageUnreadCount > 0;
        const className = `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium no-underline transition-colors ${
          active
            ? "bg-[#07864B] text-white shadow-sm"
            : "text-white/90 hover:bg-white/10 hover:text-white"
        }`;

        if ("help" in item && item.help) {
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => {
                onHelp();
                onNavigate?.();
              }}
              className={`${className} w-full text-left`}
            >
              <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={className}
          >
            {active ? (
              <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[#B8F0C8]" />
            ) : null}
            <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{item.label}</span>
            {showBadge ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#C41E3A] px-1 text-[10px] font-bold text-white">
                {messageUnreadCount > 99 ? "99+" : messageUnreadCount}
              </span>
            ) : null}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onSignOut}
        className="relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.75} />
        <span className="flex-1">Sign out</span>
      </button>
    </>
  );
}

function SidebarBrand({
  location,
  onNavigate,
  onSignOut,
  onHelp,
  messageUnreadCount = 0,
}: {
  location: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  onHelp: () => void;
  messageUnreadCount?: number;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <LeafWatermark />
      <div className="relative z-10 border-b border-white/20 px-3 pb-4 pt-5">
        <div className="mx-auto w-full overflow-hidden rounded-2xl bg-white px-2 py-2 shadow-sm">
          <img
            src={publicAsset("logo_ace.png")}
            alt="ACE Medical Center Cebu"
            className="mx-auto block h-auto max-h-[6.75rem] w-full object-contain object-center"
          />
        </div>
        <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-white/85">
          Patient Portal
        </p>
      </div>

      <nav className="relative z-10 mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        <NavLinks
          location={location}
          onNavigate={onNavigate}
          onSignOut={onSignOut}
          onHelp={onHelp}
          messageUnreadCount={messageUnreadCount}
        />
      </nav>

      <div className="relative z-10 mt-auto border-t border-white/15 px-4 py-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 h-8 w-[3px] flex-shrink-0 rounded-full bg-[#A20F2F]" />
          <p className="text-[11px] font-medium leading-snug text-white/90">
            Compassion. Expertise.
            <br />
            A Healthier Cebu.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PatientLayout({
  children,
  title,
  fill = false,
}: {
  children: ReactNode;
  title: string;
  fill?: boolean;
}) {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const searchStr = useSearch();
  const { portalAuth, portalLogout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showInstallMenu, setShowInstallMenu] = useState(() => shouldShowPortalPwaMenuInstall());
  const currentQuery = new URLSearchParams(searchStr).get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(currentQuery);

  const overviewQuery = useGetPortalOverview({
    query: {
      queryKey: getGetPortalOverviewQueryKey(),
      enabled: Boolean(portalAuth.token),
    },
  });

  const unreadQuery = useQuery({
    queryKey: ["portal-notifications-unread"],
    queryFn: fetchPortalNotificationUnreadCount,
    enabled: Boolean(portalAuth.token),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unreadQuery.data?.count ?? 0;

  const messageUnreadQuery = useQuery({
    queryKey: ["portal-messages-unread"],
    queryFn: fetchPortalMessageUnreadCount,
    enabled: Boolean(portalAuth.token),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnreadCount = messageUnreadQuery.data?.count ?? 0;

  const sessionPatient = portalAuth.patient;
  const patient = overviewQuery.data?.patient ?? sessionPatient;
  const fullName = portalFullName(patient);
  const photoKey = portalPhotoKey(patient?.patientHisId, patient?.id);

  useEffect(() => {
    setSearchQuery(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    setShowInstallMenu(shouldShowPortalPwaMenuInstall());
    return subscribePortalPwaPrompt(() => {
      setShowInstallMenu(shouldShowPortalPwaMenuInstall());
    });
  }, []);

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login" />;
  }

  function signOut() {
    void revokeCurrentTabSession().finally(() => {
      portalLogout();
      setLocation("/login");
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    const qs = trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
    setLocation(`/portal/results${qs}`);
  }

  async function installFromMenu() {
    const result = await runPortalPwaInstall();
    if (result.kind === "accepted") {
      setShowInstallMenu(false);
      toast({
        title: "App installed",
        description: "You can open ACE Results Portal from your home screen.",
      });
      return;
    }
    if (result.kind === "manual") {
      toast({
        title: "Install ACE Results Portal",
        description: "Open your browser menu and choose Add to Home Screen or Install app.",
      });
      return;
    }
    if (result.kind === "error") {
      toast({
        title: "Could not open install prompt",
        description: result.message,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="patient-shell flex h-screen overflow-hidden bg-[#F6F9F7]">
      <aside className="hidden w-[228px] flex-shrink-0 flex-col bg-[#063D2B] text-white lg:flex">
        <SidebarBrand
          location={location}
          onSignOut={signOut}
          onHelp={() => setHelpOpen(true)}
          messageUnreadCount={messageUnreadCount}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[3.75rem] flex-shrink-0 items-center justify-between gap-3 border-b border-[#DFE9E4] bg-white px-4 shadow-[0_1px_0_rgb(15_40_30_/_0.03)] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="truncate text-[15px] font-bold uppercase tracking-[0.16em] text-[#101D3A] sm:text-[17px]">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <form onSubmit={submitSearch} className="hidden md:block">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#687A93]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search results, appointments..."
                  className="h-10 w-[260px] rounded-full border border-[#DFE9E4] bg-[#F3F6F4] pl-10 pr-4 text-sm text-[#26364C] outline-none placeholder:text-[#687A93] focus:border-[#07864B] lg:w-[320px]"
                />
              </label>
            </form>
            <Link
              href="/portal/notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#26364C] hover:bg-[#E4F5EC]"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" strokeWidth={1.75} />
              {unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#C41E3A] ring-2 ring-white" />
              ) : null}
            </Link>
            <span className="hidden h-6 w-px bg-[#DFE9E4] sm:block" aria-hidden />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#07864B] focus-visible:ring-offset-2"
                  aria-label="Open account menu"
                >
                  <PatientProfileAvatar
                    patientId={photoKey}
                    firstName={patient?.firstName}
                    lastName={patient?.lastName}
                    fullName={fullName}
                    size="sm"
                  />
                  <ChevronDown className="hidden h-4 w-4 text-[#687A93] sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  className="cursor-pointer gap-2"
                  onSelect={() => setAccountOpen(true)}
                >
                  <UserRound className="h-4 w-4 text-[#07864B]" />
                  Account / Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2"
                  onSelect={() => setLocation("/portal/history")}
                >
                  <Clock3 className="h-4 w-4 text-[#07864B]" />
                  Care History
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2"
                  onSelect={() => setLocation("/portal/medications")}
                >
                  <Pill className="h-4 w-4 text-[#07864B]" />
                  Medications
                </DropdownMenuItem>
                {showInstallMenu ? (
                  <DropdownMenuItem
                    className="cursor-pointer gap-2"
                    onSelect={() => {
                      void installFromMenu();
                    }}
                  >
                    <MonitorDown className="h-4 w-4 text-[#07864B]" />
                    Install app
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main
          className={
            fill
              ? "min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 lg:overflow-hidden lg:px-6 lg:py-4"
              : "pt-scroll flex-1 overflow-y-auto px-3 py-5 sm:px-6"
          }
        >
          {children}
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[min(20rem,90vw)] border-0 bg-[#063D2B] p-0 text-white">
          <SidebarBrand
            location={location}
            onNavigate={() => setMobileOpen(false)}
            onSignOut={signOut}
            onHelp={() => setHelpOpen(true)}
            messageUnreadCount={messageUnreadCount}
          />
        </SheetContent>
      </Sheet>
      <PatientAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ContactSupportDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <PortalPwaInstallDialog />
    </div>
  );
}
