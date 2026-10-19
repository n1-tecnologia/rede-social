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
