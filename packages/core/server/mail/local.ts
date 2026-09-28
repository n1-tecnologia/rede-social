import { env } from '../env';
import { type MailMessage, type MailTransport, MailTransportError } from './transport';

/**
 * The `local` transport: Mailpit's HTTP API (`POST /api/v1/send`) on the local Supabase stack.
 *
 * Mailpit is the ONLY destination of this transport — there is no SMTP relay, no provider, no way
 * for a message to leave the machine. It is the fail-safe default of `env.MAIL_TRANSPORT` (D-37:
 * local dev, CI and previews never send real mail), which is why the Resend client in `./resend.ts`
 * is constructed only when `resend` is selected explicitly.
 */
export const localTransport: MailTransport = {
  name: 'local',
  async send(message: MailMessage, { signal }) {
    const body = {
      From: { Email: message.from.email, Name: message.from.name },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html,
      Headers: {
        'X-Rede-Action': message.meta.actionType,
        'X-Rede-Idempotency-Key': message.idempotencyKey ?? '',
      },
    };
    let response: Response;
    try {
      response = await fetch(`${env.MAILPIT_URL}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      throw new MailTransportError('mailpit unreachable', { transport: 'local', cause });
    }
    if (!response.ok) {
      throw new MailTransportError(`mailpit answered ${response.status}`, { transport: 'local' });
    }
    const json = (await response.json().catch(() => null)) as { ID?: string } | null;
    return { providerId: json?.ID ?? null };
  },
};
