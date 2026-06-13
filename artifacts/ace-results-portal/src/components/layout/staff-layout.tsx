import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Activity, Users, FileText, Settings, LogOut, LayoutDashboard, Search,
  Archive, UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function StaffLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { auth, logout } = useAuth();

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
    ? [
        { href: "/physician/search", label: "Patient Search", icon: Search },
      ]
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

  return (
    <div className="flex h-screen bg-muted/30">
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="font-bold text-xl text-primary">ACE Medical</h1>
          <p className="text-xs text-muted-foreground mt-1">Results Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-4 px-2">
            <p className="text-sm font-medium">{auth.user.firstName} {auth.user.lastName}</p>
            <p className="text-xs text-muted-foreground capitalize">{auth.user.role.replace("_", " ")}</p>
          </div>
          <Button variant="outline" className="w-full justify-start text-destructive" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
