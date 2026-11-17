import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * A small fixture kit for the support-case suites (Phase 12.4). Modelled on `chat.test.ts` (the shapes
 * are copied on purpose: that file is not imported and not edited).
 *
 * THE TENANT COUNTER IS NEVER TOUCHED. It holds one row per tenant and numbers keep rising across
 * files and runs, so every number assertion in a case suite is RELATIVE to `highestNumber`. Nothing in
 * this kit deletes or resets a counter row; `sweepCases` deletes conversations, which only cascades to
 * their events.
 */

/** Mirrors `scripts/seed.ts` (SEED_SUPPORT_CONVERSATION_ID / _MESSAGES / _MESSAGE_IDS). */
export const SEED_THREAD = {
  id: '1d000000-0000-4000-8000-000000000001',
  messages: [
    ['1d000000-0000-4000-8000-000000000011', 'member', 'Oi, preciso de ajuda com meu cadastro.'],
    ['1d000000-0000-4000-8000-000000000012', 'staff', 'Oi! Como posso ajudar?'],
    ['1d000000-0000-4000-8000-000000000013', 'member', 'Quero trocar meu e-mail.'],
  ] as const,
};

export type CaseKit = {
  tokens: { demoMember: string; demoSupport: string; demoAdmin: string };
  ids: {
    demo: string;
    lab: string;
    demoMember: string;
    demoSupport: string;
    demoAdmin: string;
  };
};

const kit: CaseKit = {
  tokens: { demoMember: '', demoSupport: '', demoAdmin: '' },
  ids: { demo: '', lab: '', demoMember: '', demoSupport: '', demoAdmin: '' },
};
let loaded = false;

async function userId(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = ${email}`;
  return row?.id ?? '';
}

/** Signs the three demo lanes in and reads the ids; the same object is returned on every call. */
export async function caseKit(): Promise<CaseKit> {
  if (loaded) return kit;
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  kit.tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  kit.tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  kit.tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  const tenants = await adminSql<{ slug: string; id: string }[]>`
    select slug, id::text as id from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  kit.ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  kit.ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  kit.ids.demoMember = await userId('member@rede-demo.local');
  kit.ids.demoSupport = await userId('support@rede-demo.local');
  kit.ids.demoAdmin = await userId('admin@rede-demo.local');
  loaded = true;
  return kit;
}

export const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': HOSTS.demo,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

export const post = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) });

/** The tenant's highest case number as an integer (0 when it has none): the base of every assertion. */
export async function highestNumber(tenantId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select coalesce(max(case_number), 0)::int as n
      from public.chat_conversations
     where tenant_id = ${tenantId}::uuid and kind = 'support'`;
  return row?.n ?? 0;
}

/** Throwaway demo users this kit created (swept with their rows by `removeThrowaways`). */
const throwaways: string[] = [];
const THROWAWAY_PASSWORD = 'Segredo123';

/** A fresh live `member` (or staff) of the demo tenant with no conversation, signed in. */
export async function throwawayMember(
  label: string,
  role: 'member' | 'support_tenant' = 'member',
): Promise<{ id: string; token: string }> {
  const { ids } = await caseKit();
  const email = `case-${label}-${Date.now()}@rede-demo.local`;
  const created = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: `Pessoa ${label}` },
  });
  const id = created.data.user?.id ?? '';
  if (!id) throw new Error(`could not create ${email}: ${created.error?.message}`);
  throwaways.push(id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${ids.demo}::uuid, ${id}::uuid, ${role}, 'active')`;
  return { id, token: await signInAs(email, THROWAWAY_PASSWORD) };
}

export async function removeThrowaways(): Promise<void> {
  for (const id of throwaways.splice(0)) {
    await adminSql`delete from public.chat_messages where author_user_id = ${id}::uuid`;
    await adminSql`delete from public.chat_conversations where created_by_user_id = ${id}::uuid`;
    await adminSql`
      delete from public.member_profiles
       where membership_id in (select id from public.memberships where user_id = ${id}::uuid)`;
    await adminSql`delete from public.memberships where user_id = ${id}::uuid`;
    await authAdmin().deleteUser(id);
  }
}

/** Re-creates the seeded demo thread exactly; the triggers assign seqs 1..3 again. */
async function restoreSeedThread(): Promise<void> {
  const { ids } = await caseKit();
  await adminSql`delete from public.chat_conversations where id = ${SEED_THREAD.id}::uuid`;
  await adminSql`
    delete from public.chat_conversations
     where tenant_id = ${ids.demo}::uuid and kind = 'support'
       and created_by_user_id = ${ids.demoMember}::uuid`;
  await adminSql`
    insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
    values (${SEED_THREAD.id}::uuid, ${ids.demo}::uuid, 'support', ${ids.demoMember}::uuid)`;
  await adminSql`
    insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
    values (${SEED_THREAD.id}::uuid, ${ids.demo}::uuid, ${ids.demoMember}::uuid, 'member')`;
  for (const [id, side, body] of SEED_THREAD.messages) {
    const author = side === 'staff' ? ids.demoSupport : ids.demoMember;
    await adminSql`
      insert into public.chat_messages (id, tenant_id, conversation_id, author_user_id, author_side, body)
      values (${id}::uuid, ${ids.demo}::uuid, ${SEED_THREAD.id}::uuid, ${author}::uuid, ${side}, ${body})`;
  }
}

/** Every chat conversation of both seed tenants goes (their events cascade), then the seeded thread returns. */
export async function sweepCases(): Promise<void> {
  const { ids } = await caseKit();
  await adminSql`
    delete from public.chat_conversations where tenant_id in (${ids.demo}::uuid, ${ids.lab}::uuid)`;
  await restoreSeedThread();
}
