import { z } from 'zod';
import { hexColorSchema } from './branding';
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
 * labels reversed (`comunidade.cliente.com.br` -> `br.com.cliente.comunidade`). The two ids are the SAME
 * string whenever the host has no hyphen. A hyphen stays a hyphen for iOS (Apple's bundle ids allow
 * alphanumerics, hyphens and periods, never an underscore) and becomes `_` for Android
 * (`xn--exmplo-gva` -> `xn__exmplo_gva`, whose rules allow no hyphen). A label starting with a digit gets
 * the prefix `x` on both.
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
  const ios: string[] = [];
  const android: string[] = [];
  for (const label of labels.reverse()) {
    if (label.length === 0 || label.startsWith('-')) return null;
    // A digit cannot start a segment on either store.
    const lead = /^[0-9]/.test(label) ? 'x' : '';
    // Apple allows hyphens but NOT underscores in a bundle id; Android allows underscores but NOT hyphens.
    ios.push(`${lead}${label}`);
    android.push(`${lead}${label.replace(/-/g, '_')}`);
  }
  const ids = { ios: ios.join('.'), android: android.join('.') };
  if (!isValidBundleId(ids.ios) || !isValidApplicationId(ids.android)) return null;
  return ids;
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

// --- Store listing cuts (D-607, UI-D-602, UI-D-621) ----------------------------------------------------

export const STORE_NAME_MAX = 30;
export const ICON_LABEL_MAX = 12;

export type CutName = {
  /** The name after the cut. */
  name: string;
  /** Whether anything was removed. */
  cut: boolean;
  /** Length of the original (trimmed) text, in Unicode code points. */
  length: number;
};

const isSpace = (character: string | undefined): boolean =>
  character !== undefined && /\s/u.test(character);

/**
 * Cuts `text` to `max` Unicode code points (an emoji or an accented letter is one character and a
 * surrogate pair is never split), on the last whitespace boundary at or before the limit; a first word
 * longer than the limit is cut hard.
 */
function cutOnWordBoundary(text: string, max: number): CutName {
  const characters = Array.from(text.trim());
  const length = characters.length;
  if (length <= max) return { name: characters.join(''), cut: false, length };
  const head = characters.slice(0, max);
  let end = max;
  if (!isSpace(characters[max])) {
    const lastSpace = head.findLastIndex((character) => isSpace(character));
    if (lastSpace > 0) end = lastSpace;
  }
  return { name: characters.slice(0, end).join('').trim(), cut: true, length };
}

/** The store name: the tenant's display name, at most 30 characters. */
export const deriveStoreName = (displayName: string): CutName =>
  cutOnWordBoundary(typeof displayName === 'string' ? displayName : '', STORE_NAME_MAX);

/**
 * The icon label under the app icon: the manifest `short_name` (or, when it has none, the display name),
 * at most 12 characters. With one argument it is the already-chosen `shortName ?? displayName`.
 */
export const deriveIconLabel = (
  shortName: string | null | undefined,
  displayName?: string,
): CutName => {
  const chosen = typeof shortName === 'string' && shortName.trim() !== '' ? shortName : displayName;
  return cutOnWordBoundary(chosen ?? '', ICON_LABEL_MAX);
};

// --- Links, state and the checklist (UI-D-620, UI-D-624, UI-D-627) -------------------------------------

export type LinkVerdict = 'live' | 'missing_team' | 'missing_fingerprint' | 'no_host';

/** Apple Team ID: exactly 10 letters or digits. */
export const isValidTeamId = (raw: string): boolean =>
  typeof raw === 'string' && /^[A-Za-z0-9]{10}$/.test(raw);

/**
 * Android signing fingerprint: accepted with or without colons, in any case, saved as 32 upper-case hex
 * pairs separated by colons. `null` when it is not exactly 64 hex characters.
 */
export function normalizeFingerprint(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const bare = raw.replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(bare)) return null;
  return bare.match(/.{2}/g)?.join(':') ?? null;
}

/**
 * Whether the `.well-known` file for one platform can be served with data (UI-D-624). Each platform is
 * judged on its own: a missing Team ID never changes the Android verdict.
 */
export function linkVerdict(
  platform: NativePlatform,
  data: { hasVerifiedPrimaryHost: boolean; teamId: string | null; fingerprint: string | null },
): LinkVerdict {
  if (!data.hasVerifiedPrimaryHost) return 'no_host';
  if (platform === 'ios') {
    return data.teamId !== null && isValidTeamId(data.teamId) ? 'live' : 'missing_team';
  }
  return data.fingerprint !== null && normalizeFingerprint(data.fingerprint) !== null
    ? 'live'
    : 'missing_fingerprint';
}

/** The five rows read from what is held (UI-D-627), then the five the operator ticks, in display order. */
export const APP_CHECKLIST_AUTO_KEYS = [
  'storeKeys',
  'apnsKey',
  'links',
  'privacyUrl',
  'reviewer',
] as const;
export const APP_CHECKLIST_MANUAL_KEYS = [
  'appleAccount',
  'playAccount',
  'screenshots',
  'submitted',
  'published',
] as const;
export type AppChecklistAutoKey = (typeof APP_CHECKLIST_AUTO_KEYS)[number];
export type AppChecklistManualKey = (typeof APP_CHECKLIST_MANUAL_KEYS)[number];

export type AppStateInput = {
  held: { asc: boolean; play: boolean; apns: boolean };
  links: { ios: LinkVerdict; android: LinkVerdict };
  privacyUrl: boolean;
  reviewer: boolean;
  manual: Record<AppChecklistManualKey, boolean>;
};

/** The five rows read from what is held (UI-D-627); the App tab answer and `appState` share this one derivation. */
export const checklistAutoRows = (input: AppStateInput): Record<AppChecklistAutoKey, boolean> => ({
  storeKeys: input.held.asc && input.held.play,
  apnsKey: input.held.apns,
  links: input.links.ios === 'live' && input.links.android === 'live',
  privacyUrl: input.privacyUrl,
  reviewer: input.reviewer,
});

/** The "Passo a passo" count: how many of the ten rows are done. */
export function checklistCounts(input: AppStateInput): { done: number; total: 10 } {
  const auto = Object.values(checklistAutoRows(input)).filter(Boolean).length;
  const manual = APP_CHECKLIST_MANUAL_KEYS.filter((key) => input.manual[key]).length;
  return { done: auto + manual, total: 10 };
}

export type AppStateValue = 'none' | 'preparing' | 'ready' | 'published';

/**
 * The pill on the App tab (UI-D-620), a pure function like `databaseState`. Precedence: published wins
 * (even when the automatic rows are not all done), then ready (the five automatic rows done), then
 * preparing (anything held or done), else none.
 */
export function appState(input: AppStateInput): AppStateValue {
  if (input.manual.published) return 'published';
  const auto = checklistAutoRows(input);
  if (Object.values(auto).every(Boolean)) return 'ready';
  const anyHeld = input.held.asc || input.held.play || input.held.apns;
  const anyAuto =
    Object.values(auto).some(Boolean) ||
    input.links.ios === 'live' ||
    input.links.android === 'live';
  const anyManual = APP_CHECKLIST_MANUAL_KEYS.some((key) => input.manual[key]);
  return anyHeld || anyAuto || anyManual ? 'preparing' : 'none';
}

// --- Versions (UI-D-613) -------------------------------------------------------------------------------

const parseVersion = (raw: unknown): [number, number, number] | null => {
  if (typeof raw !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** Positive when `a` is newer, negative when older, 0 when equal, NaN when either side is malformed. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return Number.NaN;
  for (let i = 0; i < 3; i += 1) {
    const difference = (left[i] as number) - (right[i] as number);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** True only when `installed` is strictly older than `min`; a malformed side never blocks the member. */
export const isBelowMinVersion = (installed: string, min: string): boolean =>
  compareVersions(installed, min) < 0;

/**
 * Public read of the version floor per store. `storeUrl` is nullable because the update screen's link is
 * baked into the build; `0.0.0` means no floor.
 */
const storeVersionSchema = z.object({ minVersion: semver, storeUrl: httpsUrl.nullable() }).strict();
export const appVersionAnswerSchema = z
  .object({ ios: storeVersionSchema, android: storeVersionSchema })
  .strict();
export type AppVersionAnswer = z.infer<typeof appVersionAnswerSchema>;

// --- The build record (NATIVE-02) ----------------------------------------------------------------------

/** The display name an anonymised member keeps (plan 07 writes it in SQL; the web and tests read it here). */
export const REMOVED_MEMBER_NAME = 'Membro removido';

/**
 * `.tenant/build.json`: the record the release command writes and `apps/mobile/app.config.ts` reads.
 * The HOST is baked, not only the slug (D-611: links need the host; a changed host needs a new build).
 */
export const tenantBuildSchema = z
  .object({
    slug: z.string().min(1).max(63),
    host: z.string().min(1).max(253),
    hosts: z.array(z.string().min(1).max(253)).max(10),
    env: z.enum(['hml', 'prod']),
    storeName: z.string().min(1).max(STORE_NAME_MAX),
    shortName: z.string().min(1).max(ICON_LABEL_MAX),
    bundleId: z.string().refine(isValidBundleId, 'invalid bundle id'),
    applicationId: z.string().refine(isValidApplicationId, 'invalid application id'),
    version: semver,
    buildNumber: z.number().int().min(1),
    teamId: z.string().refine(isValidTeamId, 'invalid team id').nullable(),
    colors: z
      .object({
        primary: hexColorSchema,
        onPrimary: hexColorSchema,
        primaryDark: hexColorSchema,
        onPrimaryDark: hexColorSchema,
      })
      .strict(),
    logoUrl: httpsUrl.nullable(),
    strings: z
      .object({
        camera: z.string().max(200),
        photos: z.string().max(200),
        microphone: z.string().max(200),
        faceId: z.string().max(200),
      })
      .strict(),
    storeUrls: z.object({ ios: httpsUrl.nullable(), android: httpsUrl.nullable() }).strict(),
    // A relative path inside the workspace: no leading slash, no `..`.
    googleServicesFile: z
      .string()
      .max(255)
      .regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/)
      .nullable(),
  })
  .strict();
export type TenantBuild = z.infer<typeof tenantBuildSchema>;

// --- Store credentials (D-605, UI-D-623, UI-D-628) -----------------------------------------------------

/**
 * WRITE-ONLY bodies. They are sealed on arrival and never returned: the answers below hold NO field of a
 * secret kind (no key id, prefix, length or file name), only `{ ok: true }` after a save and `held` /
 * `heldAt` on a read. The format is checked before a held value is replaced (plan 08).
 */
export const APP_CREDENTIAL_KINDS = ['asc_key', 'play_service_account', 'apns_key'] as const;
export type AppCredentialKind = (typeof APP_CREDENTIAL_KINDS)[number];

const P8_MAX_LENGTH = 8192;
const SERVICE_ACCOUNT_MAX_LENGTH = 16384;
const keyId = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{10}$/);
const p8 = z.string().trim().min(1).max(P8_MAX_LENGTH);
/**
 * The Key ID read from the `.p8` FILE NAME (`AuthKey_ABCD123456.p8`) by the browser, when it could. Optional and
 * nullable; when present it must equal the typed Key ID or the save is refused (`CREDENTIAL_KEY_ID_MISMATCH`).
 * It is checked and dropped: nothing stores, logs or returns it (UI-D-628).
 */
const fileKeyId = z
  .string()
  .regex(/^[A-Z0-9]{10}$/)
  .nullable()
  .optional();

export const ascKeyBodySchema = z
  .object({
    issuerId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
    keyId,
    p8,
    fileKeyId,
  })
  .strict();
export const playServiceAccountBodySchema = z
  .object({ json: z.string().trim().min(1).max(SERVICE_ACCOUNT_MAX_LENGTH) })
  .strict();
export const apnsKeyBodySchema = z.object({ keyId, p8, fileKeyId }).strict();
export const credentialAnswerSchema = z.object({ ok: z.literal(true) }).strict();
export const appCredentialHeldSchema = z
  .object({ held: z.boolean(), heldAt: z.string().nullable() })
  .strict();

// --- The App tab of the platform panel (Phase 13-09, D-605, D-615, D-617, UI-D-620..UI-D-628) -----------

/**
 * Write bodies of `PUT /v1/platform/tenants/{id}/app/*`, all `.strict()`. The store ids are checked with the
 * SAME validators the build record uses, so a saved id is always one a build accepts.
 */
export const appIdsBodySchema = z
  .object({
    bundleId: z.string().refine(isValidBundleId, 'invalid bundle id'),
    applicationId: z.string().refine(isValidApplicationId, 'invalid application id'),
  })
  .strict();

/**
 * The Apple Team ID and the Android signing fingerprint, both nullable (`null` clears). The Team ID is
 * stored upper-case (the table's check), the fingerprint as 32 colon-separated upper-case hex pairs.
 */
export const appLinksBodySchema = z
  .object({
    teamId: z.string().trim().refine(isValidTeamId, 'invalid team id').nullable(),
    sha256: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

/** One store's purchase switch. `visible: true` shows the purchase in that store's app (D-617). */
export const purchaseBodySchema = z
  .object({ platform: z.enum(NATIVE_PLATFORMS), visible: z.boolean() })
  .strict();

/** The tenant's privacy-policy URL: https only, at most 2048 characters. */
export const privacyBodySchema = z
  .object({ url: z.string().trim().max(2048).pipe(httpsUrl) })
  .strict();

export const checklistBodySchema = z.object({ done: z.boolean() }).strict();

const appBuildSchema = z
  .object({ version: z.string(), buildNumber: z.number().int(), at: z.string() })
  .strict();

const appCutSchema = z.object({ name: z.string(), cut: z.boolean() }).strict();

/**
 * The App tab read (UI-SPEC "Platform App tab reads"). `.strict()` at every level and no field able to carry
 * a store credential: a held credential is `{ kind, held, heldAt }` and nothing else (no Key ID, issuer,
 * prefix, length, file name or hash, NATIVE-26, UI-D-628). `appState` and the checklist are derived on the
 * server from the same pure functions this file exports, so every screen shows one answer.
 *
 * `listing.description` and `listing.ageRating` are filled by the listing builders of plan 31; until then they
 * read `null` and the panel shows the standard text from its own template.
 */
export const appTabSchema = z
  .object({
    appState: z.enum(['none', 'preparing', 'ready', 'published']),
    identity: z
      .object({
        displayName: z.string(),
        shortName: appCutSchema,
        host: z.string().nullable(),
        bundleId: z.string().nullable(),
        applicationId: z.string().nullable(),
        idsLocked: z.boolean(),
        idsDefault: z.boolean(),
        lastBuild: z
          .object({ ios: appBuildSchema.nullable(), android: appBuildSchema.nullable() })
          .strict(),
      })
      .strict(),
    credentials: z
      .array(
        z
          .object({
            kind: z.enum(APP_CREDENTIAL_KINDS),
            held: z.boolean(),
            heldAt: z.string().nullable(),
          })
          .strict(),
      )
      .length(APP_CREDENTIAL_KINDS.length),
    links: z
      .object({
        teamId: z.string().nullable(),
        fingerprint: z.string().nullable(),
        verdict: z
          .object({
            ios: z.enum(['live', 'missing_team', 'missing_fingerprint', 'no_host']),
            android: z.enum(['live', 'missing_team', 'missing_fingerprint', 'no_host']),
          })
          .strict(),
      })
      .strict(),
    purchase: z.object({ ios: z.boolean(), android: z.boolean() }).strict(),
    listing: z
      .object({
        name: appCutSchema,
        description: z.string().nullable(),
        ageRating: z.string().nullable(),
        privacyUrl: z.string().nullable(),
        reviewerEmail: z.string().nullable(),
        reviewerHeld: z.boolean(),
      })
      .strict(),
    checklist: z
      .object({
        done: z.number().int().min(0).max(10),
        total: z.literal(10),
        auto: z
          .object(
            Object.fromEntries(APP_CHECKLIST_AUTO_KEYS.map((key) => [key, z.boolean()])) as Record<
              AppChecklistAutoKey,
              z.ZodBoolean
            >,
          )
          .strict(),
        manual: z
          .object(
            Object.fromEntries(
              APP_CHECKLIST_MANUAL_KEYS.map((key) => [key, z.boolean()]),
            ) as Record<AppChecklistManualKey, z.ZodBoolean>,
          )
          .strict(),
      })
      .strict(),
  })
  .strict();
export type AppTab = z.infer<typeof appTabSchema>;
