/**
 * Rule (a) of the service worker (`app/sw.ts`), as a pure predicate (the `push-sw.ts` precedent: every
 * decision of the worker lives in a tested lib).
 *
 * Rule (a) sends to the network, and stores nothing of: every navigation or document, every React Server
 * Component payload (`RSC` header), every server action (`Next-Action` header) and every same-origin
 * `/auth/*`, `/v1/*`, `/api/*`, `/m/*` and `/serwist/*` request (T-02-70).
 *
 * 12.5 (D-871, VOICE-22): an `<audio>` or `<video>` request is the ONE exception to the prefix clause. Safari
 * plays and seeks a recording with Range requests that a worker answering through `NetworkOnly` (a plain
 * `fetch`, no Range handling) can break; with no rule matching, the browser's own networking serves it
 * straight from the redirect target of `/v1/media/...`. No media is ever precached (T-12.5-46). A request
 * from an `<img>` (`destination: 'image'`) to the same path is unchanged: still network only.
 */
export const NETWORK_ONLY_PREFIXES = ['/auth/', '/v1/', '/api/', '/m/', '/serwist/'] as const;

/** The part of Serwist's matcher context the decision reads. */
export interface NetworkOnlyContext {
  request: {
    mode: string;
    destination: string;
    headers: { get(name: string): string | null; has(name: string): boolean };
  };
  url: { pathname: string };
  sameOrigin: boolean;
}

export function isNetworkOnlyRequest({ request, url, sameOrigin }: NetworkOnlyContext): boolean {
  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    request.headers.get('RSC') === '1' ||
    request.headers.has('Next-Action')
  ) {
    return true;
  }
  if (!sameOrigin) return false;
  if (request.destination === 'audio' || request.destination === 'video') return false;
  return NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}
