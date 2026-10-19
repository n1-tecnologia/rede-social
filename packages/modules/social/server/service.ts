import type { RequestContext } from '@rede-social/core/server/auth/context';
import type { FollowResult } from '../contracts/index';

// 09-02 RED stub: deliberately inert, fully replaced in the GREEN commit.
export async function followMember(
  _ctx: RequestContext,
  _membershipId: string,
): Promise<FollowResult> {
  throw new Error('not implemented');
}

export async function unfollowMember(
  _ctx: RequestContext,
  _membershipId: string,
): Promise<FollowResult> {
  throw new Error('not implemented');
}
