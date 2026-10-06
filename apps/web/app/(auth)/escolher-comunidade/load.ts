import { type Community, communitiesSchema } from '@rede-social/contracts/join';
import { apiFetch } from '@/lib/api';

/**
 * `GET /v1/join/communities` for the picker page AND its action (08.1-03, D-308): one reader, so the
 * list a person sees and the list `chooseCommunity` checks a submitted slug against are the same
 * answer. Not a server action (this file has no `'use server'`), so it is never callable from the
 * browser.
 *
 * - 401 -> `unauthenticated` (the session expired between proxy.ts and the API);
 * - 404 -> `not_found` (a tenant or the platform host, D-309 / D-21 — the page checks the host first,
 *   so this is the API's own refusal of the same thing);
 * - any other non-2xx throws: a real failure surfaces as a render error, never as an empty list.
 */
export type CommunitiesLoad =
  | { kind: 'list'; communities: Community[] }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found' };

export async function loadCommunities(): Promise<CommunitiesLoad> {
  const res = await apiFetch('/v1/join/communities');
  if (res.status === 401) return { kind: 'unauthenticated' };
  if (res.status === 404) return { kind: 'not_found' };
  if (!res.ok) throw new Error(`GET /v1/join/communities answered ${res.status}`);
  const { communities } = communitiesSchema.parse(await res.json());
  return { kind: 'list', communities };
}
