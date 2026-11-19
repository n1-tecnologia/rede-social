import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  directConversationLimiter,
  directMessageLimiter,
} from '@rede-social/core/server/safety/limits';
import { caseKit, post, request, throwawayMember } from './chat-case-fixtures';
import {
  adminSql,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  signInAs,
  type ToggleableInTests,
  withModuleEnabled,
} from './setup';

/**
 * Fixtures of the direct-conversation suites (Phase 11 plan 08), on top of `chat-case-fixtures.ts`.
 *
 * THE SEED SPLITS THE MODULES: rede-demo has `chat` and `notifications` and no `social`, rede-lab has `social` and no
 * `chat`. Every direct suite therefore turns the modules it needs on for its span (`withDirectModules`) and puts them
 * back. Members are THROWAWAYS (the seeded members carry follows, stories and a support thread other suites count), each
 * with a display name so the name projects, and `removeDirectRows` deletes the pair rows before the users go.
 */

export type DirectMember = {
  userId: string;
  token: string;
  membershipId: string;
  displayName: string;
};

/** The password the throwaway users of `chat-case-fixtures.ts` are created with. */
const THROWAWAY_PASSWORD = 'Segredo123';

/** Every user id this kit made, for the sweep (`removeDirectRows` runs before `removeThrowaways`). */
const made: string[] = [];

/** Turns the listed modules ON for a seed host and returns the one function that puts every one back. */
export async function withDirectModules(
  host: keyof typeof HOSTS,
  keys: ToggleableInTests[] = ['social', 'chat'],
): Promise<() => Promise<void>> {
  const restores: (() => Promise<void>)[] = [];
  for (const key of keys) restores.push(await withModuleEnabled(host, key));
  return async () => {
    for (const restore of restores.reverse()) await restore();
  };
}

/** Writes one module row of a seed tenant (on or off) and drops the flags cache; returns the way back. */
export async function setModule(
  host: keyof typeof HOSTS,
  key: ToggleableInTests,
  enabled: boolean,
): Promise<() => Promise<void>> {
  const [tenant] = await adminSql<{ id: string }[]>`
    select d.tenant_id::text as id from public.tenant_domains d
     where d.host = ${HOSTS[host]} and d.verified_at is not null limit 1`;
  if (!tenant) throw new Error(`no verified tenant behind ${HOSTS[host]}`);
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenant.id}::uuid and module_key = ${key}`;
  const write = async (value: boolean | null) => {
    if (value === null) {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenant.id}::uuid and module_key = ${key}`;
    } else {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenant.id}::uuid, ${key}, ${value})
        on conflict (tenant_id, module_key) do update set enabled = ${value}, updated_at = now()`;
    }
    moduleFlags.invalidate(tenant.id);
  };
  await write(enabled);
  return () => write(previous ? previous.enabled : null);
}

/** Every direct send limiter starts the case unspent, and the next file inherits nothing. */
export function resetDirectLimiters(): void {
  directMessageLimiter.reset();
  directConversationLimiter.reset();
}

/**
 * A fresh live `member` of the demo tenant, signed in, WITH a display name (so `other.displayName` and the author
 * projections have a value). `role` makes a staff caller for the 403 cases.
 */
export async function directMember(
  label: string,
  options: { role?: 'member' | 'support_tenant' | 'admin_tenant'; displayName?: string } = {},
): Promise<DirectMember> {
  const created = await throwawayMember(label, options.role ?? 'member');
  made.push(created.id);
  const displayName = options.displayName ?? `Direto ${label}`;
  const { ids } = await caseKit();
  const [membership] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where tenant_id = ${ids.demo}::uuid and user_id = ${created.id}::uuid`;
  if (!membership) throw new Error(`no membership for ${label}`);
  const updated = await adminSql`
    update public.member_profiles set display_name = ${displayName}
     where membership_id = ${membership.id}::uuid`;
  if (updated.count === 0) {
    await adminSql`
      insert into public.member_profiles (tenant_id, membership_id, user_id, display_name)
      values (${ids.demo}::uuid, ${membership.id}::uuid, ${created.id}::uuid, ${displayName})`;
  }
  return { userId: created.id, token: created.token, membershipId: membership.id, displayName };
}

/** A shared identity: one member in the demo tenant and one in the lab tenant (same user, two memberships). */
export async function sharedDirectIdentity(prefix: string): Promise<{
  userId: string;
  email: string;
  demo: { token: string; membershipId: string };
  lab: { token: string; membershipId: string };
}> {
  const identity = await createSharedIdentity({
    prefix,
    memberships: [
      { host: 'demo', displayName: `Dupla ${prefix} demo` },
      { host: 'lab', displayName: `Dupla ${prefix} lab` },
    ],
  });
  const token = await signInAs(identity.email, identity.password);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select m.id::text as id, t.slug
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where m.user_id = ${identity.userId}::uuid`;
  const idOf = (slug: string) => rows.find((row) => row.slug === slug)?.id ?? '';
  return {
    userId: identity.userId,
    email: identity.email,
    demo: { token, membershipId: idOf('rede-demo') },
    lab: { token, membershipId: idOf('rede-lab') },
  };
}

/** The tenant's host header for the lab, for the shared identity's second session. */
export const requestOn = (
  host: keyof typeof HOSTS,
  path: string,
  token: string,
  init?: RequestInit,
) =>
  request(path, token, {
    ...init,
    headers: { 'x-tenant-host': HOSTS[host], ...((init?.headers as Record<string, string>) ?? {}) },
  });

/** `POST /v1/chat/direct/messages`. */
export const sendDirect = (from: { token: string }, toMembershipId: string, body: string) =>
  post('/v1/chat/direct/messages', from.token, { toMembershipId, body });

/** `GET /v1/chat/direct/with/{membershipId}`. */
export const directWith = (from: { token: string }, membershipId: string) =>
  request(`/v1/chat/direct/with/${membershipId}`, from.token);

/** The block of `blockedUserId` by the holder of `token` (`POST /v1/blocks`). */
export const blockUser = (token: string, blockedUserId: string) =>
  post('/v1/blocks', token, { userId: blockedUserId });

/** Lifts the same block (`DELETE /v1/blocks/{userId}`). */
export const unblockUser = (token: string, blockedUserId: string) =>
  request(`/v1/blocks/${blockedUserId}`, token, { method: 'DELETE' });

/** The direct conversations of a pair, read as the table owner (`least` and `greatest` on the uuid type). */
export async function directRowsOf(
  a: string,
  b: string,
): Promise<{ id: string; created_by_user_id: string; messages: number; participants: number }[]> {
  return adminSql<
    { id: string; created_by_user_id: string; messages: number; participants: number }[]
  >`
    select c.id::text as id, c.created_by_user_id::text as created_by_user_id,
           (select count(*)::int from public.chat_messages m where m.conversation_id = c.id) as messages,
           (select count(*)::int from public.chat_participants p where p.conversation_id = c.id) as participants
      from public.chat_conversations c
     where c.kind = 'direct'
       and c.direct_low_user_id = least(${a}::uuid, ${b}::uuid)
       and c.direct_high_user_id = greatest(${a}::uuid, ${b}::uuid)`;
}

/** The count of direct conversations that name this user (a sweep guard for "nothing was written"). */
export async function directCountOf(userId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.chat_conversations c
     where c.kind = 'direct'
       and (c.direct_low_user_id = ${userId}::uuid or c.direct_high_user_id = ${userId}::uuid)`;
  return row?.n ?? 0;
}

/**
 * Deletes the pair rows of every user this kit made (messages, then conversations, which cascade the participants),
 * their member blocks, and the shared identities of the given prefixes. Run it BEFORE `removeThrowaways`.
 */
export async function removeDirectRows(sharedPrefixes: string[] = []): Promise<void> {
  const ids = made.splice(0);
  if (ids.length > 0) {
    await adminSql`
      delete from public.chat_messages
       where conversation_id in (
         select id from public.chat_conversations c
          where c.kind = 'direct'
            and (c.direct_low_user_id = any(${ids}::uuid[]) or c.direct_high_user_id = any(${ids}::uuid[])))`;
    await adminSql`
      delete from public.chat_conversations c
       where c.kind = 'direct'
         and (c.direct_low_user_id = any(${ids}::uuid[]) or c.direct_high_user_id = any(${ids}::uuid[]))`;
    await adminSql`
      delete from public.member_blocks
       where blocker_user_id = any(${ids}::uuid[]) or blocked_user_id = any(${ids}::uuid[])`;
  }
  for (const prefix of sharedPrefixes) {
    const shared = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email like ${`${prefix}-%`}`;
    const sharedIds = shared.map((row) => row.id);
    if (sharedIds.length > 0) {
      await adminSql`
        delete from public.chat_messages
         where conversation_id in (
           select id from public.chat_conversations c
            where c.kind = 'direct'
              and (c.direct_low_user_id = any(${sharedIds}::uuid[])
                or c.direct_high_user_id = any(${sharedIds}::uuid[])))`;
      await adminSql`
        delete from public.chat_conversations c
         where c.kind = 'direct'
           and (c.direct_low_user_id = any(${sharedIds}::uuid[])
             or c.direct_high_user_id = any(${sharedIds}::uuid[]))`;
      await adminSql`
        delete from public.member_blocks
         where blocker_user_id = any(${sharedIds}::uuid[]) or blocked_user_id = any(${sharedIds}::uuid[])`;
    }
    await removeIdentitiesByPrefix(prefix);
  }
}

export { THROWAWAY_PASSWORD };
