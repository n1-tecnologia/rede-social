'use server';

import type { TenantRole } from '@rede-social/contracts';
import {
  type AdminMember,
  adminMemberListQuerySchema,
  memberAccessBodySchema,
  memberRoleBodySchema,
} from '@rede-social/contracts/moderation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { MemberAccessOutcome } from '@/components/admin/MemberAdminSheet';
import { getAdminMembers, postMemberAccess, putMemberRole } from '@/lib/admin-members';
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
 * - every member action's failure goes through ONE mapping, `handleAdminRefusal` (UI-D-284): 409
 *   `details.member` is the refusal the sheet explains inline; 404 is `gone`; 403 `FORBIDDEN` is
 *   `forbidden`; the CALLER turns `gone` and `forbidden` into a toast, a closed sheet and a refresh
 *   (after which a demoted admin's screen answers `notFound()`); a 403 `MEMBERSHIP_BLOCKED` (or any
 *   session refusal) is the shipped bootstrap navigation;
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

/**
 * THE UI-D-284 mapping of a failed member action: either a navigation (a session or membership
 * refusal, e.g. 403 `MEMBERSHIP_BLOCKED` → "Acesso suspenso") the caller performs OUTSIDE its
 * try/catch, or the outcome the sheet and its host read. Anything unrecognised is `generic` and is
 * logged by shape only.
 */
function handleAdminRefusal(
  error: unknown,
  label: string,
): { navigate: string } | { outcome: MemberAccessOutcome } {
  if (error instanceof ApiClientError) {
    const path = bootstrapRedirectPath(error);
    if (path) return { navigate: path };
    if (error.status === 409) return { outcome: refusalOf(error.details) };
    if (error.status === 404) return { outcome: { ok: false, code: 'gone' } };
    if (error.status === 403 && error.code === 'FORBIDDEN') {
      return { outcome: { ok: false, code: 'forbidden' } };
    }
  }
  console.error(`admin.members.${label}_failed`, { error: String(error) });
  return { outcome: { ok: false, code: 'generic' } };
}

/** Runs one member action and maps its failure; `redirect()` throws, so it sits outside the catch. */
async function runMemberAction(
  label: string,
  call: () => Promise<AdminMember>,
): Promise<MemberAccessOutcome> {
  let mapped: { navigate: string } | { outcome: MemberAccessOutcome };
  try {
    mapped = { outcome: { ok: true, member: await call() } };
  } catch (error) {
    mapped = handleAdminRefusal(error, label);
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return mapped.outcome;
}

async function changeAccess(
  kind: 'block' | 'unblock',
  membershipId: string,
  reason: string | null,
): Promise<MemberAccessOutcome> {
  const id = membershipIdSchema.safeParse(membershipId);
  const body = memberAccessBodySchema.safeParse(reason === null ? {} : { reason });
  if (!id.success || !body.success) return { ok: false, code: 'generic' };
  return runMemberAction(kind, () => postMemberAccess(id.data, kind, body.data.reason));
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

/**
 * Changes one membership's role (ADMIN-02, D-332, 08-05). `role` is validated against the SAME
 * closed enum the API uses before any request; the guards (self, last admin, invited, blocked) are
 * the API's, and their refusals come back as the sheet's inline line.
 */
export async function changeMemberRoleAction(
  membershipId: string,
  role: TenantRole,
): Promise<MemberAccessOutcome> {
  const id = membershipIdSchema.safeParse(membershipId);
  const body = memberRoleBodySchema.safeParse({ role });
  if (!id.success || !body.success) return { ok: false, code: 'generic' };
  return runMemberAction('role', () => putMemberRole(id.data, body.data.role));
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
