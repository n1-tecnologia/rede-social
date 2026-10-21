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
