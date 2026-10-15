import { createTransport, type Transporter } from "nodemailer";
import { logger } from "./logger";

let cachedTransporter: Transporter | null | undefined;

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from =
    process.env.PORTAL_EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    user ||
    "noreply@ace-medical.local";

  if (!host) return null;
  return { host, port, user, pass, from };
}

let configuredOverride: boolean | null = null;

export function isPortalEmailConfigured(): boolean {
  if (configuredOverride !== null) return configuredOverride;
  return getSmtpConfig() !== null;
}

function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;
  const config = getSmtpConfig();
  if (!config) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
  return cachedTransporter;
}

export type PortalEmailSendResult =
  | { accepted: true }
  | { accepted: false; uncertain: false }
  | { accepted: false; uncertain: true; reason: string };

function isUncertainTransportError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: string }).code ?? "").toUpperCase();
  const message = String((err as { message?: string }).message ?? "").toLowerCase();
  return (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

async function defaultSendPortalEmailDetailed(
  to: string,
  subject: string,
  text: string,
): Promise<PortalEmailSendResult> {
  const transporter = getTransporter();
  const config = getSmtpConfig();
  if (!transporter || !config) {
    logger.warn({ to: maskRecipient(to) }, "portal_email_not_configured");
    return { accepted: false, uncertain: false };
  }

  try {
    await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text,
    });
    // Transport accepted the message for sending — not a guarantee of inbox delivery.
    logger.info({ to: maskRecipient(to), subject }, "portal_email_accepted");
    return { accepted: true };
  } catch (err) {
    if (isUncertainTransportError(err)) {
      logger.error({ err, to: maskRecipient(to), subject }, "portal_email_send_uncertain");
      return {
        accepted: false,
        uncertain: true,
        reason: "SMTP transport timed out or dropped before a definitive acceptance response.",
      };
    }
    logger.error({ err, to: maskRecipient(to), subject }, "portal_email_send_failed");
    return { accepted: false, uncertain: false };
  }
}

type SendPortalEmailFn = (to: string, subject: string, text: string) => Promise<boolean>;
type SendPortalEmailDetailedFn = (
  to: string,
  subject: string,
  text: string,
) => Promise<PortalEmailSendResult>;

let sendImpl: SendPortalEmailFn = async (to, subject, text) => {
  const result = await defaultSendPortalEmailDetailed(to, subject, text);
  return result.accepted;
};
let sendDetailedImpl: SendPortalEmailDetailedFn = defaultSendPortalEmailDetailed;

export async function sendPortalEmail(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  return sendImpl(to, subject, text);
}

/** Richer SMTP outcome for credential workflows that must preserve hashes on failure. */
export async function sendPortalEmailDetailed(
  to: string,
  subject: string,
  text: string,
): Promise<PortalEmailSendResult> {
  return sendDetailedImpl(to, subject, text);
}

/** Test-only: replace email sender (e.g. force failure). Pass null to restore. */
export function setPortalEmailSenderForTests(fn: SendPortalEmailFn | null): void {
  if (!fn) {
    sendImpl = async (to, subject, text) => {
      const result = await defaultSendPortalEmailDetailed(to, subject, text);
      return result.accepted;
    };
    sendDetailedImpl = defaultSendPortalEmailDetailed;
    configuredOverride = null;
    return;
  }
  sendImpl = fn;
  sendDetailedImpl = async (to, subject, text) => {
    const accepted = await fn(to, subject, text);
    return accepted ? { accepted: true } : { accepted: false, uncertain: false };
  };
  configuredOverride = true;
}

/** Test-only: inject detailed SMTP outcomes including uncertain timeouts. */
export function setPortalEmailDetailedSenderForTests(fn: SendPortalEmailDetailedFn | null): void {
  if (!fn) {
    setPortalEmailSenderForTests(null);
    return;
  }
  sendDetailedImpl = fn;
  sendImpl = async (to, subject, text) => (await fn(to, subject, text)).accepted;
  configuredOverride = true;
}

function maskRecipient(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export const EMAIL_UNAVAILABLE_MESSAGE =
  "Email delivery is temporarily unavailable. Please try again later or contact ACE Medical Center Cebu.";
