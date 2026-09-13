/**
 * Reads the local Supabase mail catcher so the recovery e2e can follow a real e-mail link.
 *
 * The Supabase CLI has shipped two different catchers behind the same container/port: Inbucket
 * (`/api/v1/mailbox/{local-part}`) and, since the `[local_smtp]` config block, Mailpit
 * (`/api/v1/search` + `/api/v1/message/{id}`). Both are implemented here and the flavour is detected
 * once by probing which endpoint answers, so the suite keeps working across CLI upgrades.
 */

const MAIL_URL = (process.env.PLAYWRIGHT_MAIL_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');

type Flavour = 'mailpit' | 'inbucket';
let flavour: Flavour | null = null;

async function detectFlavour(): Promise<Flavour> {
  if (flavour) return flavour;
  const mailpit = await fetch(`${MAIL_URL}/api/v1/info`).catch(() => null);
  flavour = mailpit?.ok ? 'mailpit' : 'inbucket';
  return flavour;
}

/** First `href` in the HTML body that points at the web app's confirm route. */
function extractConfirmLink(html: string): string | null {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = (match[1] ?? '').replace(/&amp;/g, '&');
    if (href.includes('/auth/confirm')) return href;
  }
  return null;
}

async function mailpitLatest(email: string): Promise<string | null> {
  const query = encodeURIComponent(`to:${email}`);
  const list = await fetch(`${MAIL_URL}/api/v1/search?query=${query}&limit=20`);
  if (!list.ok) return null;
  const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
  for (const message of messages ?? []) {
    const full = await fetch(`${MAIL_URL}/api/v1/message/${message.ID}`);
    if (!full.ok) continue;
    const { HTML, Text } = (await full.json()) as { HTML?: string; Text?: string };
    const link = extractConfirmLink(`${HTML ?? ''}${Text ?? ''}`);
    if (link) return link;
  }
  return null;
}

async function inbucketLatest(email: string): Promise<string | null> {
  const mailbox = encodeURIComponent(email.split('@')[0] ?? email);
  const list = await fetch(`${MAIL_URL}/api/v1/mailbox/${mailbox}`);
  if (!list.ok) return null;
  const messages = (await list.json()) as Array<{ id: string }>;
  for (const message of [...messages].reverse()) {
    const full = await fetch(`${MAIL_URL}/api/v1/mailbox/${mailbox}/${message.id}`);
    if (!full.ok) continue;
    const { body } = (await full.json()) as { body?: { html?: string; text?: string } };
    const link = extractConfirmLink(`${body?.html ?? ''}${body?.text ?? ''}`);
    if (link) return link;
  }
  return null;
}

/**
 * Polls for up to `timeoutMs` and returns the `/auth/confirm` link of the newest recovery e-mail sent
 * to `email`. Throws when nothing arrives, so a silent mailer failure fails the test loudly.
 */
export async function waitForRecoveryMail(email: string, timeoutMs = 20_000): Promise<string> {
  const kind = await detectFlavour();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const link = kind === 'mailpit' ? await mailpitLatest(email) : await inbucketLatest(email);
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `No recovery e-mail with an /auth/confirm link for ${email} within ${timeoutMs}ms`,
  );
}

/** Deletes every stored message so a spec never reads a previous run's e-mail. */
export async function clearMailbox(): Promise<void> {
  const kind = await detectFlavour();
  if (kind === 'mailpit') {
    await fetch(`${MAIL_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => null);
  }
}
