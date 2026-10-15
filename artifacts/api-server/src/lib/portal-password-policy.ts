export const PORTAL_PASSWORD_REQUIREMENTS_MSG =
  "Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.";

export function isValidPortalPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= 128 &&
    /\d/.test(password) &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
