import { type SubscriptionStatus, subscriptionStatusSchema } from '@rede-social/contracts/payments';
import { apiFetch } from '@/lib/api';

/**
 * The member screens' only reader of the payment checkout link (09.1-15, D-497, UI-D-521, UI-D-532,
 * T-09.1-70). The link that sends a person to pay is the single phishing vector of this phase, so it
 * has exactly one road onto a screen: the API answers it per request (`GET /v1/me/subscription`, the one
 * route a CUT member can reach, or the public tenant record / join state for the notice), and
 * `safeCheckoutUrl` lets it through only when it is an `https:` URL with a host and no credentials.
 * Nothing here reads a query string, a cookie or a header.
 */

/** Longer than any real checkout link; an over-long value is refused rather than rendered. */
const MAX_URL_LENGTH = 2048;

/**
 * The link as the browser should receive it, or `null` when it must not be rendered. Only `https:` with
 * a host and without `user:pass@` survives; `http:`, `javascript:`, `data:`, a protocol-relative `//host`,
 * a relative path, an empty string and anything that is not a string all come back `null`.
 */
export function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

/**
 * `GET /v1/me/subscription` for the cut screen: `{ tenantName, checkoutUrl }`, or `null` on any non-OK
 * answer, malformed or extra-keyed body, or transport failure. It never throws: a failed read renders
 * the screen without "Regularizar" and with the "fale com a equipe" line (E08 error). Read per request;
 * `apiFetch` is `no-store`.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus | null> {
  try {
    const res = await apiFetch('/v1/me/subscription');
    if (!res.ok) return null;
    const parsed = subscriptionStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
