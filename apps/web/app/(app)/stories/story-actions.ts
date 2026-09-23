'use server';

import { publishStorySchema } from '@tria/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { asStoryIssue, attemptStoryPublish, type StoryWriteResult } from '@/lib/stories';

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
