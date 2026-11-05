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
