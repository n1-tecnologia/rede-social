import postgres from 'postgres';
import { envValue } from './admin';
import { hosts, SEED_PASSWORD } from './fixtures';

/**
 * Fixtures for the support-chat e2e (07-09), the `notifications-admin.ts` shape: identity through
 * GoTrue, staff replies through the REAL API, and bulk rows through a direct superuser connection.
 *
 * Every row written here goes through the chat triggers (07-08): the BEFORE trigger assigns the
 * gapless `seq` under the conversation row lock and the AFTER trigger publishes the ids-only
 * `chat.message` / `chat.unread` signals, exactly as an API write does. No insert here ever uses
 * `on conflict` (a conflicting insert would still burn a seq).
 *
 * The seeded demo thread (`scripts/seed.ts`) is mirrored by id rather than imported: the seed is a
 * top-level-await script that needs `SEED_PASSWORD` and opens a connection at import time.
 */

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

/** The seeded demo support thread of `member@rede-demo.local` (07-08). */
export const SEED_SUPPORT_CONVERSATION_ID = '1d000000-0000-4000-8000-000000000001';

/** Its three bodies, mirrored from `scripts/seed.ts` `SEED_SUPPORT_MESSAGES` (member, staff, member). */
export const SEED_SUPPORT_MESSAGES = {
  memberFirst: 'Oi, preciso de ajuda com meu cadastro.',
  staffReply: 'Oi! Como posso ajudar?',
  memberSecond: 'Quero trocar meu e-mail.',
} as const;

/**
 * The team's read position the seed leaves on that thread: the staff reply (seq 2) is read, the
 * member's second message (seq 3) is not, so the thread starts "awaiting" and the staff count is 1.
 */
export const SEED_STAFF_READ_SEQ = 2;

/** The seeded demo staff member (`support_tenant`, first name "Carla"). */
export const SUPPORT_EMAIL = 'support@rede-demo.local';
export const SUPPORT_FIRST_NAME = 'Carla';

/** The host the API resolves the demo tenant from (the same one the browser navigates). */
export const demoHost = new URL(hosts.demo).hostname;

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeChatAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

async function accessToken(email: string, password = SEED_PASSWORD): Promise<string> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  return ((await session.json()) as { access_token: string }).access_token;
}

async function apiPost(email: string, path: string, body: unknown): Promise<unknown> {
  const token = await accessToken(email);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': demoHost,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`POST ${path} as ${email}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** A staff reply through the REAL API as the seeded support user; returns the message's seq. */
export async function replyAsSupport(conversationId: string, body: string): Promise<number> {
  const sent = (await apiPost(SUPPORT_EMAIL, `/v1/chat/conversations/${conversationId}/messages`, {
    body,
  })) as { message: { seq: number } };
  return sent.message.seq;
}

/** A member message through the REAL API (creates the conversation lazily); returns its id. */
export async function sendAsMember(email: string, body: string): Promise<string> {
  const sent = (await apiPost(email, '/v1/chat/support/messages', { body })) as {
    conversationId: string;
  };
  return sent.conversationId;
}

async function tenantAndUser(
  email: string,
  slug = 'rede-demo',
): Promise<{ tenantId: string; userId: string }> {
  const [row] = await sql()<{ tenant_id: string; user_id: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id
      from public.tenants t, auth.users u
     where t.slug = ${slug} and u.email = ${email}`;
  if (!row) throw new Error(`no ${email} in ${slug}`);
  return { tenantId: row.tenant_id, userId: row.user_id };
}

/** Deletes `email`'s support conversation (participants and messages cascade): the greeting again. */
export async function resetMemberConversation(email: string, slug = 'rede-demo'): Promise<void> {
  const { tenantId, userId } = await tenantAndUser(email, slug);
  await sql()`
    delete from public.chat_conversations
     where tenant_id = ${tenantId}::uuid and kind = 'support' and created_by_user_id = ${userId}::uuid`;
}

/**
 * `email`'s support conversation, created empty as the migration role when missing (the seed's own
 * shape: the conversation row plus the member's participant row). Returns its id.
 */
export async function ensureConversation(email: string, slug = 'rede-demo'): Promise<string> {
  const { tenantId, userId } = await tenantAndUser(email, slug);
  const existing = await sql()<{ id: string }[]>`
    select id::text as id from public.chat_conversations
     where tenant_id = ${tenantId}::uuid and kind = 'support' and created_by_user_id = ${userId}::uuid`;
  if (existing[0]) return existing[0].id;
  const [created] = await sql()<{ id: string }[]>`
    insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
    values (${tenantId}::uuid, 'support', ${userId}::uuid)
    returning id::text as id`;
  if (!created) throw new Error(`could not create a conversation for ${email}`);
  await sql()`
    insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
    values (${created.id}::uuid, ${tenantId}::uuid, ${userId}::uuid, 'member')`;
  return created.id;
}

/**
 * Inserts `rows` into `conversationId` as the migration role, one statement each (so each row gets
 * its own instant, oldest first). `staff` rows are written by the seeded support user, `member` rows
 * by the conversation's owner. The triggers assign the seqs and publish the signals.
 */
export async function insertMessages(
  conversationId: string,
  rows: ReadonlyArray<{ side: 'member' | 'staff'; body: string }>,
): Promise<void> {
  const [who] = await sql()<{ tenant_id: string; member: string; staff: string }[]>`
    select c.tenant_id::text as tenant_id, c.created_by_user_id::text as member,
           (select u.id::text from auth.users u where u.email = ${SUPPORT_EMAIL}) as staff
      from public.chat_conversations c where c.id = ${conversationId}::uuid`;
  if (!who) throw new Error(`no conversation ${conversationId}`);
  for (const row of rows) {
    await sql()`
      insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
      values (${who.tenant_id}::uuid, ${conversationId}::uuid,
              ${row.side === 'staff' ? who.staff : who.member}::uuid, ${row.side}, ${row.body})`;
  }
}

/** The messages of a conversation in seq order: `created_at` as ISO, for the tenant-clock case. */
export async function messagesOf(
  conversationId: string,
): Promise<Array<{ seq: number; body: string; createdAt: string }>> {
  return sql()<Array<{ seq: number; body: string; createdAt: string }>>`
    select seq::int as seq, body, to_char(created_at at time zone 'utc',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
      from public.chat_messages where conversation_id = ${conversationId}::uuid order by seq`;
}

/** The member participant's read position (the D-237 dot compares `last_staff_seq` with it). */
export async function memberReadSeq(conversationId: string): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select p.last_read_seq::int as n from public.chat_participants p
      join public.chat_conversations c on c.id = p.conversation_id
     where p.conversation_id = ${conversationId}::uuid and p.user_id = c.created_by_user_id`;
  return row?.n ?? 0;
}

/** Puts the member's read position back (restores the seeded thread after a read-marking visit). */
export async function setMemberReadSeq(conversationId: string, seq: number): Promise<void> {
  await sql()`
    update public.chat_participants p set last_read_seq = ${seq}
      from public.chat_conversations c
     where c.id = p.conversation_id and p.conversation_id = ${conversationId}::uuid
       and p.user_id = c.created_by_user_id`;
}

/* ── 07-10: the staff side ─────────────────────────────────────────────────────────────────────── */

/**
 * A clean staff inbox: every rede-demo support conversation EXCEPT the seeded one is deleted, and the
 * seeded thread's team read position goes back to the seed's (so it is the one "awaiting" thread and
 * the staff count is 1).
 */
export async function resetStaffInbox(): Promise<void> {
  await sql()`
    delete from public.chat_conversations c
     using public.tenants t
     where t.id = c.tenant_id and t.slug = 'rede-demo' and c.kind = 'support'
       and c.id <> ${SEED_SUPPORT_CONVERSATION_ID}::uuid`;
  await setStaffReadSeq(SEED_SUPPORT_CONVERSATION_ID, SEED_STAFF_READ_SEQ);
}

/** Sets the TEAM's shared read position on a conversation (D-225). */
export async function setStaffReadSeq(conversationId: string, seq: number): Promise<void> {
  await sql()`
    update public.chat_conversations set staff_last_read_seq = ${seq}
     where id = ${conversationId}::uuid`;
}

/** Blocks `email`'s membership in `slug` (the admin lane; Phase 8 ships the real action). */
export async function blockMember(email: string, slug = 'rede-demo'): Promise<void> {
  const { tenantId, userId } = await tenantAndUser(email, slug);
  await sql()`
    update public.memberships set status = 'blocked', blocked_at = now()
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`;
}

/** Restores `email`'s membership in `slug` to active. */
export async function unblockMember(email: string, slug = 'rede-demo'): Promise<void> {
  const { tenantId, userId } = await tenantAndUser(email, slug);
  await sql()`
    update public.memberships set status = 'active', blocked_at = null
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`;
}

/** The member's display name in rede-demo, as the staff header and notices print it. */
export async function displayNameOf(email: string): Promise<string> {
  const [row] = await sql()<{ name: string }[]>`
    select mp.display_name as name
      from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
      join public.member_profiles mp on mp.membership_id = m.id
     where u.email = ${email} and t.slug = 'rede-demo' and m.deleted_at is null`;
  if (!row) throw new Error(`no profile for ${email}`);
  return row.name;
}

/**
 * One support conversation with one member message for every ACTIVE rede-demo member except the
 * seeded thread's owner, oldest first, so the inbox has enough rows to scroll (UI-D-264). Returns the
 * new conversation ids.
 */
export async function seedInboxConversations(except: readonly string[] = []): Promise<string[]> {
  const rows = await sql()<{ email: string }[]>`
    select u.email
      from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-demo' and m.role = 'member' and m.status = 'active'
       and m.deleted_at is null and u.email <> 'member@rede-demo.local'
     order by u.email`;
  const ids: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (except.includes(row.email)) continue;
    const id = await ensureConversation(row.email);
    await insertMessages(id, [{ side: 'member', body: `Conversa da caixa ${index + 1}` }]);
    ids.push(id);
  }
  return ids;
}
