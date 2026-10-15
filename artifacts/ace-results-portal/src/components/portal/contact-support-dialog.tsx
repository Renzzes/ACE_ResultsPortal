import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const fieldClass =
  "h-12 rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

type SupportCategory = "temporary_password" | "diagnostic_access_code";

const ACK =
  "If your request can be verified, the appropriate support team will process it using the contact information associated with your account.";

export function ContactSupportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState<SupportCategory | "">("");
  const [patientHisId, setPatientHisId] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setCategory("");
    setPatientHisId("");
    setLastName("");
    setContactEmail("");
    setDetails("");
    setError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!category) {
      setError("Select a request category.");
      return;
    }
    if (!patientHisId.trim() || !lastName.trim()) {
      setError("Hospital Patient ID and last name are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/portal/support-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          patientHisId: patientHisId.trim(),
          lastName: lastName.trim(),
          contactEmail: contactEmail.trim() || undefined,
          details: details.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 429) {
        setError(typeof body.error === "string" ? body.error : "Too many requests. Please wait.");
        return;
      }
      if (!response.ok && response.status !== 202) {
        setError(typeof body.error === "string" ? body.error : "Unable to submit request.");
        return;
      }
      toast({
        title: "Request submitted",
        description: typeof body.message === "string" ? body.message : ACK,
      });
      resetForm();
      onOpenChange(false);
    } catch {
      setError("Unable to submit request. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg border-[#DDE5E0] bg-white sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[#17221D]">Contact Support</DialogTitle>
          <DialogDescription className="text-[#64706A]">
            Request help with a temporary portal password or a diagnostic results access code. Do not include
            passwords or access codes in this form.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="font-semibold text-[#17221D]">Request category</Label>
            <Select value={category || undefined} onValueChange={(value) => setCategory(value as SupportCategory)}>
              <SelectTrigger className={`${fieldClass} px-3`}>
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="temporary_password">Temporary Password Request</SelectItem>
                <SelectItem value="diagnostic_access_code">Diagnostic Results Access Code Request</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supportHisId" className="font-semibold text-[#17221D]">
              Hospital Patient ID
            </Label>
            <Input
              id="supportHisId"
              className={fieldClass}
              value={patientHisId}
              onChange={(e) => setPatientHisId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supportLastName" className="font-semibold text-[#17221D]">
              Last name
            </Label>
            <Input
              id="supportLastName"
              className={fieldClass}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supportEmail" className="font-semibold text-[#17221D]">
              Contact email (optional)
            </Label>
            <Input
              id="supportEmail"
              type="email"
              className={fieldClass}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supportDetails" className="font-semibold text-[#17221D]">
              Details (optional)
            </Label>
            <Textarea
              id="supportDetails"
              className="min-h-[88px] rounded-md border-gray-200 bg-white text-[15px]"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              placeholder="Briefly describe what you need help with"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-full rounded-md border-0 bg-[#2f5d38] font-semibold text-white hover:bg-[#254a2d]"
          >
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
