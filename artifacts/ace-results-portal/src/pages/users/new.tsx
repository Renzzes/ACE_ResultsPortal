import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateUser } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ArrowLeft } from "lucide-react";

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "medical_records", label: "Medical Records" },
  { value: "laboratory", label: "Laboratory Staff" },
  { value: "radiology", label: "Radiology Staff" },
  { value: "endoscopy", label: "Endoscopy Staff" },
  { value: "physician", label: "Authorized Physician" },
];

export default function NewUserPage() {
  const [, setLocation] = useLocation();
  const { auth } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    username: "", password: "", firstName: "", lastName: "", email: "", role: "medical_records",
  });

  const createUser = useCreateUser();

  if (auth.user?.role !== "super_admin") {
    return (
      <StaffLayout title="New User">
        <div className="text-center py-16">
          <p className="text-xl font-semibold text-destructive">Access Denied</p>
        </div>
      </StaffLayout>
    );
  }

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password || !form.firstName || !form.lastName || !form.role) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (form.password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    createUser.mutate(
      { data: { username: form.username, password: form.password, firstName: form.firstName, lastName: form.lastName, email: form.email || undefined, role: form.role as any } },
      {
        onSuccess: () => {
          toast({ title: "User created successfully" });
          setLocation("/users");
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Failed to create user", variant: "destructive" });
        },
      }
    );
  };

  return (
    <StaffLayout title="New User">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/users")}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">New Staff User</h2>
            <p className="text-muted-foreground">Create a new hospital staff account</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
              <Input id="firstName" placeholder="Juan" {...field("firstName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
              <Input id="lastName" placeholder="Dela Cruz" {...field("lastName")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="username">Username <span className="text-destructive">*</span></Label>
            <Input id="username" placeholder="jdelacruz" {...field("username")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password <span className="text-destructive">*</span></Label>
            <PasswordInput id="password" placeholder="Min. 8 characters" {...field("password")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" type="email" placeholder="staff@acemedical.ph" {...field("email")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role">Role <span className="text-destructive">*</span></Label>
            <select
              id="role"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={form.role}
              onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={createUser.isPending} className="flex-1">
              {createUser.isPending ? "Creating..." : "Create User"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLocation("/users")}>Cancel</Button>
          </div>
        </form>
      </div>
    </StaffLayout>
  );
}
