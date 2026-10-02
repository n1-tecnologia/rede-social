import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  commentRemovalSchema,
  KERNEL_PERMISSIONS,
  MODERATION_ACTIONS,
  MODERATION_EXCERPT_MAX,
  MODERATION_LOG_MAX_CURSOR_LENGTH,
  MODERATION_LOG_MAX_PAGE_SIZE,
  MODERATION_LOG_PAGE_SIZE,
  MODERATION_REASON_MAX,
  MODERATION_SUBJECT_TYPES,
  moderationLogEntrySchema,
  moderationLogPageSchema,
  moderationLogQuerySchema,
} from '../src/moderation';

/**
 * 08-01: the moderation vocabulary is the `moderation_log` CHECK constraints (D-337, reversibility
 * costly). These assertions pin the exact lists so a widening has to touch the migration AND this file.
 */
describe('moderation vocabulary', () => {
  it('fixes the four actions and the two subject types the table CHECKs carry', () => {
    expect(MODERATION_ACTIONS).toEqual([
      'comment_removed',
      'member_blocked',
      'member_unblocked',
      'role_changed',
    ]);
    expect(MODERATION_SUBJECT_TYPES).toEqual(['post_comment', 'story_comment']);
    expect(MODERATION_EXCERPT_MAX).toBe(280);
    expect(MODERATION_REASON_MAX).toBe(500);
  });

  it('names the kernel permissions as values, moderation.manage among them (D-338)', () => {
    expect(KERNEL_PERMISSIONS).toEqual({
      tenantManage: 'tenant.manage',
      membersManage: 'members.manage',
      moderationManage: 'moderation.manage',
    });
  });

  it('the removal enum is own | moderation | null and nothing else', () => {
    expect(commentRemovalSchema.parse('own')).toBe('own');
    expect(commentRemovalSchema.parse('moderation')).toBe('moderation');
    expect(commentRemovalSchema.parse(null)).toBeNull();
    expect(commentRemovalSchema.safeParse('admin').success).toBe(false);
  });

  it('an OPTIONAL removal in a strict row parses a payload without the key (release order)', () => {
    // The shape the feed's `commentSchema` uses: an API that predates Phase 8 sends no `removal`.
    const row = z.object({ id: z.string(), removal: commentRemovalSchema.optional() }).strict();
    expect(row.parse({ id: 'a' })).toEqual({ id: 'a' });
    expect(row.parse({ id: 'a', removal: 'moderation' }).removal).toBe('moderation');
  });
});

describe('moderationLogQuerySchema', () => {
  it('defaults the limit and clamps it into 1..50 instead of refusing', () => {
    expect(moderationLogQuerySchema.parse({}).limit).toBe(MODERATION_LOG_PAGE_SIZE);
    expect(moderationLogQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(moderationLogQuerySchema.parse({ limit: '-7' }).limit).toBe(1);
    expect(moderationLogQuerySchema.parse({ limit: '100000' }).limit).toBe(
      MODERATION_LOG_MAX_PAGE_SIZE,
    );
    expect(moderationLogQuerySchema.parse({ limit: 'abc' }).limit).toBe(MODERATION_LOG_PAGE_SIZE);
    expect(moderationLogQuerySchema.parse({ limit: '35' }).limit).toBe(35);
  });

  it('the action filter is a CLOSED enum: an unknown value is refused, never widened', () => {
    expect(moderationLogQuerySchema.parse({ action: 'comment_removed' }).action).toBe(
      'comment_removed',
    );
    expect(moderationLogQuerySchema.safeParse({ action: 'everything' }).success).toBe(false);
    expect(moderationLogQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
  });

  it('an over-long cursor degrades to page 1', () => {
    const long = 'x'.repeat(MODERATION_LOG_MAX_CURSOR_LENGTH + 1);
    expect(moderationLogQuerySchema.parse({ cursor: long }).cursor).toBeUndefined();
    expect(moderationLogQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc');
  });
});

describe('moderationLogPageSchema', () => {
  const entry = {
    id: '6f1e3c2a-0b4d-4c8e-9a7f-1d2e3f4a5b6c',
    createdAt: '2026-10-02T12:00:00.123456Z',
    action: 'comment_removed',
    actor: {
      membershipId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
      displayName: 'Ana',
      isViewer: true,
    },
    target: { membershipId: '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e', displayName: null },
    subjectType: 'post_comment',
    excerpt: 'texto',
    reason: null,
    details: null,
  };

  it('accepts a strict row and refuses an unknown key', () => {
    expect(moderationLogPageSchema.parse({ items: [entry], nextCursor: null }).items).toHaveLength(
      1,
    );
    expect(moderationLogEntrySchema.safeParse({ ...entry, body: 'x' }).success).toBe(false);
  });

  it('a role change carries roles from the tenant role list only', () => {
    const role = { ...entry, action: 'role_changed', subjectType: null, excerpt: null };
    expect(
      moderationLogEntrySchema.safeParse({
        ...role,
        details: { from: 'member', to: 'admin_tenant' },
      }).success,
    ).toBe(true);
    expect(
      moderationLogEntrySchema.safeParse({ ...role, details: { from: 'member', to: 'owner' } })
        .success,
    ).toBe(false);
  });
});
