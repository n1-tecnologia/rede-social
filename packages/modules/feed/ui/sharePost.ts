/**
 * FEED-07's share branch table. RED stub — the signature and the result union only; the branches
 * land in the GREEN commit.
 */

export type SharePostResult = 'shared' | 'dismissed' | 'copied' | 'failed';

export type SharePostPayload = { url: string; title: string };

export type SharePostSurfaces = {
  share?: (data: SharePostPayload) => Promise<void>;
  clipboard?: (text: string) => Promise<void>;
};

export async function sharePost(
  _payload: SharePostPayload,
  _surfaces: SharePostSurfaces,
): Promise<SharePostResult> {
  return 'failed';
}
