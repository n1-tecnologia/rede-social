import { z } from 'zod';
import { hostAppSchema, isRegistrableHost, normalizeHost } from './hosts';

/**
 * `@rede-social/contracts/native` — the shared vocabulary of the native app (Phase 13, D-600, D-603,
 * D-607, D-615, D-617; NATIVE-02, NATIVE-05, NATIVE-32).
 *
 * A SUBPATH, never re-exported from `src/index.ts`, for the `moderation` and `realtime` reason: the
 * package index re-exports the server-only `legal` module (`node:fs`), and the Metro bundler of
 * `apps/mobile` would pull it into the app. `apps/mobile` imports only the `./native` and `./hosts`
 * subpaths. It also imports no other workspace module, so every function here is pure over its
 * arguments and holds no module state.
 *
 * THE ADDITIVE RULE (D-603, T-13-06). Every field this phase adds to an EXISTING answer is
 * `.optional()` or `.default()`: an API older than the web, a web older than the API and an app already
 * in the stores must all keep parsing. Strictness stays only on request bodies and on the by-host
 * answer's keys that already existed.
 */

export { hostAppSchema };

/** The two store platforms a native build targets. */
export const NATIVE_PLATFORMS = ['ios', 'android'] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

/**
 * Header the web BFF forwards to the API with the store platform of the in-app marker, so the API can
 * read the right purchase switch. A hint for what to HIDE, never authority (any client can send it).
 */
export const NATIVE_PLATFORM_HEADER = 'x-rede-app-platform';

/** The in-app marker the shell appends to the web view's user agent: `RedeSocialApp/<x.y.z> (<platform>)`. */
export const NATIVE_UA_PATTERN = /\bRedeSocialApp\/(\d+\.\d+\.\d+) \((ios|android)\)/;

export const buildNativeUa = (version: string, platform: NativePlatform): string =>
  `RedeSocialApp/${version} (${platform})`;

export type NativeUa =
  | { native: true; platform: NativePlatform; version: string }
  | { native: false; platform: null; version: null };

/** An absent, empty or non-string user agent is the browser. */
export function parseNativeUa(ua: unknown): NativeUa {
  const match = typeof ua === 'string' ? NATIVE_UA_PATTERN.exec(ua) : null;
  if (!match) return { native: false, platform: null, version: null };
  return { native: true, platform: match[2] as NativePlatform, version: match[1] as string };
}

/**
 * D-617 / D-615: the ONE purchase-visibility rule. A browser always sees the purchase; the app sees it
 * only when its store's switch is an explicit `true`. An absent record, an unknown platform or a row
 * that does not exist reads `false` (fail closed), so the app never offers a purchase by accident.
 */
export function purchaseVisible(input: {
  native: boolean;
  platform: NativePlatform | null;
  switches: { ios?: boolean; android?: boolean } | null | undefined;
}): boolean {
  if (!input.native) return true;
  if (input.platform !== 'ios' && input.platform !== 'android') return false;
  return input.switches?.[input.platform] === true;
}

/** Longest id the by-host `app` block accepts. */
const APP_ID_MAX_LENGTH = 160;

/** iOS bundle id: at least two dot segments, each starting with a letter, then letters, digits or hyphens. */
export function isValidBundleId(value: string): boolean {
  if (typeof value !== 'string' || value.length > APP_ID_MAX_LENGTH) return false;
  const segments = value.split('.');
  return (
    segments.length >= 2 && segments.every((segment) => /^[A-Za-z][A-Za-z0-9-]*$/.test(segment))
  );
}

/** Android application id: at least two dot segments, each starting with a letter, then letters, digits or underscores. */
export function isValidApplicationId(value: string): boolean {
  if (typeof value !== 'string' || value.length > APP_ID_MAX_LENGTH) return false;
  const segments = value.split('.');
  return (
    segments.length >= 2 && segments.every((segment) => /^[A-Za-z][A-Za-z0-9_]*$/.test(segment))
  );
}

/**
 * NATIVE-02 (D-607, Pattern 6): the default ids of the two stores from the tenant's primary host, the
 * labels reversed (`comunidade.cliente.com.br` -> `br.com.cliente.comunidade`). The same string serves
 * both stores (the Android form, valid on both): a hyphen becomes `_` (`xn--exmplo-gva` ->
 * `xn__exmplo_gva`) and a label starting with a digit gets the prefix `x`.
 *
 * `null` for anything that is not a plain ASCII registrable host with at least two non-empty labels:
 * a non-string, an empty string, a single label (`localhost`), an empty label (`a..b`), an IPv4
 * literal, a non-ASCII host (the caller passes punycode) or a result no store would accept.
 */
export function deriveAppIds(
  host: string | null | undefined,
): { ios: string; android: string } | null {
  if (typeof host !== 'string') return null;
  // Non-ASCII is refused BEFORE normalising, so a lookalike never reaches the lower-casing.
  if (/[\u{80}-\u{10ffff}]/u.test(host)) return null;
  const normalized = normalizeHost(host);
  if (normalized === null || !isRegistrableHost(normalized)) return null;
  if (/^\d+(\.\d+){3}$/.test(normalized)) return null;
  const labels = normalized.split('.');
  if (labels.length < 2) return null;
  const segments: string[] = [];
  for (const label of labels.reverse()) {
    if (label.length === 0 || label.startsWith('-')) return null;
    const underscored = label.replace(/-/g, '_');
    segments.push(/^[0-9]/.test(underscored) ? `x${underscored}` : underscored);
  }
  const id = segments.join('.');
  if (!isValidApplicationId(id) || !isValidBundleId(id)) return null;
  return { ios: id, android: id };
}

// --- The bridge (D-600, NATIVE-05, T-13-05) ------------------------------------------------------------

/**
 * The bridge between the web pages and the native layer: ONE versioned vocabulary for both sides, every
 * member `.strict()` with `v: 1`, strings and counts bounded. An old app and a new web degrade by ignoring
 * an unknown `type` (`parseBridgeMessage` answers `unknown_type`, never throws); `minVersion` is the hard
 * floor. No member carries a token, a password or an e-mail address: the device token travels only in
 * the native-to-web `push.state` / `push.result` events, to the PAGE, which saves it through the BFF with
 * its own cookie (D-608); the shell never holds a session.
 */
export const BRIDGE_VERSION = 1;
/** Largest accepted message, in UTF-8 BYTES, checked before `JSON.parse`. */
export const BRIDGE_MAX_BYTES = 65536;
/** Most posts the offline snapshot of Início carries (Pattern 9). */
export const FEED_SNAPSHOT_MAX_POSTS = 20;

/**
 * A path the shell may open from a push payload: starts with one `/`, then no second `/` or `\` (which a
 * browser reads as another origin) and no backslash or whitespace anywhere. The SAME expression as the
 * notifications module; duplicated on purpose because `apps/mobile` must not import a module.
 */
export const PUSH_PATH = /^\/(?![/\\])[^\\\s]*$/;
/** APNs device token: hex, "don't make assumptions about device token size" (Apple), so 32..200. */
export const APNS_TOKEN_PATTERN = /^[0-9a-f]{32,200}$/i;
/** FCM registration token: URL-safe class, 100..4096 characters. */
export const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{100,4096}$/;

const URL_MAX_LENGTH = 2048;
/** An https URL (no `http:`, `javascript:` or `data:`), bounded. */
const httpsUrl = z.url({ protocol: /^https$/ }).max(URL_MAX_LENGTH);
const isoInstant = z.iso.datetime();
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

/** The last-seen first page of Início (Pattern 9): only what the member's own feed already shows. */
export const feedSnapshotPostSchema = z
  .object({
    id: z.uuid(),
    authorName: z.string().max(120),
    authorAvatarUrl: httpsUrl.nullable(),
    text: z.string().max(2000),
    media: z
      .object({ kind: z.enum(['image', 'video']), thumbUrl: httpsUrl })
      .strict()
      .nullable(),
    likeCount: z.number().int().min(0),
    commentCount: z.number().int().min(0),
    createdAt: isoInstant,
  })
  .strict();
export const feedSnapshotSchema = z
  .object({
    savedAt: isoInstant,
    posts: z.array(feedSnapshotPostSchema).max(FEED_SNAPSHOT_MAX_POSTS),
  })
  .strict();
export type FeedSnapshot = z.infer<typeof feedSnapshotSchema>;

const member = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ v: z.literal(BRIDGE_VERSION), type: z.literal(type), ...shape }).strict();

/** Web to native. */
export const bridgeWebMessageSchema = z.discriminatedUnion('type', [
  member('ready', {}),
  member('push.enable', {}),
  member('push.disable', {}),
  member('push.state.request', {}),
  member('badge.set', { count: z.number().int().min(0).max(99999) }),
  member('share', {
    url: httpsUrl,
    // An empty title reads as absent.
    title: z
      .string()
      .max(200)
      .transform((title) => (title === '' ? undefined : title))
      .optional(),
  }),
  member('lock.set', { enabled: z.boolean() }),
  member('lock.state.request', {}),
  member('snapshot.feed', feedSnapshotSchema.shape),
  member('logout.done', {}),
  member('settings.open', {}),
  member('theme.changed', { theme: z.enum(['light', 'dark']) }),
]);
export type BridgeWebMessage = z.infer<typeof bridgeWebMessageSchema>;

export const PUSH_PERMISSIONS = ['undetermined', 'granted', 'denied', 'unsupported'] as const;
export type PushPermission = (typeof PUSH_PERMISSIONS)[number];

const deviceShape = {
  platform: z.enum(NATIVE_PLATFORMS),
  environment: z.enum(['production', 'sandbox']),
  appVersion: semver,
};
/** The device the shell hands to the page; the token matches the pattern of its own kind. */
export const nativeDeviceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('apns'),
      token: z.string().regex(APNS_TOKEN_PATTERN),
      ...deviceShape,
    })
    .strict(),
  z
    .object({ kind: z.literal('fcm'), token: z.string().regex(FCM_TOKEN_PATTERN), ...deviceShape })
    .strict(),
]);
export type NativeDevice = z.infer<typeof nativeDeviceSchema>;

/** Native to web. */
export const bridgeNativeEventSchema = z.discriminatedUnion('type', [
  member('push.state', {
    permission: z.enum(PUSH_PERMISSIONS),
    registered: z.boolean(),
    device: nativeDeviceSchema.nullable(),
  }),
  member('push.result', {
    ok: z.boolean(),
    permission: z.enum(PUSH_PERMISSIONS),
    device: nativeDeviceSchema.nullable(),
  }),
  member('lock.state', { enabled: z.boolean(), available: z.boolean() }),
  member('lock.result', { ok: z.boolean(), enabled: z.boolean() }),
  member('resume', {}),
]);
export type BridgeNativeEvent = z.infer<typeof bridgeNativeEventSchema>;

export type BridgeParseFailure =
  | 'not_string'
  | 'too_large'
  | 'bad_json'
  | 'unknown_type'
  | 'bad_shape';
export type BridgeParseResult<M> =
  | { ok: true; message: M }
  | { ok: false; reason: BridgeParseFailure };

type UnionLike = { options?: ReadonlyArray<{ shape?: { type?: { value?: unknown } } }> };
const knownTypesCache = new WeakMap<object, Set<string>>();

/** The `type` literals a discriminated union knows, read once per schema. */
function knownTypes(schema: object): Set<string> {
  let known = knownTypesCache.get(schema);
  if (!known) {
    known = new Set<string>();
    for (const option of (schema as UnionLike).options ?? []) {
      const value = option.shape?.type?.value;
      if (typeof value === 'string') known.add(value);
    }
    knownTypesCache.set(schema, known);
  }
  return known;
}

/**
 * T-13-05: parse one raw bridge message. Never throws, never logs, never echoes the input in the reason.
 * The size cap is in UTF-8 bytes and is checked BEFORE `JSON.parse`; a leading BOM is refused; the `type`
 * is read first so a message from a newer version answers `unknown_type` (dropped quietly) and only a
 * known type with a bad body answers `bad_shape`. The origin and main-frame checks are the shell's.
 */
export function parseBridgeMessage<S extends z.ZodType = typeof bridgeWebMessageSchema>(
  raw: unknown,
  schema: S = bridgeWebMessageSchema as unknown as S,
): BridgeParseResult<z.infer<S>> {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string' };
  // UTF-8 bytes are never fewer than UTF-16 units, so a longer string is too large without encoding it.
  if (raw.length > BRIDGE_MAX_BYTES || new TextEncoder().encode(raw).length > BRIDGE_MAX_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  if (raw.startsWith('\uFEFF')) return { ok: false, reason: 'bad_json' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'bad_shape' };
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return { ok: false, reason: 'bad_shape' };
  if (!knownTypes(schema).has(type)) return { ok: false, reason: 'unknown_type' };
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, reason: 'bad_shape' };
}
