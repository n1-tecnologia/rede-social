import postgres from 'postgres';
import {
  createMember,
  deleteReelsFixtures,
  deleteStoriesByCaptionPrefix,
  envValue,
  membershipIdFor,
  setMemberDisplayName,
} from './admin';
import { createEmptyFeedTenant, deleteEmptyFeedTenant, type EmptyFeedTenant } from './feed-admin';
import { deleteFollowsOfPrefix, deleteMediaAssetsOfTenant } from './social-admin';
import { setTenantModuleFlag } from './tenant-fixtures';

/**
 * Fixtures for the Phase 11 specs (`direct-chat.spec.ts`, `safety.spec.ts`; plan 11-26): a THROWAWAY tenant with the
 * modules a direct conversation, a block and a report need, its people, and the writes a spec makes through the
 * REAL API (so the triggers, the riders and the notifications run exactly as for a member) or through the admin lane.
 *
 * **Why a throwaway tenant and not rede-demo.** The seed keeps `social` OFF in rede-demo and `chat` OFF in rede-lab,
 * the API and the web tier cache a tenant's module flags for 30 s, and the seeded members and the seeded support
 * thread are shared by the whole suite. A throwaway tenant gets its flags written BEFORE any session exists (nothing
 * is ever cached stale), never touches a seeded row and takes everything it wrote away in `dropDirectTenant`, so the
 * flags of the seed tenants are found exactly as they were left (T-11-38).
 *
 * Everything here is fixtures only, never used by application code. Accounts are `.local` throwaways with the shared
 * seed password read from the environment by the caller; no token is ever printed (T-11-39).
 */

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeDirectAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

export type Person = { email: string; name: string };

export type DirectTenant = EmptyFeedTenant & {
  displayName: string;
  /** Three plain members. */
  ana: Person;
  bia: Person;
  caio: Person;
  /** The tenant's support user (`support_tenant`): never takes part in a direct conversation. */
  support: Person;
  /** A second administrator, for the "two administrators resolve one report" case. */
  admin2: Person;
  /** The first administrator (the one `createEmptyFeedTenant` made). */
  admin: Person;
};

export type DirectTenantOptions = {
  /** `social` on (default true): the direct conversation needs it. */
  social?: boolean;
  /** Also turn on the modules a report can name (stories, communities). Default true. */
  content?: boolean;
};

/** A per-project, per-run slug: the web tier and the API cache a host lookup for 60 s (07-13 note). */
export function directSlug(tag: string, project: string, run: string): string {
  const projectPart = project.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return `dm-${tag}-${projectPart}-${run}`.slice(0, 40);
}

/** Every caption, community name and story caption a spec writes starts with this; the drop removes by it. */
export const DIRECT_PREFIX = 'e2e-11-';

/**
 * A tenant with `chat`, `notifications` and (by default) `social`, `stories` and `communities` ON, an administrator, a
 * second administrator, the support user and three members, each with a deliberate display name. The flags go in
 * before any session exists.
 */
export async function provisionDirectTenant(
  slug: string,
  password: string,
  options: DirectTenantOptions = {},
): Promise<DirectTenant> {
  const social = options.social ?? true;
  const content = options.content ?? true;
  const base = await createEmptyFeedTenant(slug, password);
  const keys = ['chat', 'notifications', ...(social ? ['social'] : [])];
  if (content) keys.push('stories', 'communities');
  for (const key of keys) await setTenantModuleFlag(slug, key, true);

  const people = {
    ana: { email: `ana@${slug}.local`, name: 'Ana Direta' },
    bia: { email: `bia@${slug}.local`, name: 'Bia Direta' },
    caio: { email: `caio@${slug}.local`, name: 'Caio Direto' },
  };
  for (const person of Object.values(people)) {
    await createMember(person.email, password, slug, 'member');
    await setMemberDisplayName(person.email, slug, person.name);
  }
  const support = { email: `suporte@${slug}.local`, name: 'Suporte Direto' };
  await createMember(support.email, password, slug, 'support_tenant');
  await setMemberDisplayName(support.email, slug, support.name);
  const admin2 = { email: `admin2@${slug}.local`, name: 'Segundo Admin' };
  await createMember(admin2.email, password, slug, 'admin_tenant');
  await setMemberDisplayName(admin2.email, slug, admin2.name);

  return {
    ...base,
    ...people,
    support,
    admin2,
    admin: { email: base.adminEmail, name: 'Admin Sem Publicacoes' },
    displayName: `Comunidade ${slug}`,
  };
}

/**
 * Takes a throwaway tenant and everything it holds away. Order is forced by the foreign keys that do not cascade:
 * the conversations first (their messages, participants and case events cascade), then the rows keyed only by the
 * tenant (case counters, notifications, push subscriptions), then the append-only moderation log (a scoped delete
 * needs `session_replication_role = replica`, the 10-10 pattern), then the content by prefix and the media assets,
 * then the tenant, its memberships and its users. Reports, blocks and follows cascade from the tenant.
 */
export async function dropDirectTenant(tenant: DirectTenant | null): Promise<void> {
  if (!tenant) return;
  const slug = tenant.slug;
  await sql()`
    delete from public.chat_conversations c using public.tenants t
     where t.id = c.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.chat_case_counters c using public.tenants t
     where t.id = c.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.notifications n using public.tenants t
     where t.id = n.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.push_subscriptions p using public.tenants t
     where t.id = p.tenant_id and t.slug = ${slug}`;
  await sql().begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx`
      delete from public.moderation_log l using public.tenants t
       where t.id = l.tenant_id and t.slug = ${slug}`;
  });
  await deleteReelsFixtures(DIRECT_PREFIX);
  await deleteStoriesByCaptionPrefix(DIRECT_PREFIX);
  await deleteMediaAssetsOfTenant(slug);
  await deleteFollowsOfPrefix(`ana@dm-`);
  await deleteEmptyFeedTenant(slug);
}

/**
 * A clean slate between two cases of one spec, scoped to the throwaway tenant only: its direct conversations (the
 * messages and participants cascade), then the voice recordings they named, the member blocks, the follow edges and
 * the bell rows, and every membership back to `active`. It touches no other tenant, no seeded member and no seeded
 * thread, and it never resets or seeds the database.
 */
export async function resetDirectState(tenant: DirectTenant): Promise<void> {
  const slug = tenant.slug;
  await sql()`
    delete from public.chat_conversations c using public.tenants t
     where t.id = c.tenant_id and t.slug = ${slug} and c.kind = 'direct'`;
  await sql()`
    delete from public.media_assets a using public.tenants t
     where t.id = a.tenant_id and t.slug = ${slug} and a.purpose = 'voice'`;
  await sql()`
    delete from public.member_blocks b using public.tenants t
     where t.id = b.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.social_follows f using public.tenants t
     where t.id = f.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.notifications n using public.tenants t
     where t.id = n.tenant_id and t.slug = ${slug}`;
  await sql()`
    update public.memberships m set status = 'active', blocked_at = null
      from public.tenants t
     where t.id = m.tenant_id and t.slug = ${slug} and m.status = 'blocked'`;
}

/* ── the real API, as a member ─────────────────────────────────────────────────────────────────────── */

async function accessToken(email: string, password: string): Promise<string> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  return ((await session.json()) as { access_token: string }).access_token;
}

async function apiAs(
  tenant: DirectTenant,
  email: string,
  method: 'POST' | 'DELETE' | 'GET',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const token = await accessToken(email, tenant.password);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': `${tenant.slug}.localhost`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** The member's membership id in the tenant (what the profile URL and the API name a person by). */
export function membershipOf(tenant: DirectTenant, person: Person): Promise<string> {
  return membershipIdFor(person.email, tenant.slug);
}

/** A direct message through the REAL API; creates the pair's conversation lazily. Returns its id. */
export async function sendDirectAs(
  tenant: DirectTenant,
  from: Person,
  to: Person,
  body: string,
): Promise<string> {
  const toMembershipId = await membershipOf(tenant, to);
  const res = await apiAs(tenant, from.email, 'POST', '/v1/chat/direct/messages', {
    toMembershipId,
    body,
  });
  if (res.status !== 201)
    throw new Error(`direct send ${from.email} -> ${to.email}: ${res.status}`);
  return (res.json as { conversationId: string }).conversationId;
}

/** A report through the REAL API (the excerpt, the author and the moderators' bell row are the API's). */
export async function reportAs(
  tenant: DirectTenant,
  reporter: Person,
  subjectType:
    | 'feed_post'
    | 'post_comment'
    | 'story'
    | 'story_comment'
    | 'community'
    | 'direct_message',
  subjectId: string,
  reason: 'offensive' | 'harassment' | 'spam' | 'sexual_violent' | 'other' = 'spam',
): Promise<string> {
  const res = await apiAs(tenant, reporter.email, 'POST', '/v1/reports', {
    subjectType,
    subjectId,
    reason,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`report ${subjectType} as ${reporter.email}: ${res.status}`);
  }
  return (res.json as { id: string }).id;
}

/** A member blocks another through the REAL API (the effects on follows and conversations are the database's). */
export async function blockAs(
  tenant: DirectTenant,
  blocker: Person,
  target: Person,
): Promise<void> {
  const membershipId = await membershipOf(tenant, target);
  const res = await apiAs(tenant, blocker.email, 'POST', `/v1/blocks/members/${membershipId}`);
  if (res.status !== 200)
    throw new Error(`block ${blocker.email} -> ${target.email}: ${res.status}`);
}

/** Lifts that block through the REAL API. */
export async function unblockAs(
  tenant: DirectTenant,
  blocker: Person,
  target: Person,
): Promise<void> {
  const membershipId = await membershipOf(tenant, target);
  const res = await apiAs(tenant, blocker.email, 'DELETE', `/v1/blocks/members/${membershipId}`);
  if (res.status !== 200) {
    throw new Error(`unblock ${blocker.email} -> ${target.email}: ${res.status}`);
  }
}

/* ── what the database says (for a spec to confirm what the screens drew) ───────────────────────────── */

async function userIdOf(slug: string, email: string): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    select u.id::text as id from public.users u
      join public.memberships m on m.user_id = u.id
      join public.tenants t on t.id = m.tenant_id
     where u.email = ${email} and t.slug = ${slug}`;
  if (!row) throw new Error(`no ${email} in ${slug}`);
  return row.id;
}

/** The id of the pair's direct conversation, or `null` when none exists. */
export async function conversationBetween(
  tenant: DirectTenant,
  one: Person,
  other: Person,
): Promise<string | null> {
  const a = await userIdOf(tenant.slug, one.email);
  const b = await userIdOf(tenant.slug, other.email);
  const [row] = await sql()<{ id: string }[]>`
    select c.id::text as id from public.chat_conversations c
      join public.tenants t on t.id = c.tenant_id
     where t.slug = ${tenant.slug} and c.kind = 'direct'
       and c.direct_low_user_id in (${a}::uuid, ${b}::uuid)
       and c.direct_high_user_id in (${a}::uuid, ${b}::uuid)`;
  return row?.id ?? null;
}

/** How many direct conversations the tenant holds (the "none" case of a member with nothing). */
export async function directConversationCount(tenant: DirectTenant): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from public.chat_conversations c
      join public.tenants t on t.id = c.tenant_id
     where t.slug = ${tenant.slug} and c.kind = 'direct'`;
  return row?.n ?? 0;
}

/** The ids of a conversation's messages in `seq` order (to report one through the API). */
export async function messageIdsOf(conversationId: string): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    select id::text as id from public.chat_messages
     where conversation_id = ${conversationId}::uuid order by seq`;
  return rows.map((row) => row.id);
}

/** True while `blocker` has a member block on `blocked` in the tenant. */
export async function memberBlockExists(
  tenant: DirectTenant,
  blocker: Person,
  blocked: Person,
): Promise<boolean> {
  const a = await userIdOf(tenant.slug, blocker.email);
  const b = await userIdOf(tenant.slug, blocked.email);
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from public.member_blocks mb
      join public.tenants t on t.id = mb.tenant_id
     where t.slug = ${tenant.slug} and mb.blocker_user_id = ${a}::uuid
       and mb.blocked_user_id = ${b}::uuid`;
  return (row?.n ?? 0) > 0;
}

/** True while `follower` follows `followee` in the tenant. */
export async function followEdgeExists(
  tenant: DirectTenant,
  follower: Person,
  followee: Person,
): Promise<boolean> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n
      from public.social_follows f
      join public.tenants t on t.id = f.tenant_id
      join public.users a on a.id = f.follower_user_id
      join public.users b on b.id = f.followee_user_id
     where t.slug = ${tenant.slug} and a.email = ${follower.email} and b.email = ${followee.email}`;
  return (row?.n ?? 0) > 0;
}

/** The stored status of a report (`open`, `dismissed`, `content_removed`, `author_blocked`). */
export async function reportStatusOf(reportId: string): Promise<string> {
  const [row] = await sql()<{ status: string }[]>`
    select status from public.content_reports where id = ${reportId}::uuid`;
  if (!row) throw new Error(`no report ${reportId}`);
  return row.status;
}

/** The stored status of a community (`active` or `archived`). */
export async function communityStatusOf(communityId: string): Promise<string> {
  const [row] = await sql()<{ status: string }[]>`
    select status from public.communities where id = ${communityId}::uuid`;
  if (!row) throw new Error(`no community ${communityId}`);
  return row.status;
}

/** True once a feed comment carries its removal stamp. */
export async function commentIsRemoved(commentId: string): Promise<boolean> {
  const [row] = await sql()<{ removed: boolean }[]>`
    select (deleted_at is not null) as removed from public.feed_comments where id = ${commentId}::uuid`;
  return row?.removed ?? false;
}

/** The moderation log actions of the tenant, newest first. */
export async function moderationActionsOf(tenant: DirectTenant): Promise<string[]> {
  const rows = await sql()<{ action: string }[]>`
    select l.action from public.moderation_log l
      join public.tenants t on t.id = l.tenant_id
     where t.slug = ${tenant.slug}
     order by l.created_at desc`;
  return rows.map((row) => row.action);
}

/** How many reports of one subject type the tenant holds (open or not). */
export async function reportCountOf(tenant: DirectTenant, subjectType: string): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from public.content_reports r
      join public.tenants t on t.id = r.tenant_id
     where t.slug = ${tenant.slug} and r.subject_type = ${subjectType}`;
  return row?.n ?? 0;
}
