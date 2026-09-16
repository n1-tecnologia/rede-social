import { Resend } from 'resend';
import { env } from '../env';
import {
  formatMailbox,
  type MailMessage,
  type MailTransport,
  MailTransportError,
} from './transport';

/**
 * The `resend` transport (D-37/D-38): Resend's HTTP API through the official SDK, `From` as
 * `"{displayName}" <no-reply@{MAIL_DOMAIN}>`, the GoTrue `webhook-id` forwarded as the
 * `Idempotency-Key` so a hook retry can never double-send (RESEARCH A6, Pitfall 6).
 *
 * The client is constructed LAZILY on the first send and only when this transport was selected
 * (`env.MAIL_TRANSPORT=resend`): local, CI and preview environments never instantiate it (T-02-28).
 * `assertProductionEnv` already refuses `resend` without `RESEND_API_KEY` at boot; the check here is
 * the belt to those braces. The SDK takes no `AbortSignal`, so the call is raced against the signal.
 */
let client: Resend | null = null;

function getClient(): Resend {
  if (client) return client;
  if (!env.RESEND_API_KEY) {
    throw new MailTransportError('RESEND_API_KEY missing', { transport: 'resend' });
  }
  client = new Resend(env.RESEND_API_KEY);
  return client;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new MailTransportError('timeout', { transport: 'resend' }));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MailTransportError('timeout', { transport: 'resend' }));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export const resendTransport: MailTransport = {
  name: 'resend',
  async send(message: MailMessage, { signal }) {
    const resend = getClient();
    const { data, error } = await abortable(
      resend.emails.send(
        {
          from: formatMailbox(message.from),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          replyTo: message.replyTo,
          headers: { 'X-Tria-Action': message.meta.actionType },
        },
        { idempotencyKey: message.idempotencyKey },
      ),
      signal,
    );
    if (error) {
      throw new MailTransportError(error.message, { transport: 'resend', cause: error });
    }
    return { providerId: data?.id ?? null };
  },
};
