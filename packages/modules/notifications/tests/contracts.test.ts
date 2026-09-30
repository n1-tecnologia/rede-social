import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  convTopic,
  inboxTopic,
  REALTIME_SUFFIX_PATTERN,
  REALTIME_TOPIC_PATTERN,
  tenantTopic,
  topicSuffix,
  userTopic,
} from '@rede-social/contracts/realtime';
import { describe, expect, it } from 'vitest';
import {
  NOTIF_MAX_CURSOR_LENGTH,
  NOTIF_MAX_PAGE_SIZE,
  NOTIF_PAGE_SIZE,
  NOTIF_SECTIONS,
  notificationPageSchema,
  notificationQuerySchema,
  notificationRowSchema,
  notificationsFanoutJobSchema,
} from '../contracts/index';

/**
 * The published contract, pinned without a server: the closed `section` enum, the clamping `limit`,
 * the degrading cursor bound (NOTIF-02 boundary), the strict row, and the Realtime topic spec shared
 * by `@rede-social/contracts/realtime` and the SQL definer (planning decision 3).
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const U = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';

describe('notificationQuerySchema (NOTIF-02 boundary)', () => {
  it('defaults to section=unread and the page size', () => {
    expect(notificationQuerySchema.parse({})).toEqual({
      section: 'unread',
      cursor: undefined,
      limit: NOTIF_PAGE_SIZE,
    });
  });

  it('clamps limit to 1..NOTIF_MAX_PAGE_SIZE and never errors', () => {
    expect(notificationQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(notificationQuerySchema.parse({ limit: '100000' }).limit).toBe(NOTIF_MAX_PAGE_SIZE);
    expect(notificationQuerySchema.parse({ limit: 'abc' }).limit).toBe(NOTIF_PAGE_SIZE);
  });

  it('refuses a section outside the closed enum instead of widening the read', () => {
    expect(NOTIF_SECTIONS).toEqual(['unread', 'read']);
    expect(notificationQuerySchema.safeParse({ section: 'READ' }).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ section: 'all' }).success).toBe(false);
    expect(notificationQuerySchema.parse({ section: 'read' }).section).toBe('read');
  });

  it('degrades an over-long cursor to page 1', () => {
    const long = 'x'.repeat(NOTIF_MAX_CURSOR_LENGTH + 1);
    expect(notificationQuerySchema.parse({ cursor: long }).cursor).toBeUndefined();
    expect(notificationQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc');
  });

  it('refuses an unknown key', () => {
    expect(notificationQuerySchema.safeParse({ tenantId: T }).success).toBe(false);
  });
});

describe('notificationRowSchema', () => {
  const row = {
    id: U,
    kind: 'feed.post',
    subject: { type: 'post', id: C },
    object: null,
    actor: { removed: false, displayName: 'Ana', avatarAssetId: null },
    facts: { postId: C, excerpt: 'olá', communityId: null },
    preview: null,
    removed: false,
    createdAt: '2026-09-30T12:00:00.000001Z',
    seenAt: null,
    readAt: null,
  };

  it('accepts a row carrying facts and no sentence', () => {
    expect(notificationPageSchema.parse({ items: [row], nextCursor: null }).items).toHaveLength(1);
  });

  it('is strict: a stored sentence or a tenant id cannot ride along', () => {
    expect(notificationRowSchema.safeParse({ ...row, text: 'x' }).success).toBe(false);
    expect(notificationRowSchema.safeParse({ ...row, tenantId: T }).success).toBe(false);
  });

  it('refuses a non-scalar fact', () => {
    expect(notificationRowSchema.safeParse({ ...row, facts: { nested: { a: 1 } } }).success).toBe(
      false,
    );
  });
});

describe('notificationsFanoutJobSchema', () => {
  it('requires a uuid tenant and an ISO sinkAt', () => {
    const ok = {
      event: 'post.published',
      tenantId: T,
      payload: {},
      sinkAt: new Date().toISOString(),
    };
    expect(notificationsFanoutJobSchema.safeParse(ok).success).toBe(true);
    expect(notificationsFanoutJobSchema.safeParse({ ...ok, tenantId: 'nope' }).success).toBe(false);
    expect(notificationsFanoutJobSchema.safeParse({ ...ok, sinkAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('Realtime topics (planning decision 3: the SQL is the spec)', () => {
  const topic = new RegExp(REALTIME_TOPIC_PATTERN);
  const suffix = new RegExp(REALTIME_SUFFIX_PATTERN);

  it('every builder produces a topic the definer admits by shape', () => {
    for (const built of [tenantTopic(T), userTopic(T, U), inboxTopic(T), convTopic(T, C)]) {
      expect(built).toMatch(topic);
    }
    for (const built of [
      topicSuffix.all(),
      topicSuffix.user(U),
      topicSuffix.inbox(),
      topicSuffix.conv(C),
    ]) {
      expect(built).toMatch(suffix);
    }
  });

  it('refuses malformed topics by shape', () => {
    for (const bad of [
      'tenant:not-a-uuid:all',
      `tenant:${T}:all:extra`,
      `tenant:${T.toUpperCase()}:all`,
      `tenant:${T}:user`,
      `other:${T}:all`,
    ]) {
      expect(bad).not.toMatch(topic);
    }
  });

  it('the migration carries both regex literals verbatim', () => {
    const dir = join(__dirname, '../../../../supabase/migrations');
    const file = readdirSync(dir).find((name) => name.endsWith('_realtime_authorization.sql'));
    expect(file).toBeDefined();
    const migration = readFileSync(join(dir, file as string), 'utf8');
    expect(migration).toContain(`'${REALTIME_TOPIC_PATTERN}'`);
    expect(migration).toContain(`'${REALTIME_SUFFIX_PATTERN}'`);
  });
});
