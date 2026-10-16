import { memberProfileSchema } from '@rede-social/contracts/profiles';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { type InstagramByMember, splitProfileBio } from '@/lib/profile-instagram';

/**
 * 2026-10-09 — the Instagram handle under each author's name on a post card and on a Reel. The
 * feed's author payload carries no bio (`FeedPost.author` is the photo and the name), and the handle
 * lives INSIDE the bio (`lib/profile-instagram.ts`), so the server reads each DISTINCT author's
 * public profile, `GET /v1/members/{membershipId}`: the same strict payload `/membros/[id]` renders
 * (D-45), readable by every member of the tenant and, for staff, by direct link (D-47).
 *
 * **Best effort by construction.** The line is a decoration on someone else's card, so a lookup
 * never throws and never redirects: a miss, a refusal, a timeout (`LOOKUP_TIMEOUT_MS`) or a body that
 * does not parse is simply "no handle", and the card renders without the line. `loadMemberProfile`
 * is NOT reused on purpose: its 401/403 navigation belongs to a screen, and the read that renders the
 * page already owns that answer. A failure logs its status or its error name, never the bio.
 *
 * `instagramOf` is React `cache`d per request, so the author of ten posts, the post page and its Reel
 * cost ONE read per render; `loadAuthorInstagrams` also dedupes the page's authors itself, which is
 * what holds in a server action, outside the render.
 */

/** How long one author's profile may take before the card goes without the line. */
const LOOKUP_TIMEOUT_MS = 1500;

/** What a lookup reads from a post: who wrote it. */
type Authored = { author: { membershipId: string } };

function lookupFailed(detail: Record<string, unknown>): void {
  console.error('feed.author_instagram_failed', detail);
}

/** One author's handle, or `null`: none, or the profile could not be read. Never throws. */
export const instagramOf = cache(async (membershipId: string): Promise<string | null> => {
  try {
    const res = await apiFetch(`/v1/members/${encodeURIComponent(membershipId)}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A bare 404 is an author who left or was blocked: no line, and nothing worth a log line.
      if (res.status !== 404) lookupFailed({ status: res.status });
      return null;
    }
    const profile = memberProfileSchema.safeParse(await res.json());
    if (!profile.success) {
      lookupFailed({ status: res.status, reason: 'invalid_body' });
      return null;
    }
    return splitProfileBio(profile.data.bio).instagram;
  } catch (error) {
    lookupFailed({ name: error instanceof Error ? error.name : typeof error });
    return null;
  }
});

/** The handles of the authors of `posts`, by `membershipId`: one lookup per author, in parallel. */
export async function loadAuthorInstagrams(posts: readonly Authored[]): Promise<InstagramByMember> {
  const ids = [...new Set(posts.map((post) => post.author.membershipId))];
  const handles = await Promise.all(ids.map((id) => instagramOf(id)));
  const instagrams = new Map<string, string>();
  for (const [index, id] of ids.entries()) {
    const handle = handles[index];
    if (handle) instagrams.set(id, handle);
  }
  return instagrams;
}

/**
 * A feed page with its authors' handles, for a `.then` straight after the page's own read
 * (`loadFeed().then(withAuthorInstagrams)`), so the lookups start the moment the page is in and the
 * caller's other reads keep running beside them. A `null` page (a failed read) has no authors.
 */
export async function withAuthorInstagrams<Page extends { items: readonly Authored[] } | null>(
  page: Page,
): Promise<{ page: Page; instagrams: InstagramByMember }> {
  return { page, instagrams: await loadAuthorInstagrams(page?.items ?? []) };
}
