/**
 * Mail-transport contract (D-37/D-38). Environment-free on purpose: the kernel selects the
 * implementation in `./index.ts` from `env.MAIL_TRANSPORT`, the templates never see a transport, and
 * this file may be imported by unit tests without the env placeholders.
 */

export type MailAddress = { name: string; email: string };

export type MailMessage = {
  from: MailAddress;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /**
   * The GoTrue `webhook-id`. A transport that supports idempotency (Resend) forwards it so a retry
   * inside the hook budget can never produce a second delivery (Pitfall 6).
   */
  idempotencyKey?: string;
  meta: { actionType: string; tenantId: string | null };
};

export interface MailTransport {
  readonly name: 'local' | 'resend';
  send(
    message: MailMessage,
    options: { signal: AbortSignal },
  ): Promise<{ providerId: string | null }>;
}

/** Any failure of the provider call (network, non-2xx, SDK error, abort). Never carries the body. */
export class MailTransportError extends Error {
  readonly transport: MailTransport['name'];

  constructor(message: string, options: { transport: MailTransport['name']; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'MailTransportError';
    this.transport = options.transport;
  }
}

/**
 * GoTrue's Send Email Hook budget is 5 s INCLUDING up to three retries (RESEARCH Pitfall 6). The
 * provider call gets 3 s so the route still answers a definitive status inside that window.
 */
export const MAIL_SEND_TIMEOUT_MS = 3_000;

/**
 * RFC 5322 mailbox with a quoted display name: `"Associação São José" <no-reply@…>`. Quotes,
 * backslashes and line breaks are removed from the name (header injection), whitespace collapsed;
 * UTF-8 stays intact — the provider's MIME layer performs the RFC 2047 encoding (D-38 encoding edge).
 */
export function formatMailbox({ name, email }: MailAddress): string {
  const safeName = name
    .replace(/["\\\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName ? `"${safeName}" <${email}>` : email;
}

/** `m***@rede-demo.local` — enough to correlate a log line, never the address itself. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}
