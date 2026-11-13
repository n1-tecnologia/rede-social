'use server';

import { eventMappingBodySchema } from '@rede-social/module-payments/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteEventMapping, getEventMapping, putEventMapping } from '@/lib/payments';

/**
 * The event form's SECOND write (Phase 10.1-11, TICK-02 to TICK-05, D-744, D-745, D-747, UI-D-743,
 * T-10.1-24): the gateway product that sells the ticket of an event. The events and payments modules
 * cannot share a transaction (MOD-02), so the form saves the event first and calls one of these two
 * actions after; a failure here leaves the event saved and the form keeps its typed values.
 *
 * - the SAME Zod the API validates with runs BEFORE any request (a server action is a public
 *   endpoint): an id without a link, a link that is not an `https:` purchase link and an id past the
 *   cap are refused here and never leave the server;
 * - the event id is a uuid and the API decides whether it belongs to this tenant (the bare 404): this
 *   action never decides ownership;
 * - a sale that landed meanwhile is `locked`, and the action then reads the real count so the form can
 *   say "N ingressos vendidos" instead of guessing; an unreadable count is simply left out;
 * - a refusal the bootstrap knows becomes a navigation OUTSIDE any try/catch (Next 16: `redirect()`
 *   throws); every other refusal is a closed code the form maps to a field error, the lock row or the
 *   save toast. No id, link or body is ever logged.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

/**
 * The closed answer the form maps: ok (with the subscription hint of the save answer, A-UI-10), or one
 * of the field issues, or the sales lock with the count when it could be read, or `generic`.
 */
export type EventTicketOutcome =
  | { ok: true; recurring?: boolean }
  | {
      ok: false;
      issue: 'id_required' | 'link_required' | 'link_invalid' | 'id_taken' | 'generic';
    }
  | { ok: false; issue: 'locked'; soldCount?: number };

const eventIdSchema = z.uuid();

/** The sold count after a lock refusal; `undefined` when the read itself failed (the form assumes one). */
async function soldCountOf(eventId: string): Promise<number | undefined> {
  try {
    return (await getEventMapping(eventId))?.soldCount;
  } catch {
    return undefined;
  }
}

/** The outcome of a failed write; a bootstrap refusal navigates, which throws, so it never returns. */
async function refused(
  eventId: string,
  outcome: Exclude<Awaited<ReturnType<typeof putEventMapping>>, { ok: true }>,
): Promise<EventTicketOutcome> {
  if (outcome.reason === 'redirect') redirect(outcome.path);
  switch (outcome.reason) {
    case 'id_required':
    case 'link_required':
    case 'link_invalid':
    case 'id_taken':
      return { ok: false, issue: outcome.reason };
    case 'locked': {
      const soldCount = await soldCountOf(eventId);
      return soldCount === undefined
        ? { ok: false, issue: 'locked' }
        : { ok: false, issue: 'locked', soldCount };
    }
    default:
      return { ok: false, issue: 'generic' };
  }
}

function revalidateEventScreens(eventId: string) {
  revalidatePath('/eventos');
  revalidatePath(`/eventos/${eventId}`);
}

/** `PUT /v1/payments/event-products/{eventId}`: links (or relinks) the product after the event save. */
export async function saveEventTicketAction(
  eventId: string,
  input: { externalProductId: string; checkoutUrl: string },
): Promise<EventTicketOutcome> {
  const target = eventIdSchema.safeParse(eventId);
  if (!target.success) return { ok: false, issue: 'generic' };
  const externalProductId =
    typeof input?.externalProductId === 'string' ? input.externalProductId.trim() : '';
  const checkoutUrl = typeof input?.checkoutUrl === 'string' ? input.checkoutUrl.trim() : '';

  const body = eventMappingBodySchema.safeParse({ externalProductId, checkoutUrl });
  if (!body.success) {
    const messages = body.error.issues.map((issue) => issue.message);
    if (messages.includes('gateway_product_id_required')) {
      return { ok: false, issue: 'id_required' };
    }
    if (messages.includes('link_required')) return { ok: false, issue: 'link_required' };
    if (messages.includes('link_invalid')) return { ok: false, issue: 'link_invalid' };
    return { ok: false, issue: 'generic' };
  }

  const outcome = await putEventMapping(target.data, body.data);
  if (outcome.ok) {
    revalidateEventScreens(target.data);
    return { ok: true, recurring: outcome.recurring };
  }
  return refused(target.data, outcome);
}

/** `DELETE /v1/payments/event-products/{eventId}`: the switch turned off on a saved, unsold product. */
export async function removeEventTicketAction(eventId: string): Promise<EventTicketOutcome> {
  const target = eventIdSchema.safeParse(eventId);
  if (!target.success) return { ok: false, issue: 'generic' };

  const outcome = await deleteEventMapping(target.data);
  if (outcome.ok) {
    revalidateEventScreens(target.data);
    return { ok: true };
  }
  return refused(target.data, outcome);
}
