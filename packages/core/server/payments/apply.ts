import type {
  MembershipAccessCut,
  PaymentEventOutcome,
  PaymentEventState,
  PaymentsPurchaseConfirmed,
} from '@rede-social/contracts/payments';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { emit, flush } from '../events/bus';
import { moduleLogger, type RedactedDbError, redactDbError } from '../logging';
import { centralProjectId } from '../tenancy/project-registry';
import { type AccessEffect, decideAccessWrite, decideStoreWrite } from './policy';

/**
 * `applyPaymentEvent` (09.1-07, D-496, D-505, D-509): turns ONE recorded gateway delivery into a change of
 * what a person may do. It is the brain of the integration and it is written for a world where the
 * gateway re-sends, delivers out of order, and carries no event id, so it must be safe to run twice, out
 * of order and concurrently. The pure decisions live in `policy.ts`; this file reads the facts, asks, and
 * executes the answer in single statements that each name the tenant themselves.
 *
 * ONE admin transaction (`withAdminTx`, the `service_role` lane that BYPASSES RLS, which is why every
 * statement below carries an explicit `tenant_id` predicate and why the tenant is the INTEGRATION's, never
 * a field of the payload, T-09.1-22):
 *
 *  1. `select … from payment_events … for update of e`: the row lock is the idempotency. A state other than
 *     `received` or `failed` is an untouched no-op, so a replayed job or a second delivery of the same
 *     bytes changes nothing. (The `short` queue policy is NOT idempotency, Pitfall 7.)
 *  2. `pg_advisory_xact_lock(hashtextextended(tenant:provider:externalRef, 0))` serialises the events of
 *     ONE subscription or order, so two of them can never interleave their read-decide-write (P13). Events
 *     of other references take other keys and run freely (T-09.1-35).
 *  3. effect `none`, or no product id → `ignored`/`no_effect`. The mapping is looked up with the tenant
 *     PINNED: `tenant_id = <integration tenant> and provider and external_product_id`, so a product mapped
 *     by another tenant is `unknown_product` here and writes nothing anywhere (PAY-29).
 *  4. `access` mapping → the gateway `access_grants` row keyed `(tenant, provider, externalRef)`, with the
 *     e-mail as data: the person need not have an account yet (D-490, D-493). Nothing is matched to an
 *     account except by exact `lower(btrim())` equality, and nothing is ever created from a payment (PR-7).
 *     `store_product` mapping → the store definers (`app.store_gateway_purchase` / `_revoke`), which are the
 *     only writers of the order and entitlement ledgers; the e-mail must match a LIVE membership of this
 *     tenant or the event waits as `no_membership` (D-490).
 *  5. the event row is settled (`state`, `outcome`, `mapping_id`, `applied_at`) in the same transaction.
 *
 * AFTER the commit, and only then, a domain event may be emitted through a system `RequestContext` and
 * flushed (`courses/reminders.ts`): `membership.access_cut` exactly when the effective access state of a
 * LIVE `member` moved from `granted` to `cut` in THIS apply (read with `app.access_state` before and after
 * the write), never for staff, never when the gate is off, never on a return (D-499, D-500). A failing
 * subscriber never breaks the job: the bus swallows it.
 *
 * An exception rolls the whole transaction back; a SEPARATE transaction then marks the event `failed`
 * (a conditional update that touches only a `received` row, no payload and no e-mail in any log) and the
 * error is rethrown so pg-boss retries. `failed` is re-appliable, so a retry or the gateway's manual
 * resend converges. `no_membership`, `unknown_product`, `ignored` and `stale` are FINAL states, not
 * failures: nothing about them is retried.
 */

const log = moduleLogger('kernel-jobs');

/** The zero user the payments job acts as when it emits (the kernel keeps its own constant, MOD-02). */
export const PAYMENTS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export type ApplyResult = {
  state: PaymentEventState;
  outcome: PaymentEventOutcome | null;
  /** The domain events emitted after the commit, by name. */
  emitted: string[];
  tenantId: string;
};

type EventRow = {
  id: string;
  tenant_id: string;
  integration_id: string;
  provider: string;
  type: string;
  effect: string;
  external_ref: string | null;
  external_product_id: string | null;
  email: string | null;
  amount_cents: number | null;
  currency: string | null;
  recurring: boolean;
  state: string;
  valid_until: string | null;
  occurred_at: string | null;
};

type MappingRow = { id: string; kind: string; target_id: string | null };

type Settled = {
  state: PaymentEventState;
  outcome: PaymentEventOutcome | null;
  /** The domain events to emit once the transaction has committed. */
  cut: MembershipAccessCut | null;
  purchase: PaymentsPurchaseConfirmed | null;
};

/** ISO-8601 UTC with milliseconds: the one text form this file reads timestamps in (drizzle returns text). */
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

const rowsOf = <T>(result: unknown): T[] => result as T[];

async function settle(
  tx: Tx,
  ev: EventRow,
  state: PaymentEventState,
  outcome: PaymentEventOutcome | null,
  mappingId: string | null,
): Promise<void> {
  await tx.execute(sql`
    update public.payment_events
       set state = ${state}, outcome = ${outcome}, mapping_id = ${mappingId}::uuid, applied_at = now()
     where id = ${ev.id}::uuid
       and tenant_id = ${ev.tenant_id}::uuid
       and integration_id = ${ev.integration_id}::uuid`);
}

/**
 * The LIVE membership an e-mail belongs to in ONE tenant: exact `lower(btrim())` equality, nothing fuzzy
 * (PR-7). `memberOnly` restricts it to the `member` role (the cut signal is about members, never staff);
 * the store branch accepts any live role, because an admin may buy a product like anyone else.
 */
async function findLiveMember(
  tx: Tx,
  tenantId: string,
  email: string,
  memberOnly: boolean,
): Promise<{ membershipId: string; userId: string } | null> {
  const found = rowsOf<{ membership_id: string; user_id: string }>(
    await tx.execute(sql`
      select m.id::text as membership_id, m.user_id::text as user_id
        from public.users u
        join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${tenantId}::uuid
         and lower(btrim(u.email)) = ${email}::text
         and (${memberOnly} = false or m.role = 'member')
         and m.status = 'active'
         and m.blocked_at is null
         and m.deleted_at is null
       limit 1`),
  )[0];
  return found ? { membershipId: found.membership_id, userId: found.user_id } : null;
}

async function accessStateOf(tx: Tx, tenantId: string, userId: string): Promise<string | null> {
  const row = rowsOf<{ state: string | null }>(
    await tx.execute(sql`select app.access_state(${tenantId}::uuid, ${userId}::uuid) as state`),
  )[0];
  return row?.state ?? null;
}

const NO_EFFECT = { cut: null, purchase: null } as const;

/** An `access` mapping: write the sale's gateway row and note whether a live member was cut by it. */
async function applyAccess(tx: Tx, ev: EventRow, mapping: MappingRow): Promise<Settled> {
  if (!ev.external_ref) {
    await settle(tx, ev, 'ignored', 'no_effect', mapping.id);
    return { state: 'ignored', outcome: 'no_effect', ...NO_EFFECT };
  }

  const existing = rowsOf<{
    email: string;
    status: 'active' | 'inactive';
    terminal: boolean;
    last_event_at: string | null;
  }>(
    await tx.execute(sql`
      select email, status, terminal,
             to_char(last_event_at at time zone 'utc', ${sql.raw(ISO)}) as last_event_at
        from public.access_grants
       where tenant_id = ${ev.tenant_id}::uuid
         and provider = ${ev.provider}
         and external_ref = ${ev.external_ref}
         and source = 'gateway'
         for update`),
  )[0];

  // The row's own e-mail decides who is affected and an existing row's e-mail is never rewritten, so a
  // later event of the sale needs no e-mail of its own (a cancel that omits the customer still cuts). A
  // NEW row needs one: without it there is nobody to open the door for.
  const email = existing?.email ?? (ev.email && ev.email.length > 0 ? ev.email : null);
  if (!email) {
    await settle(tx, ev, 'ignored', 'no_effect', mapping.id);
    return { state: 'ignored', outcome: 'no_effect', ...NO_EFFECT };
  }

  const decision = decideAccessWrite({
    effect: ev.effect as AccessEffect,
    recurring: ev.recurring,
    existing: existing
      ? {
          status: existing.status,
          terminal: existing.terminal,
          lastEventAt: existing.last_event_at ? new Date(existing.last_event_at) : null,
        }
      : null,
    occurredAt: ev.occurred_at ? new Date(ev.occurred_at) : null,
  });

  if (decision.action === 'skip') {
    await settle(tx, ev, 'ignored', decision.outcome, mapping.id);
    return { state: 'ignored', outcome: decision.outcome, ...NO_EFFECT };
  }

  const member = await findLiveMember(tx, ev.tenant_id, email, true);
  const before = member ? await accessStateOf(tx, ev.tenant_id, member.userId) : null;

  await tx.execute(sql`
    insert into public.access_grants
      (tenant_id, email, source, status, provider, external_ref, mapping_id, valid_until,
       last_event_at, terminal)
    values
      (${ev.tenant_id}::uuid, ${email}, 'gateway', ${decision.status}, ${ev.provider},
       ${ev.external_ref}, ${mapping.id}::uuid, ${ev.valid_until}::timestamptz,
       coalesce(${ev.occurred_at}::timestamptz, now()), ${decision.terminal})
    on conflict (tenant_id, provider, external_ref) where source = 'gateway'
    do update set status = excluded.status,
                  terminal = excluded.terminal,
                  valid_until = coalesce(excluded.valid_until, public.access_grants.valid_until),
                  mapping_id = excluded.mapping_id,
                  last_event_at = excluded.last_event_at,
                  updated_at = now()`);

  const after = member ? await accessStateOf(tx, ev.tenant_id, member.userId) : null;
  await settle(tx, ev, 'applied', decision.outcome, mapping.id);

  const cut =
    member && before === 'granted' && after === 'cut'
      ? { tenantId: ev.tenant_id, userId: member.userId, membershipId: member.membershipId }
      : null;
  return { state: 'applied', outcome: decision.outcome, cut, purchase: null };
}

/**
 * A `store_product` mapping (D-505, D-506, D-507, D-509): a grant buys the product for the live member the
 * e-mail belongs to, at the amount the gateway reports charged; a suspend or revoke ends the sale's live
 * order. The ledgers are written ONLY through the two explicit-argument `service_role` definers of plan 06,
 * never by a statement of this file, so the order, the entitlement and the community unlock stay one rule.
 *
 * What is NOT guessed (PR-7, D-490): the member is found by exact `lower(btrim())` e-mail equality inside
 * the integration's tenant and only when the membership is LIVE (`active`, not blocked, not deleted);
 * otherwise the event waits as `no_membership` and the admin decides. A revoke needs no member: the sale's
 * reference alone identifies the order in this tenant, and a refund must lock the product even when the
 * buyer was blocked or removed since.
 */
async function applyStore(tx: Tx, ev: EventRow, mapping: MappingRow): Promise<Settled> {
  const ignored = async (outcome: PaymentEventOutcome): Promise<Settled> => {
    await settle(tx, ev, 'ignored', outcome, mapping.id);
    return { state: 'ignored', outcome, ...NO_EFFECT };
  };
  const providerRef = ev.external_ref;
  if (!providerRef || !mapping.target_id) return ignored('no_effect');

  if (ev.effect !== 'grant') {
    const decision = decideStoreWrite({
      effect: ev.effect as AccessEffect,
      recurring: ev.recurring,
      priorTerminalEvent: false,
    });
    if (decision.action !== 'revoke') return ignored('no_effect');
    const revoked = rowsOf<{ outcome: string }>(
      await tx.execute(sql`
        select outcome from app.store_gateway_revoke(
          ${ev.tenant_id}::uuid, ${ev.provider}::text, ${providerRef}::text)`),
    )[0];
    const outcome = revoked?.outcome === 'revoked' ? 'product_revoked' : 'no_effect';
    await settle(tx, ev, 'applied', outcome, mapping.id);
    return { state: 'applied', outcome, ...NO_EFFECT };
  }

  // A grant needs a buyer, an amount, and the store's only currency (A-P16; no currency reads as BRL).
  const email = ev.email && ev.email.length > 0 ? ev.email : null;
  if (!email || ev.amount_cents === null) return ignored('no_effect');
  if (ev.currency !== null && ev.currency.toUpperCase() !== 'BRL') {
    return ignored('currency_unsupported');
  }

  const member = await findLiveMember(tx, ev.tenant_id, email, false);
  if (!member) {
    await settle(tx, ev, 'no_membership', null, mapping.id);
    return { state: 'no_membership', outcome: null, ...NO_EFFECT };
  }

  // The one-off rule's fact (T-09.1-33): an APPLIED refund or chargeback of the same sale, earlier.
  const prior = rowsOf<{ found: boolean }>(
    await tx.execute(sql`
      select exists (
        select 1
          from public.payment_events
         where tenant_id = ${ev.tenant_id}::uuid
           and provider = ${ev.provider}
           and external_ref = ${providerRef}
           and id <> ${ev.id}::uuid
           and state = 'applied'
           and type in ('purchase_refunded', 'chargeback')) as found`),
  )[0];
  const decision = decideStoreWrite({
    effect: 'grant',
    recurring: ev.recurring,
    priorTerminalEvent: prior?.found ?? false,
  });
  if (decision.action === 'skip') return ignored(decision.outcome);

  // `paid_at` is the arrival time (A-P15): no gateway timestamp is trustworthy.
  const bought = rowsOf<{ outcome: string; product_name: string | null; user_id: string | null }>(
    await tx.execute(sql`
      select outcome, product_name, user_id::text as user_id
        from app.store_gateway_purchase(
          ${ev.tenant_id}::uuid, ${member.membershipId}::uuid, ${mapping.target_id}::uuid,
          ${ev.provider}::text, ${providerRef}::text, ${ev.amount_cents}::int, now())`),
  )[0];

  if (bought?.outcome === 'purchased') {
    await settle(tx, ev, 'applied', 'product_granted', mapping.id);
    return {
      state: 'applied',
      outcome: 'product_granted',
      cut: null,
      purchase: {
        tenantId: ev.tenant_id,
        userId: bought.user_id ?? member.userId,
        productId: mapping.target_id,
        productName: bought.product_name ?? '',
      },
    };
  }
  // `already_active`: a renewal of a sale that is still live, or a re-sent body (A-P11: only the first
  // charge is recorded). `not_found`: the definer refused the arguments (a corrupt amount, A-P59).
  const outcome = bought?.outcome === 'already_active' ? 'applied' : 'ignored';
  await settle(tx, ev, outcome, 'no_effect', mapping.id);
  return { state: outcome, outcome: 'no_effect', ...NO_EFFECT };
}

/** The transaction body: lock, decide by branch, settle. Returns what to emit after the commit. */
async function applyInTx(
  tx: Tx,
  eventId: string,
  seen: { tenantId: string | null },
): Promise<(Settled & { tenantId: string }) | { missing: true } | { untouched: EventRow }> {
  const ev = rowsOf<EventRow>(
    await tx.execute(sql`
      select e.id::text as id, i.tenant_id::text as tenant_id, e.integration_id::text as integration_id,
             e.provider, e.type, e.effect, e.external_ref, e.external_product_id, e.email,
             e.amount_cents, e.currency, e.recurring, e.state,
             to_char(e.valid_until at time zone 'utc', ${sql.raw(ISO)}) as valid_until,
             to_char(e.occurred_at at time zone 'utc', ${sql.raw(ISO)}) as occurred_at
        from public.payment_events e
        join public.payment_integrations i
          on i.id = e.integration_id and i.tenant_id = e.tenant_id
       where e.id = ${eventId}::uuid
         for update of e`),
  )[0];
  if (!ev) return { missing: true };
  seen.tenantId = ev.tenant_id;
  if (ev.state !== 'received' && ev.state !== 'failed') return { untouched: ev };

  if (ev.external_ref) {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${ev.tenant_id}::text || ':' || ${ev.provider}::text || ':' || ${ev.external_ref}::text, 0))`);
  }

  // The mapping, TENANT PINNED (PAY-29): a product another tenant mapped is not found here.
  const mapping = ev.external_product_id
    ? rowsOf<MappingRow>(
        await tx.execute(sql`
          select id::text as id, kind, target_id::text as target_id
            from public.payment_products
           where tenant_id = ${ev.tenant_id}::uuid
             and provider = ${ev.provider}
             and external_product_id = ${ev.external_product_id}`),
      )[0]
    : undefined;

  if (ev.effect === 'none' || !ev.external_product_id) {
    await settle(tx, ev, 'ignored', 'no_effect', mapping?.id ?? null);
    return { state: 'ignored', outcome: 'no_effect', ...NO_EFFECT, tenantId: ev.tenant_id };
  }
  if (!mapping) {
    await settle(tx, ev, 'unknown_product', null, null);
    return { state: 'unknown_product', outcome: null, ...NO_EFFECT, tenantId: ev.tenant_id };
  }

  if (mapping.kind === 'access') {
    const settled = await applyAccess(tx, ev, mapping);
    return { ...settled, tenantId: ev.tenant_id };
  }

  const settled = await applyStore(tx, ev, mapping);
  return { ...settled, tenantId: ev.tenant_id };
}

/** Marks an event `failed` in its OWN transaction, after the apply transaction rolled back. */
async function markFailed(eventId: string, tenantId: string): Promise<void> {
  await withAdminTx({ tenantId }, (tx) =>
    tx.execute(sql`
      update public.payment_events
         set state = 'failed'
       where id = ${eventId}::uuid
         and tenant_id = ${tenantId}::uuid
         and state = 'received'`),
  );
}

/** A failed statement of the apply transaction, stripped of its SQL, parameters and cause (WR-02). */
export class PaymentApplyError extends Error {
  readonly sqlstate: string | null;

  constructor(sqlstate: string | null) {
    super(`payment event apply failed${sqlstate ? ` (sqlstate ${sqlstate})` : ''}`);
    this.name = 'PaymentApplyError';
    this.sqlstate = sqlstate;
  }
}

/** What a log line may say about a failure: the message of an ordinary error, the identifiers of a statement. */
function describeFailure(error: unknown): string | RedactedDbError {
  const redacted = redactDbError(error);
  if (redacted !== error) return redacted as RedactedDbError;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies one recorded event. Returns null when no such event exists (logged, never thrown); throws after
 * marking the event `failed` when the apply itself failed, so pg-boss retries.
 *
 * `projectId` is the project whose queue delivered the job (09.2-10, D-538): the webhook recorded the event
 * AND enqueued this job inside the tenant's own project, so the event row is in that same database and the
 * apply transaction opens there with `{ projectId }`. The tenant is still taken from the stored row (never
 * from the job payload), so the lane target names a database and nothing about whose data is applied.
 * Called without it (a test, an operator command) the central project is meant.
 */
export async function applyPaymentEvent(
  eventId: string,
  projectId?: string,
): Promise<ApplyResult | null> {
  const seen: { tenantId: string | null } = { tenantId: null };
  let result: Awaited<ReturnType<typeof applyInTx>>;
  try {
    // 09.2-10: the job payload is the event id ALONE, so the tenant is only known after this very transaction
    // reads the event row. The database is not: the event was recorded in the project that delivered the job,
    // and `kernel.payment-event` is a tenant-scope queue, so the worker hands that project over.
    const target = { projectId: projectId ?? (await centralProjectId()) };
    result = await withAdminTx(target, (tx) => applyInTx(tx, eventId, seen));
  } catch (error) {
    if (seen.tenantId) {
      try {
        await markFailed(eventId, seen.tenantId);
      } catch (markError) {
        log.error(
          {
            event: 'payments.apply.mark_failed_failed',
            eventId,
            tenantId: seen.tenantId,
            err: describeFailure(markError),
          },
          'could not mark the payment event failed',
        );
      }
    }
    // Ids, and for a failed statement its SQLSTATE and constraint: never the e-mail, the amount or any
    // payload (T-09.1-36, PR-9). drizzle's message embeds every bound parameter (WR-02).
    log.error(
      {
        event: 'payments.apply.failed',
        eventId,
        tenantId: seen.tenantId,
        err: describeFailure(error),
      },
      'applying a payment event failed; pg-boss retries',
    );
    // pg-boss stores the thrown error's message and stack in the job row, so a failed statement is
    // rethrown without its SQL, parameters and cause; any other error propagates unchanged.
    const redacted = redactDbError(error);
    if (redacted !== error) throw new PaymentApplyError((redacted as RedactedDbError).sqlstate);
    throw error;
  }

  if ('missing' in result) {
    log.warn({ event: 'payments.apply.missing', eventId }, 'payment event not found; dropped');
    return null;
  }
  if ('untouched' in result) {
    const { untouched } = result;
    return {
      state: untouched.state as PaymentEventState,
      outcome: null,
      emitted: [],
      tenantId: untouched.tenant_id,
    };
  }

  const emitted: string[] = [];
  if (result.cut || result.purchase) {
    const ctx: RequestContext = {
      userId: PAYMENTS_SYSTEM_USER_ID,
      tenantId: result.tenantId,
      role: 'support_tenant',
      requestId: 'job:payments',
      events: [],
    };
    if (result.cut) {
      emit(ctx, 'membership.access_cut', result.cut);
      emitted.push('membership.access_cut');
    }
    if (result.purchase) {
      emit(ctx, 'payments.purchase_confirmed', result.purchase);
      emitted.push('payments.purchase_confirmed');
    }
    // AFTER the commit: a subscriber can never see a change that a rollback erased.
    await flush(ctx, log);
  }
  return { state: result.state, outcome: result.outcome, emitted, tenantId: result.tenantId };
}
