import type { ReportSubjectType } from '@rede-social/contracts/moderation';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 11 plan 16 (D-732, T-11-20, T-11-30): the dispatcher over the six report subjects. The modules' removers are
 * stubbed; the file proves each subject reaches the right one with the right flags, that a message reaches none and
 * answers `not_removable`, and (by `tsc`) that a seventh subject type is a compile error.
 */

const calls: { remover: string; args: unknown[] }[] = [];
const removed = () => ({ outcome: 'removed' as const, afterCommit: () => undefined });

vi.mock('@rede-social/module-feed/server', () => ({
  removeReportedContentInTx: vi.fn(async (_tx: unknown, _ctx: unknown, subject: unknown) => {
    calls.push({ remover: 'feed', args: [subject] });
    return removed();
  }),
}));
vi.mock('@rede-social/module-stories/server', () => ({
  removeReportedStoryInTx: vi.fn(
    async (_tx: unknown, _ctx: unknown, id: string, flags: unknown) => {
      calls.push({ remover: 'story', args: [id, flags] });
      return removed();
    },
  ),
  removeReportedStoryCommentInTx: vi.fn(
    async (_tx: unknown, _ctx: unknown, id: string, flags: unknown) => {
      calls.push({ remover: 'story_comment', args: [id, flags] });
      return removed();
    },
  ),
}));
vi.mock('@rede-social/module-communities/server', () => ({
  archiveReportedCommunityInTx: vi.fn(
    async (_tx: unknown, _ctx: unknown, id: string, flags: unknown) => {
      calls.push({ remover: 'community', args: [id, flags] });
      return removed();
    },
  ),
}));

const { buildReportRemover } = await import('../../src/routes/admin/report-removal');

const tx = {} as Tx;
const ctx = {
  userId: 'u',
  tenantId: 't',
  role: 'admin_tenant',
  requestId: 'r',
  events: [],
} as unknown as RequestContext;
const ID = '11111111-1111-4111-8111-111111111111';
const FLAGS = { canManageStories: true, canManageCommunities: false, canModerate: true };

beforeEach(() => {
  calls.length = 0;
});

describe('buildReportRemover', () => {
  it('routes each of the five removable subjects to the right remover with the right flags', async () => {
    const remove = buildReportRemover(FLAGS);

    await remove(tx, ctx, { type: 'feed_post', id: ID });
    await remove(tx, ctx, { type: 'post_comment', id: ID });
    await remove(tx, ctx, { type: 'story', id: ID });
    await remove(tx, ctx, { type: 'story_comment', id: ID });
    await remove(tx, ctx, { type: 'community', id: ID });

    expect(calls).toEqual([
      { remover: 'feed', args: [{ type: 'feed_post', id: ID }] },
      { remover: 'feed', args: [{ type: 'post_comment', id: ID }] },
      { remover: 'story', args: [ID, { canManage: true, canModerate: true }] },
      { remover: 'story_comment', args: [ID, { canModerate: true }] },
      { remover: 'community', args: [ID, { canManage: false }] },
    ]);
  });

  it('a direct message is not_removable and no remover is called (the chat is append only, D-859)', async () => {
    const answer = await buildReportRemover(FLAGS)(tx, ctx, { type: 'direct_message', id: ID });

    expect(answer.outcome).toBe('not_removable');
    expect(calls).toEqual([]);
    expect(() => answer.afterCommit()).not.toThrow();
  });

  it('passes the flags it was built with: a false flag reaches the remover as false (T-11-20)', async () => {
    const remove = buildReportRemover({
      canManageStories: false,
      canManageCommunities: true,
      canModerate: true,
    });

    await remove(tx, ctx, { type: 'story', id: ID });
    await remove(tx, ctx, { type: 'community', id: ID });

    expect(calls).toEqual([
      { remover: 'story', args: [ID, { canManage: false, canModerate: true }] },
      { remover: 'community', args: [ID, { canManage: true }] },
    ]);
  });

  it('every subject type the contract lists is handled: an unknown one throws instead of removing', async () => {
    const remove = buildReportRemover(FLAGS);
    const unknown = 'chat' as unknown as ReportSubjectType;

    await expect(remove(tx, ctx, { type: unknown, id: ID })).rejects.toThrow(
      /unhandled report subject/,
    );
    expect(calls).toEqual([]);
  });
});
