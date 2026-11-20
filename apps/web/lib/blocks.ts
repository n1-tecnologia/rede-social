import {
  type BlockedMember,
  type BlockListAnswer,
  blockListAnswerSchema,
} from '@rede-social/contracts/moderation';
import { avatarUrlFor } from '@rede-social/contracts/profiles';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';

/**
 * The member's blocked list (11-20, CHAT-07, D-723, UI-D-635), SERVER-ONLY: every call goes through `apiFetch` with
 * the session's Bearer and the tenant host. `GET /v1/blocks` lists only the CALLER's own blocks (nobody else, the
 * blocked member included, can read that a block exists), so nothing here is an authority.
 */

/** One blocked member, finished for the list row (UI-D-635). Serializable. */
export interface BlockedMemberView {
  /** The id the unblock is keyed by: the id the caller's own list returned (never another member's). */
  userId: string;
  /** The member's name, or `null` for a departed one (the screen words it "Membro removido"). */
  name: string | null;
  avatarUrl: string | null;
}

/** `GET /v1/blocks?cursor=`: one keyset page of 20, newest block first. Throws `ApiClientError` on a non-2xx. */
export async function fetchBlocks({
  cursor,
}: {
  cursor?: string | null;
} = {}): Promise<BlockListAnswer> {
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  const query = search.toString();
  const res = await apiFetch(`/v1/blocks${query === '' ? '' : `?${query}`}`);
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (typeof body?.error?.code === 'string') code = body.error.code;
    } catch {
      // A non-JSON body keeps the generic code.
    }
    throw new ApiClientError(res.status, code);
  }
  return blockListAnswerSchema.parse(await res.json());
}

/** One API row as the list row: a name that is plain text (T-11-16) and the avatar URL, nothing else. */
export function blockedMemberView(item: BlockedMember): BlockedMemberView {
  return {
    userId: item.userId,
    name: item.displayName,
    avatarUrl: avatarUrlFor(item.avatarAssetId),
  };
}
