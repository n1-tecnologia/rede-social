'use server';

import {
  type AdminMember,
  adminMemberListQuerySchema,
  memberAccessBodySchema,
} from '@rede-social/contracts/moderation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { MemberAccessOutcome } from '@/components/admin/MemberAdminSheet';
import { getAdminMembers, postMemberAccess } from '@/lib/admin-members';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The Membros screen's server actions (ADMIN-02, MODER-02, UI-D-271..274, UI-D-284), in the
 * `moderacao/actions.ts` conventions:
 *
 * - the SAME Zod the API validates with runs BEFORE the request — a server action is a public
 *   endpoint, so a malformed membership id, an over-long reason or an unknown filter is refused here
 *   and never reaches the API;
 * - session and membership refusals become a navigation OUTSIDE the try/catch (Next 16: `redirect()`
 *   throws) — an admin blocked in another tab lands on the shipped "Acesso suspenso" flow;
 * - 409 `details.member` maps to the refusal the sheet explains inline; 404 is `gone` and 403
 *   `FORBIDDEN` is `forbidden`, which the CALLER turns into a toast and a refresh (UI-D-284);
 * - logs carry the shape only: a reason or a search term never reaches a log line (D-331).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const membershipIdSchema = z.uuid();

/** A refusal key the sheet knows, or `generic` for anything the API might add later. */
function refusalOf(details: Record<string, unknown> | undefined): MemberAccessOutcome {
  const member = details?.member;
  if (member === 'self' || member === 'last_admin' || member === 'not_active') {
    return { ok: false, code: member };
  }
  // `blocked` (a role change, 08-05) and any value the API adds later read as the generic line.
  return { ok: false, code: 'generic' };
}

async function changeAccess(
  kind: 'block' | 'unblock',
  membershipId: string,
  reason: string | null,
): Promise<MemberAccessOutcome> {
  const id = membershipIdSchema.safeParse(membershipId);
  const body = memberAccessBodySchema.safeParse(reason === null ? {} : { reason });
  if (!id.success || !body.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: MemberAccessOutcome = { ok: false, code: 'generic' };
  try {
    const member = await postMemberAccess(id.data, kind, body.data.reason);
    result = { ok: true, member };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal) {
        if (error.status === 409) result = refusalOf(error.details);
        else if (error.status === 404) result = { ok: false, code: 'gone' };
        else if (error.status === 403 && error.code === 'FORBIDDEN') {
          result = { ok: false, code: 'forbidden' };
        }
      }
    }
    if (!refusal && result.ok === false && result.code === 'generic') {
      console.error(`admin.members.${kind}_failed`, { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** Blocks one membership of the caller's tenant, with the optional INTERNAL reason (D-331). */
export async function blockMemberAction(
  membershipId: string,
  reason: string | null,
): Promise<MemberAccessOutcome> {
  return changeAccess('block', membershipId, reason);
}

/** Unblocks one membership of the caller's tenant, with the optional internal reason. */
export async function unblockMemberAction(
  membershipId: string,
  reason: string | null,
): Promise<MemberAccessOutcome> {
  return changeAccess('unblock', membershipId, reason);
}

export type AdminMembersPageResult =
  | { ok: true; items: AdminMember[]; nextCursor: string | null }
  | { ok: false; code: 'generic' | 'forbidden' };

/**
 * One keyset page of the Membros list for the URL's `q` and `status`. `cursor` null asks for page 1
 * (what a pull-to-refresh calls); otherwise it is OPAQUE and forwarded untouched.
 */
export async function loadMoreAdminMembersAction(
  cursor: string | null,
  q: string | null,
  status: string | null,
): Promise<AdminMembersPageResult> {
  if (cursor !== null && typeof cursor !== 'string') return { ok: false, code: 'generic' };
  const query = adminMemberListQuerySchema.safeParse({
    ...(cursor === null ? {} : { cursor }),
    ...(q === null || q === '' ? {} : { q }),
    ...(status === null ? {} : { status }),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: AdminMembersPageResult = { ok: false, code: 'generic' };
  try {
    const page = await getAdminMembers({
      cursor: query.data.cursor,
      q: query.data.q,
      status: query.data.status,
    });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 403 && error.code === 'FORBIDDEN') {
        result = { ok: false, code: 'forbidden' };
      }
    }
    if (!refusal && result.ok === false && result.code === 'generic') {
      console.error('admin.members.load_more_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}
