import AccessPage, { type AccessRole } from "@/pages/access";

function registerFromQuery(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("register") === "1";
  } catch {
    return false;
  }
}

function roleFromQuery(): AccessRole {
  try {
    const value = new URLSearchParams(window.location.search).get("as");
    if (value === "admin" || value === "staff" || value === "doctor" || value === "patient") return value;
  } catch {
    // keep default
  }
  return "patient";
}

export default function Login() {
  return <AccessPage defaultRole={roleFromQuery()} initialRegisterOpen={registerFromQuery()} />;
}
