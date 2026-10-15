type CopyTextarea = {
  value: string;
  setAttribute(name: string, value: string): void;
  style: { position: string; left: string };
  select(): void;
  remove(): void;
};

/**
 * Copy text on HTTPS (Clipboard API) and on plain HTTP LAN pages.
 * Does not log the text or send it anywhere.
 */
export async function copyText(
  text: string,
  env: {
    writeText?: ((value: string) => Promise<void>) | null;
    body?: { appendChild(node: CopyTextarea): void } | null;
    createTextarea?: () => CopyTextarea;
    execCommand?: (command: string) => boolean;
  } = {},
): Promise<boolean> {
  const writeText =
    env.writeText === undefined
      ? typeof navigator !== "undefined"
        ? navigator.clipboard?.writeText?.bind(navigator.clipboard)
        : undefined
      : env.writeText;
  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      /* Clipboard API missing, insecure context, or permission denied. */
    }
  }

  const body = env.body === undefined ? (typeof document !== "undefined" ? document.body : null) : env.body;
  const createTextarea =
    env.createTextarea ??
    (typeof document !== "undefined" ? () => document.createElement("textarea") : undefined);
  const execCommand =
    env.execCommand ??
    (typeof document !== "undefined" && typeof document.execCommand === "function"
      ? (command: string) => document.execCommand(command)
      : undefined);
  if (!body || !createTextarea || !execCommand) return false;

  const area = createTextarea();
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  (body as { appendChild(node: CopyTextarea): void }).appendChild(area);
  try {
    area.select();
    return execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
