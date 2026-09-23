'use server';

import { createPostSchema } from '@tria/module-feed/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createPost } from '@/lib/feed';
import {
  asCommunityIssue,
  asMediaIssue,
  attemptPostWrite,
  type PostWriteResult,
} from '@/lib/feed-write';

/**
 * The composer's own server action (FEED-01), in the three conventions every server action in this
 * app encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public
 *     endpoint and its argument is untrusted (T-04-38): `createPostSchema` is the identical schema
 *     the Hono route validates the body with, so the submit control's "publishable" rule and the
 *     API's refusal are literally one definition (FEED-01/empty). The API re-authorises and
 *     re-validates every asset id against the caller's own tenant anyway (T-04-56).
 *  2. **A refusal is a catalog KEY, never pt-BR copy** (T-04-42), so nothing server-controlled
 *     reaches the DOM and the message catalog stays the one source of copy.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** It throws in Next 16, and a catch would
 *     swallow the navigation — which is why `attemptPostWrite` returns the path instead of taking it.
 *
 * **No file byte ever passes through here.** The composer uploads straight to Storage with a
 * brokered signed URL (Phase 3), and this action carries asset IDS only — which is also why Cloud
 * Run's 32 MiB body cap is irrelevant to publishing a 400 MB video (T-04-59).
 *
 * **The edit action is NOT re-exported from here**, though it would read better if it were. A
 * `'use server'` module compiled by Turbopack replaces its own export list with the action
 * registry it builds, and a `export { x } from '…'` line is dropped on the way: the build fails
 * with "The module has no exports at all". So `ComposerForm` imports `updatePostAction` from
 * `inicio/feed-actions.ts` directly — the SAME function the card's overflow menu calls, which is
 * the property that actually mattered: the composer's save and the menu cannot drift apart.
 */
export async function createPostAction(input: unknown): Promise<PostWriteResult> {
  const body = createPostSchema.safeParse(input);
  if (!body.success) {
    const media = body.error.issues.map((issue) => asMediaIssue(issue.message)).find(Boolean);
    if (media) return { ok: false, code: media };
    // COMM-04: the destination's own closed vocabulary, lifted from the SAME issue list. It cannot
    // be raised by this parse today (`communityId` is a plain optional uuid), and it is read here
    // anyway so that the day the create schema learns a destination refinement, the composer has
    // its copy without a second edit in a second file.
    const community = body.error.issues
      .map((issue) => asCommunityIssue(issue.message))
      .find(Boolean);
    if (community) return { ok: false, code: community };
    const empty = body.error.issues.some((issue) => issue.message === 'empty_post');
    return { ok: false, code: empty ? 'empty_post' : 'generic' };
  }

  const { result, refusal } = await attemptPostWrite(() => createPost(body.data));
  // The new card has to appear on the server-rendered home slot the admin lands back on; without
  // this they would read a cached page 1 that does not carry what they just published.
  if (result.ok) {
    revalidatePath('/inicio');
    revalidatePath(`/post/${result.postId}`);
  }

  if (refusal) redirect(refusal);
  return result;
}
