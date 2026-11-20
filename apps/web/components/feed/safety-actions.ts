'use server';

import { blockChangeAnswerSchema, reportCreateBodySchema } from '@rede-social/contracts/moderation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { type BlockedMemberView, blockedMemberView, fetchBlocks } from '@/lib/blocks';

/**
 * The member's report and block actions (11-20, MODER-05, CHAT-07, D-616, D-722, D-724, D-733), SERVER ACTIONS:
 * every call goes through `apiFetch` with the session's Bearer and the tenant host, so the browser never talks to
 * the API and never holds a token. The API decides everything (the tenant is the membership of record, the
 * reporter and the author come from the session and the item, never from the body); nothing here is an
 * authority.
 *
 * The three conventions every server action in this app encodes:
 *
 *  1. **The SAME Zod the API validates with runs BEFORE the request.** A server action is a public endpoint and its
 *     argument is untrusted: a subject that is not one of the six, a reason outside the five or a note over 500
 *     characters is refused here and never reaches the API (which re-validates anyway).
 *  2. **The answer is a CLOSED code, never an API message** (T-11-03, T-11-16): the screens map a code to their
 *     own catalog sentence, so no server-controlled string reaches the DOM and nothing says why a refusal
 *     happened beyond what the code names.
 *  3. **No `redirect()`.** A missing session is the `unauthenticated` code, and the screen shows its failure
 *     state; the proxy's own gate is what sends an expired session to the login.
 */

/** The closed answers of `reportContent` (the API statuses 201, 409, 404, 429, no session and everything else). */
export type ReportCode =
  | 'ok'
  | 'already_reported'
  | 'unavailable'
  | 'rate_limited'
  | 'unauthenticated'
  | 'failed';
export type ReportActionResult = { ok: boolean; code: ReportCode };

/** The closed answers of the block writes (the API statuses 200, 400, 429, no session and everything else). */
export type BlockCode = 'ok' | 'rate_limited' | 'unauthenticated' | 'failed';
export type BlockActionResult = { ok: boolean; code: BlockCode; changed: boolean };

/**
 * `POST /v1/reports` (NATIVE-31). `input` is untrusted: it is parsed with the contract's own schema, whose
 * `.strict()` refuses any key the client has no business sending (a tenant, a reporter, an author). An empty or
 * whitespace-only note leaves the schema as `undefined`, so a report with no note is sent with the note omitted.
 */
export async function reportContent(input: unknown): Promise<ReportActionResult> {
  const body = reportCreateBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: 'failed' };

  let status: number;
  try {
    const res = await apiFetch('/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    status = res.status;
  } catch (error) {
    console.error('safety.report.network_failed', { error: String(error) });
    return { ok: false, code: 'failed' };
  }

  if (status === 201) return { ok: true, code: 'ok' };
  if (status === 409) return { ok: true, code: 'already_reported' };
  if (status === 404) return { ok: false, code: 'unavailable' };
  if (status === 429) return { ok: false, code: 'rate_limited' };
  if (status === 401) return { ok: false, code: 'unauthenticated' };
  return { ok: false, code: 'failed' };
}

/** The membership id of the person, a uuid (T-11-34: never a user id). Refused here before any request. */
const membershipIdSchema = z.uuid();

/**
 * One block or unblock write. `changed` is false for the idempotent repeat, which is the plain success: the
 * screen toasts once either way. The lists the blocked member's items sit in are revalidated on a real change so
 * they leave at once (D-725: the API's filter is what hides them; no other filter is added here).
 */
async function writeBlock(
  method: 'POST' | 'DELETE',
  path: string,
  revalidate: boolean,
): Promise<BlockActionResult> {
  let res: Response;
  try {
    res = await apiFetch(path, { method });
  } catch (error) {
    console.error('safety.block.network_failed', { error: String(error) });
    return { ok: false, code: 'failed', changed: false };
  }
  if (res.status === 429) return { ok: false, code: 'rate_limited', changed: false };
  if (res.status === 401) return { ok: false, code: 'unauthenticated', changed: false };
  // `CANNOT_BLOCK` (400) is the ONE refusal for every miss and is shown as the plain failure: it names no reason.
  if (!res.ok) return { ok: false, code: 'failed', changed: false };

  let changed = false;
  try {
    changed = blockChangeAnswerSchema.parse(await res.json()).changed;
  } catch {
    return { ok: false, code: 'failed', changed: false };
  }
  if (revalidate && changed) revalidatePath('/', 'layout');
  return { ok: true, code: 'ok', changed };
}

/** `POST /v1/blocks/members/{membershipId}` (plan 27): the author's items leave the lists at once. */
export async function blockMember(membershipId: unknown): Promise<BlockActionResult> {
  const id = membershipIdSchema.safeParse(membershipId);
  if (!id.success) return { ok: false, code: 'failed', changed: false };
  return writeBlock('POST', `/v1/blocks/members/${id.data}`, true);
}

/** `DELETE /v1/blocks/members/{membershipId}` (plan 27): restores only the content filter (D-724). */
export async function unblockMember(membershipId: unknown): Promise<BlockActionResult> {
  const id = membershipIdSchema.safeParse(membershipId);
  if (!id.success) return { ok: false, code: 'failed', changed: false };
  return writeBlock('DELETE', `/v1/blocks/members/${id.data}`, true);
}

/**
 * `DELETE /v1/blocks/{userId}` (Phase 13): the blocked list's own unblock. The id is the one the CALLER's own
 * list returned (`GET /v1/blocks`, only the caller's blocks), so it never names anyone the caller did not block.
 * Nothing restores a follow (D-724).
 */
export async function unblockBlocked(userId: unknown): Promise<BlockActionResult> {
  const id = membershipIdSchema.safeParse(userId);
  if (!id.success) return { ok: false, code: 'failed', changed: false };
  return writeBlock('DELETE', `/v1/blocks/${id.data}`, false);
}

/** One page of the blocked list, finished (UI-D-635); `ok: false` is the page's failure state, never a message. */
export type BlockedPageResult =
  | { ok: true; items: BlockedMemberView[]; nextCursor: string | null }
  | { ok: false };

/** `GET /v1/blocks?cursor=`: the next keyset page of the CALLER's own blocks, for `InfiniteScroll`. */
export async function loadMoreBlocked(cursor: unknown): Promise<BlockedPageResult> {
  const parsed = z.string().min(1).max(512).safeParse(cursor);
  if (!parsed.success) return { ok: false };
  try {
    const page = await fetchBlocks({ cursor: parsed.data });
    return { ok: true, items: page.items.map(blockedMemberView), nextCursor: page.nextCursor };
  } catch (error) {
    console.error('safety.blocked.page_failed', { error: String(error) });
    return { ok: false };
  }
}
