import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../db/tenant-tx';
import {
  COMMUNITY_ACTIONS,
  type CommunityAction,
  communityActionAllowed,
} from '../server/communities/action-gate';

/**
 * 10-05 (the Escopo seam, no behaviour change): the kernel wrapper over `app.community_action_allowed`,
 * without a database. A fake transaction renders the statement and answers whatever the case needs, so
 * the test reads what reaches Postgres (the community id and the action text) and what comes back.
 * The SQL stub itself (constant false, every lane) is pinned by pgTAP 230 section 9.
 */
const COMMUNITY = '44444444-4444-4444-8444-444444444444';

function fakeTx(answer: unknown[]) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      seen.push(dialect.sqlToQuery(query));
      return answer;
    },
  } as unknown as Tx;
  return { tx, seen };
}

describe('communityActionAllowed (the reserved third branch of the post owner decision)', () => {
  it('has exactly the five reserved action names, in the order of the SQL stub comment', () => {
    expect([...COMMUNITY_ACTIONS]).toEqual(['like', 'comment', 'share', 'post', 'story']);
  });

  it('is true only for a literal true answer of the statement', async () => {
    const { tx } = fakeTx([{ allowed: true }]);
    await expect(communityActionAllowed(tx, COMMUNITY, 'post')).resolves.toBe(true);
  });

  it('is false for false, null, an empty result and any truthy non-boolean', async () => {
    for (const answer of [
      [{ allowed: false }],
      [{ allowed: null }],
      [],
      [{}],
      [{ allowed: 't' }],
      [{ allowed: 1 }],
    ]) {
      const { tx } = fakeTx(answer);
      await expect(communityActionAllowed(tx, COMMUNITY, 'post')).resolves.toBe(false);
    }
  });

  it('hands the community id and the action text to app.community_action_allowed, and nothing else', async () => {
    for (const action of COMMUNITY_ACTIONS as readonly CommunityAction[]) {
      const { tx, seen } = fakeTx([{ allowed: false }]);
      await communityActionAllowed(tx, COMMUNITY, action);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.sql).toContain('app.community_action_allowed(');
      // No user id parameter on purpose: the SQL function answers about the lane's own session.
      expect(seen[0]?.params).toEqual([COMMUNITY, action]);
    }
  });
});
