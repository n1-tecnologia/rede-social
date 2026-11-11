import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../db/tenant-tx';
import { recordModerationAction } from '../server/moderation/log';

/**
 * 09-07 (D-475): the log writer's `post_removed` variant, without a database. A fake transaction
 * answers the two membership lookups and the insert, and keeps the rendered insert so the test can
 * read the bound parameters in order: tenant, action, actor user, actor membership, target user,
 * target membership, subject type, subject id, reason, excerpt, details.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const ctx = { tenantId: TENANT, userId: ACTOR, requestId: 'req-1' };

function fakeTx() {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const rendered = dialect.sqlToQuery(query);
      if (/insert into moderation_log/.test(rendered.sql)) {
        inserts.push(rendered);
        return [{ id: '55555555-5555-4555-8555-555555555555' }];
      }
      return [{ id: '66666666-6666-4666-8666-666666666666' }];
    },
  } as unknown as Tx;
  return { tx, inserts };
}

describe('recordModerationAction: post_removed (D-475)', () => {
  it('writes subject_type feed_post, the post id, the excerpt of the caption and no reason or details', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'post_removed',
      targetUserId: TARGET,
      subjectType: 'feed_post',
      subjectId: POST,
      excerptSource: '  Uma legenda curta.  ',
      reason: null,
    });
    const params = inserts[0]?.params ?? [];
    expect(params[1]).toBe('post_removed');
    expect(params[6]).toBe('feed_post');
    expect(params[7]).toBe(POST);
    expect(params[8]).toBeNull();
    expect(params[9]).toBe('Uma legenda curta.');
    expect(params[10]).toBeNull();
  });

  it('writes the empty string for a media-only post (an empty caption), never null', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'post_removed',
      targetUserId: TARGET,
      subjectType: 'feed_post',
      subjectId: POST,
      excerptSource: '',
      reason: null,
    });
    expect(inserts[0]?.params[9]).toBe('');
  });

  it('cuts a long caption inside the 280-unit rule', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'post_removed',
      targetUserId: TARGET,
      subjectType: 'feed_post',
      subjectId: POST,
      excerptSource: Array.from({ length: 80 }, () => 'palavra').join(' '),
      reason: null,
    });
    const excerpt = String(inserts[0]?.params[9]);
    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('still writes no subject for a block', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'member_blocked',
      targetUserId: TARGET,
      targetMembershipId: '77777777-7777-4777-8777-777777777777',
      reason: null,
    });
    expect(inserts[0]?.params[6]).toBeNull();
    expect(inserts[0]?.params[7]).toBeNull();
    expect(inserts[0]?.params[9]).toBeNull();
  });
});

describe('recordModerationAction: profile_form_exported (D-595)', () => {
  // The fake transaction answers EVERY membership lookup with this id.
  const SELF_MEMBERSHIP = '66666666-6666-4666-8666-666666666666';

  it('writes the caller as BOTH actor and target, with no subject, excerpt, reason or details', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'profile_form_exported',
      actorMembershipId: SELF_MEMBERSHIP,
    });
    expect(inserts).toHaveLength(1);
    const params = inserts[0]?.params ?? [];
    expect(params[0]).toBe(TENANT);
    expect(params[1]).toBe('profile_form_exported');
    // actor user, actor membership, target user, target membership: the same person twice.
    expect(params[2]).toBe(ACTOR);
    expect(params[3]).toBe(SELF_MEMBERSHIP);
    expect(params[4]).toBe(ACTOR);
    expect(params[5]).toBe(SELF_MEMBERSHIP);
    // subject type, subject id, reason, excerpt, details: all null.
    for (const index of [6, 7, 8, 9, 10]) expect(params[index]).toBeNull();
  });

  it('refuses an actor membership that is not the caller own in this tenant, and writes nothing', async () => {
    const { tx, inserts } = fakeTx();
    await expect(
      recordModerationAction(tx, ctx, {
        action: 'profile_form_exported',
        actorMembershipId: '77777777-7777-4777-8777-777777777777',
      }),
    ).rejects.toThrow(/caller membership/);
    expect(inserts).toHaveLength(0);
  });

  it('a subject cannot be supplied: the variant has no such field (type level) and the row carries none', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'profile_form_exported',
      actorMembershipId: SELF_MEMBERSHIP,
      // @ts-expect-error an export names no subject
      subjectType: 'feed_post',
      subjectId: POST,
    });
    // Even if a caller forced the fields past the compiler, the writer never reads them.
    expect(inserts[0]?.params[6]).toBeNull();
    expect(inserts[0]?.params[7]).toBeNull();
  });
});

describe('recordModerationAction: story_removed, community_archived, community_removed (10-04, D-711)', () => {
  const STORY = '88888888-8888-4888-8888-888888888888';
  const COMMUNITY = '99999999-9999-4999-8999-999999999999';

  it('story_removed writes subject_type story, the story id, the excerpt of the caption and no reason or details', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'story_removed',
      targetUserId: TARGET,
      subjectType: 'story',
      subjectId: STORY,
      excerptSource: '  Legenda do story.  ',
      reason: null,
    });
    expect(inserts).toHaveLength(1);
    const params = inserts[0]?.params ?? [];
    expect(params[1]).toBe('story_removed');
    expect(params[6]).toBe('story');
    expect(params[7]).toBe(STORY);
    expect(params[8]).toBeNull();
    expect(params[9]).toBe('Legenda do story.');
    expect(params[10]).toBeNull();
  });

  it('writes the empty string for a story with no caption, never null', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'story_removed',
      targetUserId: TARGET,
      subjectType: 'story',
      subjectId: STORY,
      excerptSource: '',
      reason: null,
    });
    expect(inserts[0]?.params[9]).toBe('');
  });

  it.each(['community_archived', 'community_removed'] as const)(
    '%s writes subject_type community, the community id and the name as the excerpt',
    async (action) => {
      const { tx, inserts } = fakeTx();
      await recordModerationAction(tx, ctx, {
        action,
        targetUserId: TARGET,
        subjectType: 'community',
        subjectId: COMMUNITY,
        excerptSource: 'Comunidade de teste',
        reason: null,
      });
      const params = inserts[0]?.params ?? [];
      expect(params[1]).toBe(action);
      expect(params[6]).toBe('community');
      expect(params[7]).toBe(COMMUNITY);
      expect(params[9]).toBe('Comunidade de teste');
    },
  );

  it('cuts a long community name inside the 280-unit rule', async () => {
    const { tx, inserts } = fakeTx();
    await recordModerationAction(tx, ctx, {
      action: 'community_removed',
      targetUserId: TARGET,
      subjectType: 'community',
      subjectId: COMMUNITY,
      excerptSource: Array.from({ length: 80 }, () => 'palavra').join(' '),
      reason: null,
    });
    const excerpt = String(inserts[0]?.params[9]);
    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('refuses a subject type that does not belong to the action, writing nothing', async () => {
    const { tx, inserts } = fakeTx();
    await expect(
      recordModerationAction(tx, ctx, {
        action: 'story_removed',
        targetUserId: TARGET,
        // @ts-expect-error a story removal names a story, never a community
        subjectType: 'community',
        subjectId: STORY,
        excerptSource: 'x',
        reason: null,
      }),
    ).rejects.toThrow(/subject/);
    await expect(
      recordModerationAction(tx, ctx, {
        action: 'community_archived',
        targetUserId: TARGET,
        // @ts-expect-error a community action names a community, never a story
        subjectType: 'story',
        subjectId: COMMUNITY,
        excerptSource: 'x',
        reason: null,
      }),
    ).rejects.toThrow(/subject/);
    expect(inserts).toHaveLength(0);
  });

  it('throws, rolling the caller back, when the target has no membership of the tenant', async () => {
    const inserts: unknown[] = [];
    const dialect = new PgDialect();
    const tx = {
      execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const rendered = dialect.sqlToQuery(query);
        if (/insert into moderation_log/.test(rendered.sql)) {
          inserts.push(rendered);
          return [{ id: '55555555-5555-4555-8555-555555555555' }];
        }
        // the actor resolves, the target does not
        return rendered.params.includes(TARGET) ? [] : [{ id: '66666666-6666-4666-8666-666666666666' }];
      },
    } as unknown as Tx;
    await expect(
      recordModerationAction(tx, ctx, {
        action: 'story_removed',
        targetUserId: TARGET,
        subjectType: 'story',
        subjectId: STORY,
        excerptSource: 'x',
        reason: null,
      }),
    ).rejects.toThrow(/no membership/);
    expect(inserts).toHaveLength(0);
  });
});
