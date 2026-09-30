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

async function tenantAndUser(email: string): Promise<{ tenantId: string; userId: string }> {
  const [row] = await sql()<{ tenant_id: string; user_id: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id
      from public.tenants t, auth.users u
     where t.slug = 'rede-demo' and u.email = ${email}`;
  if (!row) throw new Error(`no ${email} in rede-demo`);
  return { tenantId: row.tenant_id, userId: row.user_id };
}

/** Deletes `email`'s support conversation (participants and messages cascade): the greeting again. */
export async function resetMemberConversation(email: string): Promise<void> {
  const { tenantId, userId } = await tenantAndUser(email);
  await sql()`
    delete from public.chat_conversations
     where tenant_id = ${tenantId}::uuid and kind = 'support' and created_by_user_id = ${userId}::uuid`;
}

/**
 * `email`'s support conversation, created empty as the migration role when missing (the seed's own
 * shape: the conversation row plus the member's participant row). Returns its id.
 */
export async function ensureConversation(email: string): Promise<string> {
  const { tenantId, userId } = await tenantAndUser(email);
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
