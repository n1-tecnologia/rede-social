/**
 * The destination a gated member was headed for, as a path this app may navigate to (12-11, D-583,
 * PFORM-15, T-12-27).
 *
 * **Where the value comes from.** `proxy.ts` sets the `x-rede-path` request header from each request's
 * own pathname and search (any inbound copy is deleted first); `requireBootstrap()` reads it at the
 * start of every call (not only when the member owes an answer), keeps the validated value for the
 * request's data-loader refusals and sends a member who still owes a required answer to
 * `/completar-perfil?next=<this path>`; the
 * completion page and its action validate the `next` again before using it (plan 12). The value is
 * validated where it is USED, never echoed into a URL or the DOM unchecked, and a rejected value is
 * dropped silently: the member lands on `/inicio` (or `/perfil` in edit mode).
 *
 * **The open-redirect rule** (generalised from `continue-path.ts`): the value must be a path on THIS
 * origin. One leading slash, no second slash or backslash (`//evil.com` and `/\evil.com` are both
 * protocol-relative URLs in a browser), no scheme, no control character, at most 500 characters.
 * The rule runs on the raw value AND on the value after exactly ONE `decodeURIComponent` (so
 * `/%2F%2Fevil.com`, `/%5Cevil.com`, `/%0d%0aX` and `/%09/evil` are refused); a failed decode is a
 * rejection and the result is never decoded a second time (`%252F` stays `%2F`). Full-width and other
 * look-alike slashes are refused as well. A value that passes is returned as it came in (still
 * encoded), so it goes through `encodeURIComponent` once and validates again unchanged.
 *
 * **Exclusions.** The form itself (`/completar-perfil`, any sub-path or query) and every `(auth)` public
 * route: sending a member back to the screen they came from, or to a sign-in screen, would loop.
 */
export const REQUEST_PATH_HEADER = 'x-rede-path';

/** The longest destination accepted, in characters. */
export const NEXT_PATH_MAX_LENGTH = 500;

/** The form's own path: never a valid destination (RESEARCH Pitfall 2). */
export const PROFILE_FORM_PATH = '/completar-perfil';

/**
 * The public `(auth)` route folders plus the `auth/*` route handlers. Pinned by a test that reads the
 * folders under `app/(auth)` and `app/auth`, so a new public route that is not listed here fails CI.
 */
export const AUTH_PATH_PREFIXES: readonly string[] = [
  '/aceitar-convite',
  '/acesso-suspenso',
  '/assinatura-pendente',
  '/auth',
  '/cadastro',
  '/comunidade-em-atualizacao',
  '/comunidade-em-preparacao',
  '/comunidade-indisponivel',
  '/convite-expirado',
  '/endereco-invalido',
  '/entrar',
  '/escolher-comunidade',
  '/esqueci-senha',
  '/participar',
  '/privacidade',
  '/redefinir-senha',
  '/sem-comunidade',
  '/termos',
  '/verifique-seu-email',
];

/** Slash and backslash look-alikes that a path must not contain (full-width, division, fraction, ...). */
const LOOKALIKES = /[⁄∕∖⧵⧸⧹／＼﹨]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a header-splitting byte is exactly what must be refused here.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The same-origin relative path shape, applied to the raw value and to its one decode. */
function hasSafeShape(value: string): boolean {
  if (value.length === 0 || value.length > NEXT_PATH_MAX_LENGTH) return false;
  if (CONTROL.test(value) || LOOKALIKES.test(value)) return false;
  if (!value.startsWith('/')) return false;
  // `//host` and `/\host` are protocol-relative URLs, not paths; no backslash is allowed anywhere.
  if (value.startsWith('//') || value.includes('\\')) return false;
  return true;
}

function pathOnly(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isExcluded(value: string): boolean {
  const path = pathOnly(value);
  if (isUnder(path, PROFILE_FORM_PATH)) return true;
  return AUTH_PATH_PREFIXES.some((prefix) => isUnder(path, prefix));
}

/**
 * The value as a path this app may navigate to, or `null`. Total and idempotent: it never throws, and
 * validating its own output again gives the same result. A missing, blank or whitespace-only value is
 * `null` and never an error.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (!hasSafeShape(raw)) return null;

  // Exactly ONE decode; the result must pass the same rules, and is never decoded again.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!hasSafeShape(decoded)) return null;

  if (isExcluded(raw) || isExcluded(decoded)) return null;
  return raw;
}
