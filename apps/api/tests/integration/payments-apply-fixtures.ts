import { createHash } from 'node:crypto';
import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { paymentEventJob } from '@rede-social/core/server/payments/event-job';
import { expect } from 'vitest';
import {
  adminSql,
  api,
  authAdmin,
  HOSTS,
  SEED_PASSWORD,
  type SeededPaymentIntegration,
  signedWebhook,
  signInAs,
} from './setup';

/**
 * Shared fixtures of the 09.1-07 apply-job suites (`payments-apply.test.ts`,
 * `payments-order-policy.test.ts`): a throwaway person with a CHOSEN e-mail (the apply job matches on
 * the e-mail alone, and the tracer needs the e-mail to exist BEFORE the account does), a signed delivery
 * that returns the recorded event id, a direct run of the real job, and the two reads every case makes
 * (the event row and the gateway access rows). Nothing here is application code.
 *
 * The delivery goes through the REAL route and the real inbox; the job is run by calling the real
 * handler (`paymentEventJob.handler`), which is what the worker's pg-boss poller does with the queued
 * `{ eventId }`.
 */

export type Person = { userId: string; membershipId: string; email: string; token: string };

type TenantRole = 'member' | 'admin_tenant' | 'support_tenant';

/** An e-mail no account owns yet: `<prefix>-<random>@rede-demo.local` (swept by prefix). */
export function freshEmail(prefix: string, label = ''): string {
  return `${prefix}-${label}${crypto.randomUUID().slice(0, 12)}@rede-demo.local`;
}

/** A confirmed account with `email` and one membership in the seed tenant behind `host`. */
export async function personWithEmail(
  email: string,
  host: keyof typeof HOSTS,
  role: TenantRole = 'member',
): Promise<Person> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  const userId = data.user.id;
  const [membership] = await adminSql<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status)
    select d.tenant_id, ${userId}::uuid, ${role}, 'active'
      from public.tenant_domains d
     where d.host = ${HOSTS[host]} and d.verified_at is not null
     limit 1
    returning id::text as id`;
  if (!membership) throw new Error(`no verified seed tenant behind ${HOSTS[host]}`);
  return {
    userId,
    membershipId: membership.id,
    email,
    token: await signInAs(email, SEED_PASSWORD),
  };
}

/** `GET /v1/me/bootstrap` as `person` on the host of `host`: the gate's probe (200, or 403 when cut). */
export const bootstrap = (person: Person, host: keyof typeof HOSTS = 'lab') =>
  api.request('/v1/me/bootstrap', {
    headers: { [TENANT_HOST_HEADER]: HOSTS[host], authorization: `Bearer ${person.token}` },
  });

export async function bootstrapCode(
  person: Person,
  host: keyof typeof HOSTS = 'lab',
): Promise<string> {
  const res = await bootstrap(person, host);
  if (res.status === 200) return 'OK';
  return ((await res.json()) as { error?: { code?: string } }).error?.code ?? `HTTP_${res.status}`;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

let delivered = 0;

/**
 * Posts `body` (a neutral fake event) through the signed webhook route and returns the recorded event
 * id. The bytes are made unique by an `orderRef` counter unless the caller supplies one, because the
 * inbox dedupes on the exact bytes: pass the same `orderRef` to deliver the SAME body twice.
 */
export async function deliver(
  integration: SeededPaymentIntegration,
  body: Record<string, unknown>,
): Promise<string> {
  delivered += 1;
  const payload = { orderRef: `REF-${Date.now()}-${delivered}`, ...body };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const res = await signedWebhook(integration, bytes);
  expect(res.status, 'the signed delivery must be accepted').toBe(200);
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.payment_events
     where integration_id = ${integration.id}::uuid and dedupe_key = ${sha256(bytes)}`;
  if (!row) throw new Error('the delivery left no payment_events row');
  return row.id;
}

/** Runs the real `kernel.payment-event` handler for one event id. */
export const runApply = (eventId: string) => paymentEventJob.handler({ eventId });

export type EventRow = {
  id: string;
  tenant_id: string;
  state: string;
  outcome: string | null;
  mapping_id: string | null;
  applied_at: Date | null;
};

export async function eventRow(eventId: string): Promise<EventRow> {
  const [row] = await adminSql<EventRow[]>`
    select id::text as id, tenant_id::text as tenant_id, state, outcome, mapping_id::text as mapping_id,
           applied_at
      from public.payment_events where id = ${eventId}::uuid`;
  if (!row) throw new Error(`no payment_events row ${eventId}`);
  return row;
}

/** Delivers `body`, runs the job once, and returns the settled event row. */
export async function deliverAndApply(
  integration: SeededPaymentIntegration,
  body: Record<string, unknown>,
): Promise<EventRow> {
  const eventId = await deliver(integration, body);
  await runApply(eventId);
  return eventRow(eventId);
}

export type GatewayRow = {
  id: string;
  tenant_id: string;
  email: string;
  status: string;
  terminal: boolean;
  provider: string;
  external_ref: string;
  mapping_id: string | null;
  valid_until: Date | null;
  last_event_at: Date | null;
  updated_at: Date;
};

/** The gateway access rows of one e-mail across ALL tenants (a cross-tenant leak shows up here). */
export const gatewayRowsOf = (email: string) =>
  adminSql<GatewayRow[]>`
    select id::text as id, tenant_id::text as tenant_id, email, status, terminal, provider,
           external_ref, mapping_id::text as mapping_id, valid_until, last_event_at, updated_at
      from public.access_grants
     where source = 'gateway' and email = ${email}
     order by external_ref`;

/** Membership and profile facts a cut or a return must never touch (PR-3, D-498). */
export async function membershipFacts(userId: string, tenantId: string) {
  return adminSql`
    select m.status, m.blocked_at, m.deleted_at, m.role, p.display_name, p.avatar_asset_id
      from public.memberships m
      left join public.member_profiles p on p.membership_id = m.id
     where m.user_id = ${userId}::uuid and m.tenant_id = ${tenantId}::uuid`;
}

export async function notificationCount(userId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.notifications where user_id = ${userId}::uuid`;
  return row?.n ?? -1;
}

/* ── Phase 10.1-05: the paid event's helpers (TICK-03..TICK-12). Nothing here is application code. ── */

export type TicketEventOptions = {
  title: string;
  /** Minutes from now; negative for a start already in the past. */
  startsInMinutes?: number;
  endsInMinutes?: number;
  status?: 'active' | 'cancelled';
  capacity?: number | null;
  deleted?: boolean;
};

/** An event of `tenantId`, created by that tenant's first admin (the title prefix sweeps it afterwards). */
export async function ticketEvent(tenantId: string, options: TicketEventOptions): Promise<string> {
  const [creator] = await adminSql<{ id: string }[]>`
    select user_id::text as id from public.memberships
     where tenant_id = ${tenantId}::uuid and role = 'admin_tenant' limit 1`;
  if (!creator) throw new Error('the tenant has no admin to create the event');
  const status = options.status ?? 'active';
  const [row] = await adminSql<{ id: string }[]>`
    with e as (
      insert into public.events (tenant_id, created_by_user_id, title, format, starts_at, ends_at,
                                 status, cancelled_at, capacity, deleted_at)
      values (${tenantId}::uuid, ${creator.id}::uuid, ${options.title}, 'online',
              now() + make_interval(mins => ${options.startsInMinutes ?? 60}),
              now() + make_interval(mins => ${options.endsInMinutes ?? 180}),
              ${status}, ${status === 'cancelled' ? adminSql`now()` : null},
              ${options.capacity ?? null}::int, ${options.deleted ? adminSql`now()` : null})
      returning id, tenant_id, format
    ), s as (
      insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
      select id, tenant_id, format, 'K7QM', 'https://example.test/sala' from e
    )
    select id::text as id from e`;
  if (!row) throw new Error(`could not insert the event ${options.title}`);
  return row.id;
}

/**
 * A mapping of kind `event` for `eventId` (provider `fake`, a unique gateway product id), written the way
 * the mapping service does: the central product route first, then the tenant row. Tear down with
 * `removePaymentMappings`.
 */
export async function ticketMapping(
  tenantId: string,
  eventId: string,
  options: { provider?: string; externalProductId?: string } = {},
): Promise<{ id: string; externalProductId: string }> {
  const externalProductId = options.externalProductId ?? `tk-${crypto.randomUUID()}`;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.payment_products (tenant_id, provider, kind, external_product_id, event_id)
    values (${tenantId}::uuid, ${options.provider ?? 'fake'}, 'event', ${externalProductId},
            ${eventId}::uuid)
    returning id::text as id`;
  if (!row) throw new Error('could not seed the event mapping');
  await adminSql`
    insert into platform.payment_product_routes (provider, external_product_id, tenant_id)
    select provider, external_product_id, tenant_id from public.payment_products
     where id = ${row.id}::uuid
    on conflict do nothing`;
  return { id: row.id, externalProductId };
}

/** A neutral `fake` delivery for an event product: a one-off sale (no subscription), BRL. */
export const ticketDelivery = (
  type: string,
  fields: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = fields;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 8_000,
    currency: 'BRL',
    recurring: false,
    ...rest,
  };
};

export type AttendanceRow = {
  user_id: string;
  status: string;
  origin: string;
  order_provider: string | null;
  order_ref: string | null;
  checked_in_at: Date | null;
  refunded_at: Date | null;
};

/** Every attendance row of one event, oldest first. */
export const attendancesOf = (eventId: string) =>
  adminSql<AttendanceRow[]>`
    select user_id::text as user_id, status, origin, order_provider, order_ref, checked_in_at,
           refunded_at
      from public.event_attendances
     where event_id = ${eventId}::uuid
     order by created_at, id`;

/** Removes the events whose title starts with `prefix` (their attendances and mapping go first). */
export async function removeTicketEvents(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await adminSql`
    delete from public.payment_products
     where event_id in (select id from public.events where title like ${like})`;
  await adminSql`
    delete from public.event_attendances
     where event_id in (select id from public.events where title like ${like})`;
  await adminSql`delete from public.events where title like ${like}`;
}
