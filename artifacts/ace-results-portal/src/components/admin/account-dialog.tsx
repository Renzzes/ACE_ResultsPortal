import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export type AccountForm = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: string;
  password: string;
};

export type DepartmentOption = { value: string; label: string };

export function emptyAccountForm(role: string): AccountForm {
  return { firstName: "", lastName: "", username: "", email: "", role, password: "" };
}

export function AccountFormDialog({
  open,
  onOpenChange,
  title,
  description,
  mode,
  kind,
  initial,
  pending,
  departmentOptions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  mode: "create" | "edit";
  kind: "staff" | "doctor";
  initial: AccountForm;
  pending?: boolean;
  departmentOptions?: DepartmentOption[];
  onSubmit: (form: AccountForm) => void;
}) {
  const [form, setForm] = useState(initial);
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  function update<K extends keyof AccountForm>(key: K, value: AccountForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(form);
  }

  const options = departmentOptions ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ace-scroll max-h-[90vh] w-[min(96vw,32rem)] overflow-y-auto sm:rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[#153D2B]">{title}</DialogTitle>
          <DialogDescription className="text-[#64706A]">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" value={form.firstName} onChange={(value) => update("firstName", value)} required />
            <Field label="Last name" value={form.lastName} onChange={(value) => update("lastName", value)} required />
          </div>
          <Field
            label="Username"
            value={form.username}
            onChange={(value) => update("username", value)}
            required
            minLength={3}
            disabled={mode === "edit"}
          />
          <Field label="Email" type="email" value={form.email} onChange={(value) => update("email", value)} />
          {kind === "staff" ? (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#17221D]">Department</span>
              <select
                className="h-10 w-full rounded-md border border-[#DDE5E0] bg-white px-3 text-sm"
                value={form.role}
                onChange={(event) => update("role", event.target.value)}
                required
              >
                {options.length === 0 ? (
                  <option value="">No departments — add one in Admin → Departments</option>
                ) : (
                  options.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}
          {mode === "create" ? (
            <>
              <Field
                label="Temporary password"
                type="password"
                value={form.password}
                onChange={(value) => update("password", value)}
                required
                minLength={8}
              />
              <p className="text-[11px] text-[#64706A]">Username min. 3 characters. Password min. 8 characters.</p>
            </>
          ) : null}
          <button
            type="submit"
            disabled={pending || (kind === "staff" && options.length === 0)}
            className="w-full rounded-lg bg-[#2F7D4A] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : mode === "create" ? "Create account" : "Save changes"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PasswordDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending?: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    setPassword("");
    setConfirm("");
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return;
    onSubmit(password);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,28rem)] sm:rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[#153D2B]">{title}</DialogTitle>
          <DialogDescription className="text-[#64706A]">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="New password" type="password" value={password} onChange={setPassword} required />
          <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} required />
          {password && confirm && password !== confirm ? (
            <p className="text-[12px] text-[#8E3344]">Passwords do not match.</p>
          ) : null}
          <p className="text-[11px] text-[#64706A]">Minimum 8 characters. The user should change this after signing in.</p>
          <button
            type="submit"
            disabled={pending || password.length < 8 || password !== confirm}
            className="w-full rounded-lg bg-[#2F7D4A] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Updating…" : "Set password"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  minLength?: number;
}) {
  const shared = {
    value,
    required,
    disabled,
    minLength,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    className: "border-[#DDE5E0]",
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[#17221D]">{label}</span>
      {type === "password" ? <PasswordInput {...shared} /> : <Input type={type} {...shared} />}
    </label>
  );
}
