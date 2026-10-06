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

/**
 * Asserts that NO recovery e-mail reaches `email` within `windowMs` (WR-09: a refused origin must
 * send nothing). The window is generous relative to the local mailer, which delivers in ~1 s.
 */
export async function expectNoRecoveryMail(email: string, windowMs = 6_000): Promise<void> {
  const kind = await detectFlavour();
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const link = kind === 'mailpit' ? await mailpitLatest(email) : await inbucketLatest(email);
    if (link) throw new Error(`A recovery e-mail reached ${email} although the origin was refused`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** What `latestMailMessage` reads off the newest e-mail: sender name, subject, HTML and its link. */
export type LatestMail = { fromName: string; subject: string; html: string; link: string | null };

/**
 * 08.1 (D-315/D-317): polls for up to `timeoutMs` and returns the NEWEST message to `email` with a
 * confirm link — its `From.Name`, `Subject`, `HTML` and the `/auth/confirm` link — so a spec can
 * assert whose brand the mail wears, not only where its link goes. Mailpit only: Inbucket's API
 * shape differs and no current stack ships it, so that flavour throws instead of guessing.
 */
export async function latestMailMessage(email: string, timeoutMs = 20_000): Promise<LatestMail> {
  if ((await detectFlavour()) !== 'mailpit') {
    throw new Error('latestMailMessage needs Mailpit; the local mail catcher answered as Inbucket');
  }
  const query = encodeURIComponent(`to:${email}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAIL_URL}/api/v1/search?query=${query}&limit=1`);
    if (list.ok) {
      const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
      const newest = messages?.[0];
      if (newest) {
        const full = await fetch(`${MAIL_URL}/api/v1/message/${newest.ID}`);
        if (full.ok) {
          const message = (await full.json()) as {
            From?: { Name?: string };
            Subject?: string;
            HTML?: string;
            Text?: string;
          };
          const html = message.HTML ?? '';
          return {
            fromName: message.From?.Name ?? '',
            subject: message.Subject ?? '',
            html,
            link: extractConfirmLink(`${html}${message.Text ?? ''}`),
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No e-mail for ${email} within ${timeoutMs}ms`);
}

/** Deletes every stored message so a spec never reads a previous run's e-mail. */
export async function clearMailbox(): Promise<void> {
  const kind = await detectFlavour();
  if (kind === 'mailpit') {
    await fetch(`${MAIL_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => null);
  }
}
