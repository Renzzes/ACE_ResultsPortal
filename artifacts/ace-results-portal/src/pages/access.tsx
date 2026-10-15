import { useState, type FormEvent, type ChangeEvent } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { ApiError, useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuthSplitLayout } from "@/components/layout/auth-split-layout";
import { ContactSupportDialog } from "@/components/portal/contact-support-dialog";
import { RegisterDialog } from "@/pages/register";
import { useToast } from "@/hooks/use-toast";
import { fetchActiveDepartments } from "@/lib/admin-api";

export type AccessRole = "patient" | "staff" | "doctor" | "admin";

/** Department code from dbo.departments (dynamic). */
export type StaffDepartment = string;

const staffLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  department: z.string().optional(),
});

const fieldClass =
  "h-12 rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

const roleCopy: Record<AccessRole, { title: string; subtitle: string }> = {
  patient: { title: "Patient Portal Login", subtitle: "Access your diagnostic results" },
  staff: { title: "Log In", subtitle: "Hospital personnel access" },
  doctor: { title: "Log In", subtitle: "Physician access" },
  admin: { title: "Log In", subtitle: "System administrator access" },
};

export default function AccessPage({
  defaultRole = "patient",
  initialRegisterOpen = false,
}: {
  defaultRole?: AccessRole;
  initialRegisterOpen?: boolean;
}) {
  const [, setLocation] = useLocation();
  const { setAuth, setPortalAuth } = useAuth();
  const { toast } = useToast();
  const [registerOpen, setRegisterOpen] = useState(initialRegisterOpen);
  const [supportOpen, setSupportOpen] = useState(false);
  const [role, setRole] = useState<AccessRole>(defaultRole);
  const [consented, setConsented] = useState(false);
  const [patientForm, setPatientForm] = useState({ patientHisId: "", lastName: "", password: "" });
  const [patientLoginPending, setPatientLoginPending] = useState(false);

  const loginMutation = useLogin();
  const { data: departmentsData } = useQuery({
    queryKey: ["active-departments"],
    queryFn: fetchActiveDepartments,
  });
  const staffDepartments = (departmentsData?.data ?? []).map((d) => ({
    value: d.code,
    label: d.name,
  }));
  const staffForm = useForm<z.infer<typeof staffLoginSchema>>({
    resolver: zodResolver(staffLoginSchema),
    defaultValues: { username: "", password: "", department: "" },
  });

  const copy = roleCopy[role];

  function onStaffSubmit(values: z.infer<typeof staffLoginSchema>) {
    if (role === "staff" && !values.department) {
      staffForm.setError("department", { message: "Department is required" });
      return;
    }

    const portal = role === "admin" ? "admin" : role === "doctor" ? "doctor" : "staff";
    loginMutation.mutate(
      { data: { username: values.username, password: values.password, portal } },
      {
        onSuccess: (data) => {
          const accountRole = data.user?.role;

          if (role === "admin") {
            if (accountRole !== "super_admin") {
              toast({
                title: "Not an administrator account",
                description: "Choose Staff or Doctor for hospital personnel and physician access.",
                variant: "destructive",
              });
              return;
            }
            setAuth(data.user, data.accessToken, data.sessionPublicId);
            setLocation("/admin");
            return;
          }

          if (accountRole === "physician") {
            if (role === "staff") {
              toast({
                title: "Physician account",
                description: "Opening the doctor dashboard. Next time, choose Doctor above.",
              });
            }
            setAuth(data.user, data.accessToken, data.sessionPublicId);
            setLocation("/physician/overview");
            return;
          }

          if (role === "doctor") {
            toast({
              title: "Not a physician account",
              description: "Choose Staff for hospital personnel, or use the development doctor account.",
              variant: "destructive",
            });
            return;
          }

          if (role === "staff" && values.department) {
            const allowed =
              accountRole === "super_admin" || accountRole === values.department;
            if (!allowed) {
              toast({
                title: "Department mismatch",
                description: "This account is not registered under the selected department.",
                variant: "destructive",
              });
              return;
            }
          }

          setAuth(data.user, data.accessToken, data.sessionPublicId);
          setLocation("/dashboard");
        },
        onError: (err: unknown) => {
          const status = err instanceof ApiError ? err.status : undefined;
          if (status === 404 || status === 502 || status === 503 || status === 504) {
            toast({
              title: "Cannot reach the API",
              description: "The API server is not running. Start it, then try again.",
              variant: "destructive",
            });
            return;
          }
          if (status === 429) {
            toast({
              title: "Too many attempts",
              description: "Wait a few minutes, then try again.",
              variant: "destructive",
            });
            return;
          }
          if (status === 403) {
            toast({
              title: "Account locked",
              description: "This account is temporarily locked after failed logins.",
              variant: "destructive",
            });
            return;
          }
          toast({ title: "Login Failed", description: "Invalid credentials. Please try again.", variant: "destructive" });
        },
      }
    );
  }

  async function onPatientSubmit(e: FormEvent) {
    e.preventDefault();
    if (!consented) {
      toast({ title: "Please accept the consent statement to proceed", variant: "destructive" });
      return;
    }
    if (!patientForm.patientHisId || !patientForm.lastName || !patientForm.password) {
      toast({
        title: "Please enter your Hospital Patient ID, last name, and password",
        variant: "destructive",
      });
      return;
    }

    setPatientLoginPending(true);
    try {
      const response = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: patientForm.patientHisId.trim(),
          lastName: patientForm.lastName.trim(),
          password: patientForm.password,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sessionToken?: string;
        sessionPublicId?: string;
        mustChangePassword?: boolean;
        patient?: { id: number; patientHisId: string; firstName: string; lastName: string; middleName?: string | null };
      };
      if (response.status === 429) {
        toast({ title: "Too many attempts", description: "Wait a few minutes, then try again.", variant: "destructive" });
        return;
      }
      if (response.status === 403) {
        toast({
          title: "Account locked",
          description: "This account is temporarily locked after failed logins.",
          variant: "destructive",
        });
        return;
      }
      if (!response.ok || !data.sessionToken || !data.sessionPublicId || !data.patient) {
        toast({
          title: "Sign in failed",
          description: data.error ?? "Invalid patient credentials.",
          variant: "destructive",
        });
        return;
      }
      setPortalAuth(data.patient, data.sessionToken, data.sessionPublicId);
      if (data.mustChangePassword === true) {
        setLocation("/portal/change-password");
      } else {
        setLocation("/portal/dashboard");
      }
    } catch {
      toast({
        title: "Cannot reach the API",
        description: "The API server is not running. Start it, then try again.",
        variant: "destructive",
      });
    } finally {
      setPatientLoginPending(false);
    }
  }

  const patientField = (k: keyof typeof patientForm) => ({
    value: patientForm[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setPatientForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <AuthSplitLayout onRegister={() => setRegisterOpen(true)}>
      <h1 className="text-[28px] font-bold tracking-tight text-gray-900">{copy.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{copy.subtitle}</p>

      <div className="mt-8 space-y-1.5">
        <Label className="text-[15px] font-semibold text-gray-900">I am a</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value as AccessRole);
            staffForm.reset({ username: "", password: "", department: "" });
          }}
        >
          <SelectTrigger className={`${fieldClass} px-3`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="patient">Patient</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="doctor">Doctor</SelectItem>
            <SelectItem value="admin">Administrator</SelectItem>
          </SelectContent>
        </Select>
        {role === "doctor" && (
          <p className="text-xs text-gray-500">
            Use your physician username and password. You will open the doctor dashboard.
          </p>
        )}
        {role === "admin" && (
          <p className="text-xs text-gray-500">
            Use your administrator username and password. You will open Admin Control.
          </p>
        )}
      </div>

      {role === "patient" ? (
        <form onSubmit={onPatientSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hisId" className="text-[15px] font-semibold text-gray-900">
              Hospital Patient ID
            </Label>
            <Input
              id="hisId"
              placeholder="Enter your hospital patient ID"
              className={fieldClass}
              autoComplete="username"
              {...patientField("patientHisId")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-[15px] font-semibold text-gray-900">
              Last Name
            </Label>
            <Input
              id="lastName"
              placeholder="As registered with ACE Medical"
              className={fieldClass}
              autoComplete="family-name"
              {...patientField("lastName")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[15px] font-semibold text-gray-900">
              Password
            </Label>
            <PasswordInput
              id="password"
              placeholder="Enter your password"
              className={fieldClass}
              autoComplete="current-password"
              {...patientField("password")}
            />
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#97ab96]"
              />
              <span className="text-xs leading-relaxed text-gray-500">
                I confirm that I am the patient named above or an authorized representative, and I am accessing these medical results for legitimate purposes.
              </span>
            </label>
          </div>
          <Button
            type="submit"
            className="h-12 w-full rounded-md border-0 bg-[#97ab96] text-base font-semibold text-white hover:bg-[#879c86]"
            disabled={patientLoginPending || !consented}
          >
            {patientLoginPending ? "Signing in…" : "Sign In"}
          </Button>

          <p className="text-center text-sm text-gray-500 lg:hidden">
            Not yet registered?{" "}
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="font-semibold text-[#2f5d38] underline underline-offset-2"
            >
              Verify your hospital record
            </button>
          </p>
          <p className="text-center text-sm text-gray-400">
            Forgot Password?{" "}
            <Link href="/recover?as=patient" className="font-semibold text-[#2f5d38] underline underline-offset-2">
              Reset your password here
            </Link>
          </p>
          <p className="text-center text-sm text-gray-400">
            Need help?{" "}
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="font-semibold text-[#2f5d38] underline underline-offset-2"
            >
              Contact Support
            </button>
          </p>
        </form>
      ) : (
        <Form {...staffForm}>
          <form onSubmit={staffForm.handleSubmit(onStaffSubmit)} className="mt-5 space-y-5">
            {role === "staff" && (
              <FormField
                control={staffForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[15px] font-semibold text-gray-900">Department</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className={`${fieldClass} px-3`}>
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {staffDepartments.map((dept) => (
                          <SelectItem key={dept.value} value={dept.value}>
                            {dept.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={staffForm.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                    <FormLabel className="text-[15px] font-semibold text-gray-900">Username</FormLabel>
                    <FormControl>
                    <Input placeholder="Enter your username" className={fieldClass} autoComplete="username" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={staffForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[15px] font-semibold text-gray-900">Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="Enter your password"
                      className={fieldClass}
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="mt-2 h-12 w-full rounded-md border-0 bg-[#97ab96] text-base font-semibold text-white hover:bg-[#879c86]"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in…" : "Log In"}
            </Button>
          </form>
        </Form>
      )}

      {role !== "patient" && (
        <p className="mt-4 text-center text-sm">
          <Link href="/recover" className="font-semibold text-[#2f5d38] underline underline-offset-2">
            Forgot Login Details?
          </Link>
        </p>
      )}
      <p className="mt-8 text-center text-xs text-gray-400">
        By signing in you confirm authorized hospital use of this system.
      </p>
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
      <ContactSupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
    </AuthSplitLayout>
  );
}
