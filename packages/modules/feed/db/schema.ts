import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The feed's post table (FEED-02, FEED-08) and the module's first table.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **There is no `title` column and no post-kind / classification column** (D-51). One post model, one
 *    `PostCard`, everywhere — feed, post page and (Phase 5) inside a community. A nullable `title`
 *    would be additive if the decision is ever revisited; a type chip is the expensive half (a
 *    per-tenant vocabulary and a brand-derived colour) and is rejected now rather than smuggled into
 *    the schema.
 *
 * 2. **`deleted_at` is deliberately absent from the RLS policy.** Phase 8 moderation must be able to
 *    SEE removed rows through the tenant lane, so the filter lives in the read queries
 *    (`where p.deleted_at is null`), not in `tenantIsolationPolicy`. Moving it into the policy would
 *    silently blind the moderation surface that has not been written yet.
 *
 * 3. **`community_id` participates in the list index on purpose**, even though V1 only ever asks for
 *    `community_id is null`: FEED-02's predicate becomes `community_id in (…)` in Phase 5, and the
 *    index that serves both is `(tenant_id, community_id, created_at desc, id desc)`. It carries NO
 *    foreign key yet — `communities` does not exist until Phase 5, which adds the reference.
 *
 * 4. **`like_count` and `comment_count` are TRIGGER-OWNED** (04-03 adds the triggers). No application
 *    code may update them; a service that does will drift from the rows it is supposed to summarise.
 *    They default to 0 and are declared now so the wire contract never changes.
 *
 * Authorship is the generic `author_user_id -> users.id` (SCHEMA-CONVENTIONS §(c).1, FEED-08): there
 * is no admin-flavoured author column and no admin-only foreign key anywhere. "Only the admin may
 * write" is a PERMISSION VALUE (`tenant_modules['feed'].settings.postingPolicy`), so V2 member posting is a
 * settings flip rather than a migration (V2-CONT-01).
 *
 * Owned by `packages/modules/feed` and picked up by `apps/api/drizzle.config.ts`'s
 * `packages/modules/*​/db/schema.ts` glob.
 */
export const feedPosts = pgTable(
  'feed_posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (FEED-08). Never a role-specific column name, never a role-flavoured boolean. */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    /** Reserved for Phase 5's community feed. No FK yet — `communities` does not exist. */
    communityId: uuid('community_id'),
    /** Plain text with newlines preserved (D-54). URLs are auto-linked at RENDER time, never stored as HTML. */
    caption: text().notNull().default(''),
    /** 'none' | 'gallery' | 'video' — the discriminator 04-04 writes when `feed_post_media` lands. */
    mediaKind: text('media_kind').notNull().default('none'),
    /** Trigger-owned (04-03). Application code never writes these. */
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set on ANY persisted change, media included (FEED-03 / UI-D-15). Renders as "editado". */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // FEED-02's list query verbatim, tie-breaker included, so `(created_at, id)` is a TOTAL order the
    // index carries: a page boundary can neither duplicate nor skip a row.
    index('feed_posts_tenant_community_created_idx').on(
      t.tenantId,
      t.communityId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // "this member's posts" (a profile tab, Phase 8 moderation) without a sequential scan.
    index('feed_posts_tenant_author_idx').on(t.tenantId, t.authorUserId),
    check('feed_posts_media_kind_chk', sql`${t.mediaKind} in ('none','gallery','video')`),
    tenantIsolationPolicy('feed_posts_tenant_isolation'),
  ],
).enableRLS();
