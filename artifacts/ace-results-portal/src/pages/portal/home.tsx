import { Redirect } from "wouter";
import { useAuth } from "@/lib/auth";

/** Legacy route — authenticated patients go straight to the dashboard. */
export default function PortalHomePage() {
  const { portalAuth } = useAuth();

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login?as=patient" />;
  }

  return <Redirect to="/portal/dashboard" />;
}
