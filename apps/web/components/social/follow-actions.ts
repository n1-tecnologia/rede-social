'use server';

/** RED stub (09-10 Task 1): replaced by the GREEN commit. */
export type FollowActionResult =
  | { ok: true; following: boolean; followerCount: number }
  | { ok: false; code: 'generic' };

export async function followAction(_membershipId: string): Promise<FollowActionResult> {
  return { ok: false, code: 'generic' };
}
export async function unfollowAction(_membershipId: string): Promise<FollowActionResult> {
  return { ok: false, code: 'generic' };
}
