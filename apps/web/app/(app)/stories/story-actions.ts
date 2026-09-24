'use server';

import { publishStorySchema } from '@tria/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import {
  asStoryIssue,
  attemptStoryPublish,
  likeStory,
  type StoryWriteResult,
  unlikeStory,
} from '@/lib/stories';

/**
 * The publish screen's own server action (STORY-01), in the three conventions every server action in
 * this app encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public
 *     endpoint and its argument is untrusted (T-05-25): `publishStorySchema` is the identical schema
 *     the Hono route validates the body with, so the screen's "publishable" rule and the API's
 *     refusal are literally one definition. The API re-authorises and re-validates the asset id
 *     against the caller's own tenant anyway (T-05-26).
 *  2. **A refusal is a catalog KEY, never pt-BR copy**, so nothing server-controlled reaches the DOM
 *     and the message catalog stays the one source of copy.
 *  3. **`redirect()` is called OUTSIDE the try/catch.** It throws in Next 16, and a catch would
 *     swallow the navigation — which is why `attemptStoryPublish` returns the path instead of taking
 *     it.
 *
 * **No file byte ever passes through here.** The composer uploads straight to Storage (or to the
 * streaming vendor) with a brokered signed target (Phase 3), and this action carries an asset ID
 * only — which is also why Cloud Run's 32 MiB body cap is irrelevant to publishing a 400 MB video.
 */
export async function publishStoryAction(input: unknown): Promise<StoryWriteResult> {
  const body = publishStorySchema.safeParse(input);
  if (!body.success) {
    const story = body.error.issues.map((issue) => asStoryIssue(issue.message)).find(Boolean);
    return { ok: false, code: story ?? 'generic' };
  }

  const { result, refusal } = await attemptStoryPublish(body.data);
  // The new circle has to appear on the server-rendered home slot the admin lands back on; without
  // this they would read a cached page 1 that does not carry what they just published.
  if (result.ok) revalidatePath('/inicio');

  if (refusal) redirect(refusal);
  return result;
}

/**
 * STORY-05's toggle, in the `likePostAction` shape it is a copy of.
 *
 * **It deliberately does NOT revalidate.** The authoritative `{ liked, likeCount }` comes back in
 * the response and `useOptimisticLike` writes it straight into the button that asked; a
 * `revalidatePath('/inicio')` would additionally re-render the whole home screen — and the strip
 * above it — on every tap of a heart, which is both wasteful and visible.
 *
 * A 401/403 becomes a NAVIGATION, outside the try/catch: `redirect()` throws in Next 16 and a catch
 * would swallow it. Everything else is the generic code, which the viewer turns into the shared
 * error toast with no inline message (UI-SPEC §Like).
 */
export type StoryLikeActionResult =
  | { ok: true; liked: boolean; likeCount: number }
  | { ok: false; code: 'generic' };

async function toggleStoryLikeAction(
  storyId: string,
  run: (id: string) => Promise<{ liked: boolean; likeCount: number }>,
): Promise<StoryLikeActionResult> {
  // A server action is a public endpoint and its argument is untrusted (T-05-33): an id that is not
  // a uuid is refused here and never reaches the API, which re-authorises independently anyway.
  const id = z.uuid().safeParse(storyId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: StoryLikeActionResult = { ok: false, code: 'generic' };
  try {
    const outcome = await run(id.data);
    result = { ok: true, liked: outcome.liked, likeCount: outcome.likeCount };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    // Shape only: no caption and no member, so a refusal cannot leak story content into a log.
    if (!refusal) console.error('stories.like_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export async function likeStoryAction(storyId: string): Promise<StoryLikeActionResult> {
  return toggleStoryLikeAction(storyId, likeStory);
}

export async function unlikeStoryAction(storyId: string): Promise<StoryLikeActionResult> {
  return toggleStoryLikeAction(storyId, unlikeStory);
}
