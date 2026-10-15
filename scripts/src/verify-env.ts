import { loadRootEnv } from "@workspace/db";

function status(name: string): { loaded: string; length: number } {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return { loaded: "NOT LOADED", length: 0 };
  }
  return { loaded: "LOADED", length: value.length };
}

const result = loadRootEnv();
const password = status("DB_PASSWORD");
const jwt = status("JWT_SECRET");
const bootstrap = status("ADMIN_BOOTSTRAP_PASSWORD");

console.log("Environment file:");
console.log(result.envPath);
console.log("");
console.log("Environment file exists:");
console.log(result.exists ? "YES" : "NO");
console.log("");
console.log("Environment loaded:");
console.log(result.loaded ? "YES" : "NO");
console.log("");
console.log("DB_SERVER:");
console.log(process.env.DB_SERVER ?? "");
console.log("");
console.log("DB_PORT:");
console.log(process.env.DB_PORT ?? "");
console.log("");
console.log("DB_USER:");
console.log(process.env.DB_USER ?? "");
console.log("");
console.log("DB_DATABASE:");
console.log(process.env.DB_DATABASE ?? "");
console.log("");
console.log("DB_PASSWORD:");
console.log(password.loaded);
console.log("");
console.log("DB_PASSWORD LENGTH:");
console.log(String(password.length));
console.log("");
console.log("JWT_SECRET:");
console.log(jwt.loaded);
console.log("");
console.log("JWT_SECRET LENGTH:");
console.log(String(jwt.length));
console.log("");
console.log("ADMIN_BOOTSTRAP_PASSWORD:");
console.log(bootstrap.loaded);
console.log("");
console.log("DOCTOR_BOOTSTRAP_PASSWORD:");
console.log(status("DOCTOR_BOOTSTRAP_PASSWORD").loaded);
console.log("");
console.log("PATIENT_BOOTSTRAP_PASSWORD:");
console.log(status("PATIENT_BOOTSTRAP_PASSWORD").loaded);
console.log("");
console.log("STAFF_BOOTSTRAP_PASSWORD:");
console.log(status("STAFF_BOOTSTRAP_PASSWORD").loaded);
console.log("");
console.log("RESULT_STORAGE_ROOT:");
console.log(
  process.env.RESULT_STORAGE_ROOT && process.env.RESULT_STORAGE_ROOT.trim() !== ""
    ? "LOADED"
    : "NOT LOADED (default artifacts/api-server/uploads)",
);
