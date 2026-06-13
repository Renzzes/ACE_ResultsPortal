import { useState, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Activity, Users, FileText, Settings, LogOut, LayoutDashboard, Search,
  Archive, UserCog, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

function NavItems({
  navItems,
  location,
  onNavigate,
}: {
  navItems: { href: string; label: string; icon: React.ElementType }[];
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function StaffLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { auth, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  if (!auth.user) {
    setLocation("/login");
    return null;
  }

  const isPhysician = auth.user.role === "physician";

  const navItems = isPhysician
    ? [{ href: "/physician/search", label: "Patient Search", icon: Search }]
    : [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/patients", label: "Patients", icon: Users },
        { href: "/results", label: "Results", icon: FileText },
        { href: "/audit-logs", label: "Audit Logs", icon: Activity },
        { href: "/archive", label: "Archive", icon: Archive },
      ];

  if (auth.user.role === "super_admin") {
    navItems.push({ href: "/users", label: "Staff Users", icon: UserCog });
  }
  navItems.push({ href: "/settings", label: "Settings", icon: Settings });

  const userLabel = `${auth.user.firstName} ${auth.user.lastName}`;
  const roleLabel = auth.user.role.replace("_", " ");

  return (
    <div className="flex h-screen bg-muted/30">

      {/* ── Desktop sidebar (hidden on mobile) ─────────────────────────── */}
      <aside className="hidden md:flex w-64 bg-sidebar border-r border-sidebar-border flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="font-bold text-xl text-primary">ACE Medical</h1>
          <p className="text-xs text-muted-foreground mt-1">Results Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavItems navItems={navItems} location={location} />
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-4 px-2">
            <p className="text-sm font-medium">{userLabel}</p>
            <p className="text-xs text-muted-foreground capitalize">{roleLabel}</p>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* ── Mobile Sheet sidebar ─────────────────────────────────────────── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar flex flex-col">
          <SheetHeader className="p-6 border-b border-sidebar-border">
            <SheetTitle className="font-bold text-xl text-primary text-left">ACE Medical</SheetTitle>
            <p className="text-xs text-muted-foreground text-left">Results Portal</p>
          </SheetHeader>
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            <NavItems
              navItems={navItems}
              location={location}
              onNavigate={() => setMobileOpen(false)}
            />
          </nav>
          <div className="p-4 border-t border-sidebar-border">
            <div className="mb-4 px-2">
              <p className="text-sm font-medium">{userLabel}</p>
              <p className="text-xs text-muted-foreground capitalize">{roleLabel}</p>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Main content area ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-sidebar border-b border-sidebar-border flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <span className="font-bold text-base text-primary">ACE Medical</span>
            <span className="text-xs text-muted-foreground ml-2">Results Portal</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize truncate max-w-[120px]">
            {userLabel}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
