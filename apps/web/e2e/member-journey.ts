import postgres from 'postgres';
import {
  createCommunityAs,
  createMember,
  deleteReelsFixtures,
  deleteStoriesByCaptionPrefix,
  setMemberDisplayName,
} from './admin';
import { createEmptyFeedTenant, deleteEmptyFeedTenant, type EmptyFeedTenant } from './feed-admin';
import { deleteFollowsOfPrefix, deleteMediaAssetsOfTenant, followMember } from './social-admin';
import { setTenantModuleFlag } from './tenant-fixtures';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeJourneyAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/**
 * The throwaway tenant the Phase 10 browser journeys run on (10-15).
 *
 * Why not rede-lab: the seed keeps `communities` and `stories` OFF there (and a member's create
 * controls need `social` AND the owning module), and the API and the web tier cache a tenant's
 * module flags for 30 s, so flipping the shared seed tenant mid-suite would corrupt every spec that
 * runs after it. A throwaway tenant gets its flags written BEFORE any session exists, so nothing is
 * ever cached stale, and it leaves the seed exactly as it was found.
 *
 * What it holds: `feed`, `stories`, `communities` and `social` on; an administrator; three members
 * (the author, a follower of the author, a stranger who follows nobody); one ORGANIZATION community
 * (so "the member community comes after the organization's cards" says something); and the follow
 * edge follower -> author. Fixtures only, never used by application code.
 */

export const JOURNEY_PREFIX = 'e2e-10-';

export type JourneyTenant = EmptyFeedTenant & {
  author: { email: string; name: string };
  follower: { email: string; name: string };
  stranger: { email: string; name: string };
  orgCommunityName: string;
  displayName: string;
};

/** A per-project, per-run slug: the web tier and the API cache a host lookup for 60 s (07-13 note). */
export function journeySlug(tag: string, project: string, run: string): string {
  const projectPart = project.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return `mj-${tag}-${projectPart}-${run}`.slice(0, 40);
}

export async function provisionJourneyTenant(
  slug: string,
  password: string,
): Promise<JourneyTenant> {
  const base = await createEmptyFeedTenant(slug, password);
  // Flags before any session exists (the 30 s cache, see above).
  for (const key of ['stories', 'communities', 'social']) {
    await setTenantModuleFlag(slug, key, true);
  }
  const people = {
    author: { email: `autora@${slug}.local`, name: 'Autora Jornada' },
    follower: { email: `seguidor@${slug}.local`, name: 'Seguidor Jornada' },
    stranger: { email: `estranho@${slug}.local`, name: 'Estranho Jornada' },
  };
  for (const person of Object.values(people)) {
    await createMember(person.email, password, slug, 'member');
    await setMemberDisplayName(person.email, slug, person.name);
  }
  await followMember(people.follower.email, people.author.email, slug);
  const orgCommunityName = `${JOURNEY_PREFIX}org ${slug}`;
  await createCommunityAs(base.adminEmail, slug, orgCommunityName, { minutesAgo: 5 });
  return { ...base, ...people, orgCommunityName, displayName: `Comunidade ${slug}` };
}

/**
 * Takes the tenant, its memberships and the GoTrue users out. The content goes first, by prefix (a
 * member community's posts name it, `feed_posts.community_id` has no `ON DELETE`), then the
 * moderation rows the journey wrote: the log is append-only, so a scoped delete needs
 * `session_replication_role = replica` (the 10-10 pattern) and the tenant delete would otherwise be
 * refused by the same trigger.
 */
export async function dropJourneyTenant(tenant: JourneyTenant | null): Promise<void> {
  if (!tenant) return;
  await deleteReelsFixtures(JOURNEY_PREFIX);
  await deleteStoriesByCaptionPrefix(JOURNEY_PREFIX);
  await deleteMediaAssetsOfTenant(tenant.slug);
  await sql().begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx`
      delete from public.moderation_log l
       using public.tenants t
       where t.id = l.tenant_id and t.slug = ${tenant.slug}`;
  });
  await deleteFollowsOfPrefix('seguidor@mj-');
  await deleteEmptyFeedTenant(tenant.slug);
}

/**
 * A live MEMBER story written directly: one `ready` image asset (variants named but never uploaded,
 * so a circle draws its neutral frame; the row and the circle's name are what a spec reads from it,
 * not the pixels) and the story with `visibility = 'followers'` (D-714), in ONE transaction. Returns
 * the story id; `dropJourneyTenant` removes it by caption prefix.
 */
export async function createMemberStoryAs(
  email: string,
  tenantSlug: string,
  caption: string,
): Promise<string> {
  return sql().begin(async (tx) => {
    const assets = await tx<{ id: string; tenant_id: string; owner_user_id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
         variant_widths, filename, ready_at)
      select t.id, u.id, 'image', 'story', 'ready', 'supabase', 'image/jpeg', 204800, 1080, 1920,
             array[640, 1080], 'story.jpg', now()
        from public.tenants t, public.users u
       where t.slug = ${tenantSlug} and u.email = ${email}
      returning id, tenant_id, owner_user_id`;
    const asset = assets[0];
    if (!asset) throw new Error(`could not create a story asset for ${email} in ${tenantSlug}`);
    const stories = await tx<{ id: string }[]>`
      insert into public.stories
        (tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at,
         expires_at)
      values (${asset.tenant_id}::uuid, ${asset.owner_user_id}::uuid, ${asset.id}::uuid, 'image',
              ${caption}, 'followers', now(), now() + interval '24 hours')
      returning id`;
    const story = stories[0];
    if (!story) throw new Error(`could not create a member story for ${email} in ${tenantSlug}`);
    return story.id;
  });
}

/**
 * A MEMBER community written directly (`kind = 'member'`, the fixed position 1000000 the check
 * constraint demands, `status = 'active'`), created by `email`. The moderation and switch journeys
 * start from one without driving the creator's form again. Returns the id; `dropJourneyTenant`
 * removes it by name prefix (so the name must start with `JOURNEY_PREFIX`).
 */
export async function createMemberCommunityAs(
  email: string,
  tenantSlug: string,
  name: string,
): Promise<string> {
  const slug = `${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await sql()<{ id: string }[]>`
    insert into public.communities
      (tenant_id, created_by_user_id, kind, name, slug, status, position)
    select t.id, u.id, 'member', ${name}, ${slug}, 'active', 1000000
      from public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create a member community "${name}" in ${tenantSlug}`);
  return id;
}

/**
 * A highlight of a member community holding one story: the row the creator's curation writes
 * (`story_highlights` with the community, one `story_highlight_items`), created by `email`. Removed
 * with its community (both cascade).
 */
export async function createCommunityHighlightWith(
  email: string,
  tenantSlug: string,
  communityId: string,
  title: string,
  storyId: string,
): Promise<string> {
  return sql().begin(async (tx) => {
    const rows = await tx<{ id: string; tenant_id: string; user_id: string }[]>`
      insert into public.story_highlights
        (tenant_id, community_id, title, position, created_by_user_id)
      select t.id, ${communityId}::uuid, ${title}, 0, u.id
        from public.tenants t, public.users u
       where t.slug = ${tenantSlug} and u.email = ${email}
      returning id, tenant_id, created_by_user_id as user_id`;
    const highlight = rows[0];
    if (!highlight) throw new Error(`could not create the highlight "${title}" in ${tenantSlug}`);
    await tx`
      insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
      values (${highlight.tenant_id}::uuid, ${highlight.id}::uuid, ${storyId}::uuid,
              ${highlight.user_id}::uuid)`;
    return highlight.id;
  });
}
