/**
 * The service worker's push decisions (NOTIF-03, D-232, D-236, D-239, UI-D-266), kept pure so Vitest
 * can pin them with fake clients: `app/sw.ts` only wires these into its `push`, `notificationclick`
 * and `pushsubscriptionchange` listeners. Nothing here touches a DOM or service-worker global, and
 * nothing is imported: the payload check below MIRRORS `pushPayloadSchema` (07-06) by hand, because
 * importing the zod schema adds about 440 KB to a worker every client re-downloads on each update.
 * `push-sw.test.ts` pins the mirror against the real schema on a table of payloads.
 *
 * Facts a reader must not "fix":
 *
 * 1. **Every push shows something** unless the foreground rule says otherwise. A missing, unparseable
 *    or non-v1 payload falls back to `PUSH_FALLBACK`, never to a silent return: Chrome shows its own
 *    "site updated in the background" banner, and WebKit revokes the subscription (RESEARCH Pitfalls
 *    5 and 7).
 * 2. **WebKit always shows** (`mustAlwaysShow`). Chromium and Firefox may skip the banner while a
 *    window of the origin is focused and visible; Safari on macOS and every iOS browser may not,
 *    because WebKit revokes subscriptions whose pushes are not user-visible. The UA rule is [ASSUMED]
 *    (RESEARCH A5) and confirmed on devices by the real-device plan.
 * 3. **A push never navigates off-origin** (T-07-42). The payload `url` is used only when it is a
 *    same-origin PATH (`/…`, never `//…` or `/\…`); anything else opens `/inicio`, and `focusOrOpen`
 *    only ever touches windows of the worker's own origin.
 */

/**
 * UI-D-267: THE ONE ALLOWED LITERAL SET. A service worker has no catalog at runtime, so the banner a
 * malformed payload shows is written here, in a `.ts` file the literal check never scans. Every
 * other pt-BR string lives in `apps/web/messages/pt-BR/*.json`. The icon is the neutral set's
 * `i192` (`/icons/rede-social-192.png`, the path 07-06's `NEUTRAL_PUSH_ICON` uses).
 */
export const PUSH_FALLBACK = Object.freeze({
  title: 'Nova notificação',
  body: 'Abra o app para ver.',
  url: '/inicio',
  tag: 'fallback',
  renotify: false,
  icon: '/icons/rede-social-192.png',
  badge: null,
});

/** What the `push` listener shows: the v1 payload's fields, `badge` null when absent (fallback). */
export type DisplayPush = {
  title: string;
  body: string;
  icon: string;
  url: string;
  tag: string;
  renotify: boolean;
  badge: number | null;
};

/** A `PushMessageData`-like object: only `json()` is used. */
export type PushDataLike = { json(): unknown } | null | undefined;

/** Parses the push data into a displayable payload; total (never throws). */
export function parsePushPayload(data: PushDataLike): DisplayPush {
  if (!data) return { ...PUSH_FALLBACK };
  let raw: unknown;
  try {
    raw = data.json();
  } catch {
    return { ...PUSH_FALLBACK };
  }
  if (!isPushPayloadV1(raw)) return { ...PUSH_FALLBACK };
  const { title, body, icon, url, tag, renotify, badge } = raw;
  return { title, body, icon, url: resolveClickUrl(url), tag, renotify, badge };
}

/** `PUSH_PATH` and `PUSH_TAG` from the notifications contracts, copied (see the module docblock). */
const PUSH_PATH = /^\/(?![/\\])[^\\\s]*$/;
const PUSH_TAG = /^[A-Za-z0-9_-]{1,64}$/;
const PAYLOAD_KEYS = ['badge', 'body', 'icon', 'renotify', 'tag', 'title', 'url', 'v'];

type PushPayloadV1 = {
  v: 1;
  title: string;
  body: string;
  icon: string;
  url: string;
  tag: string;
  renotify: boolean;
  badge: number;
};

/** The hand mirror of the strict `pushPayloadSchema`: exact keys, types, regexes and bounds. */
export function isPushPayloadV1(value: unknown): value is PushPayloadV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((k, i) => k !== PAYLOAD_KEYS[i])) {
    return false;
  }
  return (
    o.v === 1 &&
    typeof o.title === 'string' &&
    o.title.length >= 1 &&
    typeof o.body === 'string' &&
    typeof o.icon === 'string' &&
    o.icon.length >= 1 &&
    typeof o.url === 'string' &&
    PUSH_PATH.test(o.url) &&
    typeof o.tag === 'string' &&
    PUSH_TAG.test(o.tag) &&
    typeof o.renotify === 'boolean' &&
    typeof o.badge === 'number' &&
    Number.isSafeInteger(o.badge) &&
    o.badge >= 0
  );
}

/** A same-origin path (`/…`, not `//…` or `/\…`, no backslash or whitespace), else `/inicio`. */
export function resolveClickUrl(url: unknown): string {
  if (typeof url !== 'string') return PUSH_FALLBACK.url;
  if (!url.startsWith('/') || url.startsWith('//')) return PUSH_FALLBACK.url;
  if (/[\\\s]/.test(url)) return PUSH_FALLBACK.url;
  return url;
}

/** WebKit (and anything that is neither Chromium nor Firefox) must show every push. */
export function mustAlwaysShow(ua: string): boolean {
  return !/Chrome\/|Firefox\//.test(ua);
}

export type WindowState = { focused: boolean; visibilityState: string };

/**
 * `show` is false only when a window of the origin is focused AND visible AND the browser may skip
 * (Chromium/Firefox). `badge` is the number the worker hands to `setAppBadge`, or null.
 */
export function decidePushDisplay({
  payload,
  windows,
  ua,
}: {
  payload: DisplayPush;
  windows: readonly WindowState[];
  ua: string;
}): { show: boolean; badge: number | null } {
  const badge = typeof payload.badge === 'number' ? payload.badge : null;
  const inFront = windows.some((w) => w.focused && w.visibilityState === 'visible');
  return { show: !(inFront && !mustAlwaysShow(ua)), badge };
}

export type WindowClientLike = {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
};

export type ClientsLike = {
  matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly unknown[]>;
  openWindow(url: string): Promise<unknown>;
};

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Focuses a window of `origin` and navigates it to `url` (opening a new one when navigate rejects),
 * or opens a window when none of the origin exists. A cross-origin window is never touched.
 */
export async function focusOrOpen(
  clients: ClientsLike,
  url: string,
  origin: string,
): Promise<void> {
  const windows = (await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })) as readonly WindowClientLike[];
  const client = windows.find((w) => originOf(w.url) === origin);
  if (!client) {
    await clients.openWindow(url);
    return;
  }
  try {
    await client.focus();
    await client.navigate(url);
  } catch {
    await clients.openWindow(url);
  }
}

/** The part of `PushSubscription.toJSON()` the save needs. */
export type PushSubscriptionJsonLike = {
  endpoint?: string | null;
  keys?: Record<string, string> | null;
};

/**
 * The body of `POST /api/push/subscriptions`: `{ endpoint, keys: { p256dh, auth }, userAgent }`.
 * The API's `pushSubscriptionInputSchema` is `.strict()`, and a browser's `toJSON()` also carries
 * `expirationTime`, so the raw object would be refused; the user agent is cut to the schema's 512.
 */
export function subscriptionBody(
  json: PushSubscriptionJsonLike,
  userAgent: string,
): { endpoint: string; keys: { p256dh: string; auth: string }; userAgent: string } {
  return {
    endpoint: json.endpoint ?? '',
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    userAgent: userAgent.slice(0, 512),
  };
}
