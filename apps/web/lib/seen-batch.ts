import { markStoriesSeenSchema } from '@tria/module-stories/contracts';

/**
 * The seen write's two shared pieces (HIGHLIGHT-06; quick 260926-d8f, reviews WR-04 and WR-07).
 *
 * CLIENT-SAFE on purpose: `StoriesSurface` (a client component) imports `sendSeenBeacon`, so this
 * file depends on the stories contracts only — never on `@/lib/api`, `@/lib/stories` or anything
 * server-only.
 */

/** The same-origin route handler the page-hide flush posts to (`app/api/stories/views/route.ts`). */
export const SEEN_BEACON_PATH = '/api/stories/views';

/**
 * The ONE dedupe-then-cap rule for both public doors to the seen write — `markStoriesSeenAction`
 * and `POST /api/stories/views` — so they cannot drift apart on the cap (review WR-04, T-05.2-48).
 *
 * Not an array → null. The list is deduplicated first (first-seen order kept), THEN checked against
 * the contract's own `markStoriesSeenSchema` (1..STORY_SEEN_BATCH_MAX uuids): a list of more unique
 * ids than the cap is REFUSED, never chunked — the surface flushes at 10, so a bigger list is not a
 * real client and must not amplify one call into many API calls.
 */
export function parseSeenBatch(storyIds: unknown): string[] | null {
  if (!Array.isArray(storyIds)) return null;
  const deduped = [...new Set<unknown>(storyIds)];
  const parsed = markStoriesSeenSchema.safeParse({ storyIds: deduped });
  return parsed.success ? parsed.data.storyIds : null;
}

/** A CORS-safelisted content type: no browser refuses a beacon (or preflights a fetch) for it. */
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';

/**
 * The page-hide flush (review WR-07). A server action is a plain `fetch` the browser may abort when
 * the page is unloaded, so the LAST batch of a viewing session — the one `visibilitychange → hidden`
 * sends — leaves through `navigator.sendBeacon`, which the browser delivers after the page is gone,
 * to the same-origin route that forwards it with the session cookie. When the beacon is missing,
 * refuses the payload or throws, `fetch` with `keepalive` is the fallback (it also outlives the
 * page). Every in-page flush (close, group change, the 10-id threshold, unmount) stays on
 * `markStoriesSeenAction`.
 *
 * Resolves whether the batch was handed over; never throws (the caller logs a false by shape).
 */
export async function sendSeenBeacon(ids: readonly string[]): Promise<boolean> {
  const body = JSON.stringify({ storyIds: ids });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const queued = navigator.sendBeacon(
        SEEN_BEACON_PATH,
        new Blob([body], { type: BEACON_CONTENT_TYPE }),
      );
      if (queued) return true;
    }
  } catch {
    // A beacon that throws (a detached navigator, a hostile polyfill) falls through to fetch.
  }
  try {
    const res = await fetch(SEEN_BEACON_PATH, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'content-type': BEACON_CONTENT_TYPE },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}
