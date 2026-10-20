'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { deleteFollow, loadFollowState, putFollow } from '@/lib/social';

/**
 * The follow actions (09-10, FOLLOW-02, D-470), in the `plataforma/actions.ts` conventions: the id is
 * validated BEFORE the request, a session refusal (401, blocked...) becomes a navigation OUTSIDE the
 * try/catch (Next 16: `redirect()` throws), and every other refusal is the ONE `generic` code - never
 * the server's words (T-09-37, T-04-42): the client turns it into a fixed catalog sentence.
 *
 * Server actions are public POST endpoints, so nothing here trusts the caller beyond the id it names:
 * the API re-verifies the token, re-derives the tenant from it, and answers the bare 404 for a target
 * that is staff, blocked, unknown or another tenant's. `PUT` and `DELETE` are idempotent end to end,
 * so a double submit leaves one row or none and never shows a conflict (T-09-28).
 */

export type FollowActionResult =
  | { ok: true; following: boolean; followerCount: number }
  | { ok: false; code: 'generic' };

export type FollowStateActionResult =
  | { ok: true; following: Record<string, boolean> }
  | { ok: false; code: 'generic' };

const membershipIdSchema = z.uuid();
const membershipIdsSchema = z.array(z.uuid()).min(1).max(50);

async function run(
  membershipId: string,
  write: (id: string) => ReturnType<typeof putFollow>,
): Promise<FollowActionResult> {
  const id = membershipIdSchema.safeParse(membershipId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: FollowActionResult = { ok: false, code: 'generic' };
  try {
    const answer = await write(id.data);
    result = { ok: true, following: answer.following, followerCount: answer.followerCount };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('social.follow_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/** `PUT`: follow. Answers the state after the call and the target's new follower count. */
export async function followAction(membershipId: string): Promise<FollowActionResult> {
  return run(membershipId, putFollow);
}

/** `DELETE`: unfollow. A repeat answers `following: false` as well. */
export async function unfollowAction(membershipId: string): Promise<FollowActionResult> {
  return run(membershipId, deleteFollow);
}

/** The batch state of a page of rows (one call): used by the directory's load-more. */
export async function followStateAction(membershipIds: string[]): Promise<FollowStateActionResult> {
  const ids = membershipIdsSchema.safeParse(membershipIds);
  if (!ids.success) return { ok: false, code: 'generic' };
  const state = await loadFollowState(ids.data);
  return state === null ? { ok: false, code: 'generic' } : { ok: true, following: state };
}
