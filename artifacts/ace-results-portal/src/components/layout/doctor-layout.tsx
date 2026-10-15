import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { revokeCurrentTabSession, useAuth } from "@/lib/auth";
import { publicAsset } from "@/components/layout/auth-split-layout";
import { PhysicianSettingsDialog } from "@/components/doctor/settings-dialog";
import { NotificationsMenu } from "@/components/doctor/notifications-menu";
import { doctorInitials, useDoctorPhoto } from "@/lib/doctor-photo";
import { fetchMessageUnreadCount } from "@/lib/comms-api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  LayoutDashboard, CalendarDays, Users, FileText, MessageSquare,
  CreditCard, Settings, LogOut, Menu, Mail, X,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badgeKey?: "messages";
}

const NAV_ITEMS: NavItem[] = [
  { href: "/physician/overview", label: "Dashboard", icon: LayoutDashboard },
  { href: "/physician/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/physician/patients", label: "My Patients", icon: Users },
  { href: "/physician/results", label: "Patient Results", icon: FileText },
  { href: "/physician/payments", label: "Payments", icon: CreditCard },
  { href: "/physician/messages", label: "Messages", icon: MessageSquare, badgeKey: "messages" },
];

function SidebarNav({
  items,
  location,
  onNavigate,
  onLogout,
  messageUnread = 0,
}: {
  items: NavItem[];
  location: string;
  onNavigate?: () => void;
  onLogout: () => void;
  messageUnread?: number;
}) {
  return (
    <nav className="space-y-1 px-3 py-2">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = location.startsWith(item.href);
        const badge = item.badgeKey === "messages" && messageUnread > 0 ? messageUnread : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-[hsl(var(--doc-green))] text-white shadow-sm"
                : "text-[hsl(var(--doc-text))] hover:bg-[hsl(var(--doc-green-soft))]"
            }`}
          >
            <Icon className="h-[18px] w-[18px] flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {badge > 0 ? (
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  isActive ? "bg-white text-[hsl(var(--doc-green))]" : "bg-[hsl(var(--doc-maroon))] text-white"
                }`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[hsl(var(--doc-text))] transition-colors hover:bg-[hsl(var(--doc-maroon-soft))] hover:text-[hsl(var(--doc-maroon))]"
      >
        <LogOut className="h-[18px] w-[18px]" />
        Logout
      </button>
    </nav>
  );
}

function SidebarBody({
  location,
  userName,
  role,
  photo,
  onLogout,
  onNavigate,
  messageUnread = 0,
}: {
  location: string;
  userName: string;
  role: string;
  photo?: string | null;
  onLogout: () => void;
  onNavigate?: () => void;
  messageUnread?: number;
}) {
  const initials = doctorInitials(
    userName.replace("Dr. ", "").split(" ")[0],
    userName.replace("Dr. ", "").split(" ").slice(1).join(" "),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col items-center px-4 pb-3 pt-5 text-center">
        <img
          src={publicAsset("logo_ace.png")}
          alt="ACE Medical Center - Cebu"
          className="h-16 w-auto max-w-[180px] object-contain"
        />
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] doc-muted">Physician Portal</p>
      </div>

      <div className="mx-4 border-y border-[hsl(var(--doc-border))] px-1 py-4">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--doc-green-soft))] text-xl font-bold text-[hsl(var(--doc-green))]">
            {photo ? (
              <img src={photo} alt={userName} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <p className="mt-2.5 text-sm font-semibold text-[hsl(var(--doc-text))]">{userName}</p>
          <p className="mt-0.5 text-xs capitalize doc-muted">{role.replace(/_/g, " ")}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <SidebarNav
          items={NAV_ITEMS}
          location={location}
          onNavigate={onNavigate}
          onLogout={onLogout}
          messageUnread={messageUnread}
        />
      </div>
    </div>
  );
}

function HeaderIconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  badge,
}: {
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
  disabled?: boolean;
  badge?: number;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative rounded-full h-12 w-12 text-[hsl(var(--doc-text))]"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon className="w-7 h-7 sm:w-8 sm:h-8" />
      {badge ? (
        <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-[hsl(var(--doc-green))] text-white text-[9px] font-bold flex items-center justify-center">
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

function DoctorLayoutInner({
  children,
  title,
  fill,
  hideHeaderActions,
}: {
  children: ReactNode;
  title?: string;
  fill?: boolean;
  /** When true, page supplies its own header utilities (dashboard). */
  hideHeaderActions?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { auth, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { photo } = useDoctorPhoto(auth.user?.id);
  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const handleLogout = () => {
    void revokeCurrentTabSession().finally(() => {
      logout();
      setLocation("/login");
    });
  };

  if (!auth.user) {
    setLocation("/login");
    return null;
  }

  const userName = `Dr. ${auth.user.firstName} ${auth.user.lastName}`;

  return (
    <div className="doctor-shell flex h-screen overflow-hidden">
      <aside className="hidden w-[248px] flex-shrink-0 flex-col border-r border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-sidebar))] lg:flex">
        <SidebarBody
          location={location}
          userName={userName}
          role={String(auth.user.role ?? "")}
          photo={photo}
          onLogout={handleLogout}
          messageUnread={messageUnread}
        />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="doctor-shell h-full w-[min(20rem,90vw)] border-r-0 bg-[hsl(var(--doc-sidebar))] p-0 [&>button]:hidden"
        >
          <button
            onClick={() => setMobileOpen(false)}
            className="absolute right-4 top-4 z-10 p-1 doc-muted hover:text-[hsl(var(--doc-text))]"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
          <SidebarBody
            location={location}
            userName={userName}
            role={String(auth.user.role ?? "")}
            photo={photo}
            onLogout={handleLogout}
            onNavigate={() => setMobileOpen(false)}
            messageUnread={messageUnread}
          />
        </SheetContent>
      </Sheet>

      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile menu only when dashboard embeds its own header chrome */}
        {hideHeaderActions && !title ? (
          <div className="flex flex-shrink-0 items-center px-2 py-1.5 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-[hsl(var(--doc-text))]"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </Button>
          </div>
        ) : (
          <header className="flex flex-shrink-0 items-center gap-1.5 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3 lg:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-[hsl(var(--doc-text))] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </Button>
            {title ? (
              <h1 className="min-w-0 text-base font-bold leading-tight text-[hsl(var(--doc-text))] [overflow-wrap:anywhere] sm:text-xl lg:text-2xl">
                {title}
              </h1>
            ) : null}
            {!hideHeaderActions ? (
              <div className="ml-auto flex items-center">
                <HeaderIconButton
                  label="Messages"
                  icon={Mail}
                  onClick={() => setLocation("/physician/messages")}
                  badge={messageUnread > 0 ? messageUnread : undefined}
                />
                <NotificationsMenu />
                <HeaderIconButton label="Settings" icon={Settings} onClick={() => setSettingsOpen(true)} />
              </div>
            ) : (
              <div className="ml-auto" />
            )}
          </header>
        )}

        <div
          className={`min-h-0 flex-1 ${
            fill
              ? "overflow-y-auto px-3 pb-3 sm:px-5 lg:overflow-hidden lg:px-6 lg:pb-4"
              : "overflow-y-auto px-3 pb-6 sm:px-6 lg:px-8"
          }`}
        >
          {children}
        </div>
      </div>

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export function DoctorLayout({
  children,
  title,
  fill,
  hideHeaderActions,
}: {
  children: ReactNode;
  title?: string;
  fill?: boolean;
  hideHeaderActions?: boolean;
}) {
  return (
    <DoctorLayoutInner title={title} fill={fill} hideHeaderActions={hideHeaderActions}>
      {children}
    </DoctorLayoutInner>
  );
}
