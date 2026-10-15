/** Enter sends. Shift+Enter and IME composition keep the default newline/input behavior. */
export function enterSendsMessage(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
}): boolean {
  return event.key === "Enter" && !event.shiftKey && event.isComposing !== true;
}

/**
 * Empty and whitespace-only drafts are not sent.
 * Trim is only the emptiness check; the returned text keeps internal newlines.
 */
export function messageBodyToSend(draft: string, pending: boolean): string | null {
  if (pending) return null;
  const text = draft.trim();
  return text.length > 0 ? text : null;
}
