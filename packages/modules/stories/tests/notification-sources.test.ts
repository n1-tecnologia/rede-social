import type { Tx } from '@rede-social/core/db/tenant-tx';
import { describe, expect, it } from 'vitest';
import { STORIES_NOTIFICATION_KINDS } from '../contracts/index';
import { storiesPushCopy } from '../server/notification-copy';
import {
  STORIES_PUSH_TTL_MAX,
  storiesNotificationRetractions,
  storiesNotificationSources,
  storyPushTtl,
} from '../server/notifications';

/**
 * The stories module's notification sources and retractions (07-04, D-226/D-229/D-235), pinned with a
 * fake `tx` returning a fixed row: kinds, dedupe keys, audiences, exclusions, subject/object pairs,
 * channels, the push hint and the TTL rule. The SQL itself is proved end to end by the API
 * integration battery (`notifications.test.ts`, describe `notifications tipos`).
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const S = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const CM = '44444444-4444-4444-8444-444444444444';
const ASSET = '55555555-5555-4555-8555-555555555555';
const EXPIRES = '2026-10-01T12:00:00.000000Z';

function fakeTx(rows: unknown[]): Tx {
  return { execute: async () => rows } as unknown as Tx;
}

function sourceFor(event: string) {
  const found = storiesNotificationSources.find((s) => s.event === event);
  if (!found) throw new Error(`no ${event} source`);
  return found;
}

describe('stories sources: the declared set', () => {
  it('declares story.published and story.commented, and NO source on story.highlighted (Pitfall 11)', () => {
    expect(storiesNotificationSources.map((s) => s.event)).toEqual([
      'story.published',
      'story.commented',
    ]);
    expect(storiesNotificationSources.some((s) => s.event === 'story.highlighted')).toBe(false);
  });
});

describe('story.published source (broadcast, D-229)', () => {
  const published = sourceFor('story.published');
  const payload = {
    tenantId: T,
    storyId: S,
    authorUserId: AUTHOR,
    mediaKind: 'image' as const,
    expiresAt: EXPIRES,
  };
  const row = {
    id: S,
    author_user_id: AUTHOR,
    media_kind: 'image',
    media_asset_id: ASSET,
    expires_at: EXPIRES,
    seconds_left: 80_000,
  };

  it('yields ONE stories.story intent to members, excluding the author', async () => {
    const intents = await published.resolve(fakeTx([row]), payload, { sinkAt: 'x' });
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent?.kind).toBe(STORIES_NOTIFICATION_KINDS.story);
    expect(intent?.audience).toEqual({ type: 'members' });
    expect(intent?.excludeUserIds).toEqual([AUTHOR]);
    expect(intent?.dedupeKey).toBe(`stories.story:${S}`);
    expect(intent?.subject).toEqual({ type: 'story', id: S });
    expect(intent?.object).toBeNull();
    expect(intent?.actorUserId).toBe(AUTHOR);
    expect(intent?.facts).toEqual({ storyId: S, expiresAt: EXPIRES, previewAssetId: ASSET });
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push).toMatchObject({
      title: 'tenant',
      body: 'Novo story',
      url: `/stories/${S}`,
      tag: 'stories-story',
      topic: 'stories-story',
      ttlSeconds: 80_000,
      urgency: 'normal',
      renotify: false,
    });
  });

  it('a video story carries no preview (the broker serves no video poster)', async () => {
    const [intent] = await published.resolve(fakeTx([{ ...row, media_kind: 'video' }]), payload, {
      sinkAt: 'x',
    });
    expect(intent?.facts.previewAssetId).toBeNull();
  });

  it('the push TTL never exceeds the time left before expiry, nor 24 h', async () => {
    for (const secondsLeft of [0, 1, 59, 3_600, 86_399, 86_400, 90_000]) {
      const [intent] = await published.resolve(
        fakeTx([{ ...row, seconds_left: secondsLeft }]),
        payload,
        { sinkAt: 'x' },
      );
      const ttl = intent?.push?.ttlSeconds ?? -1;
      expect(ttl).toBeLessThanOrEqual(STORIES_PUSH_TTL_MAX);
      expect(ttl).toBeLessThanOrEqual(Math.max(1, secondsLeft));
      expect(ttl).toBeGreaterThanOrEqual(1);
    }
    expect(storyPushTtl(Number.NaN)).toBe(1);
  });

  it('a deleted or expired story (no row) yields nothing', async () => {
    expect(await published.resolve(fakeTx([]), payload, { sinkAt: 'x' })).toEqual([]);
  });
});

describe('story.commented source (personal, D-229)', () => {
  const commented = sourceFor('story.commented');
  const payload = {
    tenantId: T,
    storyId: S,
    commentId: CM,
    storyAuthorUserId: AUTHOR,
    actorUserId: MEMBER,
  };
  const row = {
    comment_id: CM,
    body: 'Que lindo!',
    story_id: S,
    story_author_user_id: AUTHOR,
    expires_at: EXPIRES,
    actor_name: 'Bia',
  };

  it("yields ONE pushed stories.story_commented intent to the story's author", async () => {
    const intents = await commented.resolve(fakeTx([row]), payload, { sinkAt: 'x' });
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent?.kind).toBe(STORIES_NOTIFICATION_KINDS.storyCommented);
    expect(intent?.audience).toEqual({ type: 'users', userIds: [AUTHOR] });
    expect(intent?.excludeUserIds).toEqual([MEMBER]);
    expect(intent?.dedupeKey).toBe(`stories.story_commented:${CM}`);
    expect(intent?.subject).toEqual({ type: 'story', id: S });
    expect(intent?.object).toEqual({ type: 'story_comment', id: CM });
    expect(intent?.actorUserId).toBe(MEMBER);
    expect(intent?.facts).toEqual({
      storyId: S,
      commentId: CM,
      expiresAt: EXPIRES,
      excerpt: 'Que lindo!',
    });
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push).toEqual({
      title: 'tenant',
      body: 'Bia comentou no seu story: Que lindo!',
      url: `/stories/${S}`,
      tag: 'stories-comment',
      topic: 'stories-comment',
      ttlSeconds: 86_400,
      urgency: 'normal',
      renotify: true,
    });
  });

  it('the author commenting on their own story yields nothing', async () => {
    const self = { ...payload, actorUserId: AUTHOR };
    expect(await commented.resolve(fakeTx([row]), self, { sinkAt: 'x' })).toEqual([]);
  });

  it('a removed comment or story (no row) yields nothing', async () => {
    expect(await commented.resolve(fakeTx([]), payload, { sinkAt: 'x' })).toEqual([]);
  });
});

describe('stories retractions (keep-and-mark)', () => {
  it('story.deleted retracts on the subject story; story.comment_deleted on the object story_comment', () => {
    expect(storiesNotificationRetractions.map((r) => r.event)).toEqual([
      'story.deleted',
      'story.comment_deleted',
    ]);
    const [story, comment] = storiesNotificationRetractions;
    expect(
      story?.match({ tenantId: T, storyId: S, authorUserId: AUTHOR, actorUserId: AUTHOR }),
    ).toEqual({ on: 'subject', type: 'story', id: S });
    expect(comment?.match({ tenantId: T, storyId: S, commentId: CM, actorUserId: MEMBER })).toEqual(
      { on: 'object', type: 'story_comment', id: CM },
    );
  });
});

describe('storiesPushCopy (UI-SPEC §Push banner copy)', () => {
  it('renders the two verbatim bodies', () => {
    expect(storiesPushCopy({ kind: 'stories.story' })).toBe('Novo story');
    expect(
      storiesPushCopy({ kind: 'stories.story_commented', actorName: 'Ana', excerpt: 'oi' }),
    ).toBe('Ana comentou no seu story: oi');
  });
});
