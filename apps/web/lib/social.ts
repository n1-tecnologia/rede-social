import type {
  FollowResult,
  FollowState,
  MemberSocialProfile,
  SocialListPage,
} from '@rede-social/module-social/contracts';

/** RED stub (09-10 Task 1): replaced by the GREEN commit. */
export type SocialProfileResult =
  | { status: 'ok'; data: MemberSocialProfile }
  | { status: 'not-eligible' }
  | { status: 'error' };

const NOT_BUILT = new Error('not built');

export async function putFollow(_id: string): Promise<FollowResult> {
  throw NOT_BUILT;
}
export async function deleteFollow(_id: string): Promise<FollowResult> {
  throw NOT_BUILT;
}
export async function getFollowState(_ids: string[]): Promise<FollowState> {
  throw NOT_BUILT;
}
export async function getFollowers(_cursor?: string): Promise<SocialListPage> {
  throw NOT_BUILT;
}
export async function getFollowing(_cursor?: string): Promise<SocialListPage> {
  throw NOT_BUILT;
}
export async function getSocialProfile(_id: string): Promise<SocialProfileResult> {
  return { status: 'error' };
}
