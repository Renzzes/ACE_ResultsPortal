export type UploadPhysician = { id: number; name: string; username?: string };

/** Attending physicians from patient_physicians, each kept once, in the given order. */
export function preselectAttendingPhysicians<T extends { id: number }>(attending: readonly T[]): T[] {
  const seen = new Set<number>();
  const rows: T[] = [];
  for (const row of attending) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

/** Replace the temporary preview URL. The previous URL is revoked when it changes. */
export function selectPreviewFile(
  currentUrl: string | null,
  nextUrl: string | null,
  revoke: (url: string) => void,
): string | null {
  if (currentUrl && currentUrl !== nextUrl) revoke(currentUrl);
  return nextUrl;
}
