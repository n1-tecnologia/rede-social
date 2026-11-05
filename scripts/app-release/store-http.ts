/**
 * What both store clients share (13-29): a closed error type, the origin guard and one JSON request helper.
 * Nothing here logs, and no error message carries a response body, a header or a token: a store answer can echo
 * what was sent, so only the status class survives (T-13-50).
 */

export type StoreErrorCode =
  | 'store_auth_failed'
  | 'store_not_found'
  | 'store_conflict'
  | 'store_rate_limited'
  | 'store_rejected'
  | 'store_unavailable'
  | 'store_bad_answer';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly status: number | null;
  constructor(code: StoreErrorCode, status: number | null = null) {
    super(code);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
  }
}

export function codeForStatus(status: number): StoreErrorCode {
  if (status === 401 || status === 403) return 'store_auth_failed';
  if (status === 404) return 'store_not_found';
  if (status === 409) return 'store_conflict';
  if (status === 429) return 'store_rate_limited';
  if (status >= 500) return 'store_unavailable';
  return 'store_rejected';
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * A store origin is https, or plain http on a loopback address (the fake servers). Anything else is refused
 * before a credential is attached to a request.
 */
export function assertOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new StoreError('store_rejected');
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new StoreError('store_rejected');
  }
  return url.origin;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type JsonAnswer = { status: number; json: unknown };

/** One request, answer parsed as JSON when there is a body. A network failure is `store_unavailable`. */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
): Promise<JsonAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body as RequestInit['body'] }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new StoreError('store_unavailable');
  }
  const text = await response.text().catch(() => '');
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
