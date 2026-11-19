import { cutOnWord } from '@rede-social/contracts/text';
import type { NotificationPushHint } from '@rede-social/core/server/notifications/source';
import {
  PUSH_PATH,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_PAYLOAD_VERSION,
  PUSH_TITLE_TEXT_MAX,
  type PushPayload,
} from '../../contracts/index';

/**
 * The server-rendered push title copy (UI-SPEC §Push banner copy, UI-D-266/267). Push text exists
 * before any page loads, so it cannot come from next-intl: it lives with the server code that sends it.
 * The only title that is not the tenant's bare display name is a support reply's.
 */
export const PUSH_TITLE_COPY = {
  team: (tenant: string) => `Equipe ${tenant}`,
} as const;

/**
 * The neutral 192px icon of the unbranded shell, for a tenant whose branding has no derived icon set.
 * The same path `apps/web/lib/manifest.ts` serves as the neutral manifest's `i192`
 * (`apps/web/public/icons/rede-social-192.png`); a same-origin path the service worker resolves.
 */
export const NEUTRAL_PUSH_ICON = '/icons/rede-social-192.png';

/** How many graphemes each shortening step removes from the body. */
const SHORTEN_STEP = 20;

export interface BuildPushPayloadInput {
  /** The tenant's display name. */
  tenantName: string;
  /** The tenant's branding `iconUrls.i192`, or the neutral icon. */
  iconUrl: string;
  hint: NotificationPushHint;
  /** The recipient's unseen notifications + unread conversations at send time (D-239). */
  badge: number;
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const graphemes = (value: string) =>
  Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(value)).length;

/**
 * The literal title (D-728/D-729) cut on a GRAPHEME boundary to `PUSH_TITLE_TEXT_MAX` with `…` when it
 * was cut, never on a UTF-16 unit; `null` when it is absent or blank so the caller falls back to the
 * tenant title and the service worker always gets a non-empty string.
 */
function literalTitle(titleText: string | undefined): string | null {
  const text = titleText?.trim();
  if (!text) return null;
  const parts = Array.from(
    new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text),
    (part) => part.segment,
  );
  if (parts.length <= PUSH_TITLE_TEXT_MAX) return text;
  return `${parts.slice(0, PUSH_TITLE_TEXT_MAX).join('')}…`;
}

/**
 * The versioned payload for ONE recipient (`{ v: 1, title, body, icon, url, tag, renotify, badge }`),
 * serialised. The producer already cut the body on a word (`cutOnWord`, ~80 graphemes for an excerpt,
 * ~100 for a chat preview); here the SERIALISED payload is bounded at `PUSH_PAYLOAD_MAX_BYTES` UTF-8
 * bytes: while it is over, the body is cut again, 20 graphemes per step, with `…`. The URL and the tag
 * are never shortened (a cut URL would open the wrong screen, a cut tag would break collapsing); a
 * payload whose fixed fields alone exceed the bound throws, since that is a producer bug.
 *
 * A hint's optional `titleText` (D-728/D-729) replaces the title when it is not blank, cut at
 * `PUSH_TITLE_TEXT_MAX` graphemes; the byte bound still shortens only the body.
 *
 * `url` must be a same-origin path (`/…`, never `//…`): anything else throws, because the service worker
 * resolves it against the tenant's origin and a protocol-relative URL would leave it.
 */
export function buildPushPayload({ tenantName, iconUrl, hint, badge }: BuildPushPayloadInput): {
  payload: PushPayload;
  json: string;
} {
  if (!PUSH_PATH.test(hint.url)) {
    throw new Error('push payload url must be a same-origin path');
  }
  const title =
    literalTitle(hint.titleText) ??
    (hint.title === 'team' ? PUSH_TITLE_COPY.team(tenantName) : tenantName);

  let body = hint.body;
  for (;;) {
    const payload: PushPayload = {
      v: PUSH_PAYLOAD_VERSION,
      title,
      body,
      icon: iconUrl,
      url: hint.url,
      tag: hint.tag,
      renotify: hint.renotify,
      badge: Math.max(0, Math.trunc(badge)),
    };
    const json = JSON.stringify(payload);
    if (utf8Bytes(json) <= PUSH_PAYLOAD_MAX_BYTES) return { payload, json };
    if (body === '') throw new Error('push payload exceeds the size bound without a body');
    body = cutOnWord(body, Math.max(graphemes(body) - SHORTEN_STEP, 0));
  }
}
