import { describe, expect, it, vi } from 'vitest';
import type { StoryLikeActionResult } from '@/app/(app)/stories/story-actions';
import type { StoryViewerItemView } from '@/lib/story-view';
import { createStoryInteractions, withStoryInteraction } from './story-interactions';

/**
 * CR-01 for stories: the page-scoped store behind every story action row. The claims a later edit
 * could quietly break:
 *
 *  1. A story nobody touched keeps its IDENTITY (no re-render); an entry overrides the like pair
 *     and the count, each on its own.
 *  2. WR-04: the confirmed pair is published only when the story's LATEST request settles, whatever
 *     its outcome; an older `ok` never lands over a newer request, a refused or rejected latest one
 *     publishes the older confirmed pair, a rejection is rethrown, and only `ok` is ever confirmed.
 *  3. The comment count is ABSOLUTE: seeded from the count shown, then from the entry, never below
 *     zero, and only the bumped story's entry changes identity.
 */

const STORY = '0d000000-0000-4000-8000-0000000000d1';
const OTHER = '0d000000-0000-4000-8000-0000000000d2';

function item(overrides: Partial<StoryViewerItemView> = {}): StoryViewerItemView {
  return {
    id: STORY,
    mediaKind: 'image',
    mediaAssetId: '0d000000-0000-4000-8000-0000000000b1',
    mediaVariantWidths: [640, 1080],
    caption: 'Bastidores do encontro de hoje.',
    timeLabel: 'há 1 h',
    likeCount: 12,
    commentCount: 3,
    viewerLiked: false,
    seen: false,
    authorAvatarUrl: null,
    ...overrides,
  };
}

/** A deferred promise, so a case decides WHEN each like request answers. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const LIKED: StoryLikeActionResult = { ok: true, liked: true, likeCount: 13 };
const UNLIKED: StoryLikeActionResult = { ok: true, liked: false, likeCount: 12 };
const REFUSED: StoryLikeActionResult = { ok: false, code: 'generic' };

describe('withStoryInteraction', () => {
  it('returns the SAME object when the page has no entry for the story', () => {
    const view = item();
    expect(withStoryInteraction(view)).toBe(view);
    expect(withStoryInteraction(view, undefined)).toBe(view);
  });

  it('overrides the like pair and the count from the entry, each on its own', () => {
    const view = item();
    expect(
      withStoryInteraction(view, { like: { liked: true, likeCount: 13 }, commentCount: 4 }),
    ).toEqual({ ...view, viewerLiked: true, likeCount: 13, commentCount: 4 });
    expect(withStoryInteraction(view, { like: { liked: true, likeCount: 13 } })).toEqual({
      ...view,
      viewerLiked: true,
      likeCount: 13,
    });
    expect(withStoryInteraction(view, { commentCount: 0 })).toEqual({ ...view, commentCount: 0 });
  });
});

describe('createStoryInteractions — the like (WR-04)', () => {
  it('an `ok` answer becomes the story’s entry and goes back unchanged', async () => {
    const store = createStoryInteractions();
    const listener = vi.fn();
    store.subscribe(listener);

    const outcome = await store.trackLike(STORY, async () => LIKED);

    expect(outcome).toBe(LIKED);
    expect(store.entry(STORY)).toEqual({ like: { liked: true, likeCount: 13 } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.entry(OTHER)).toBeUndefined();
  });

  it('an older `ok` settling while a newer request is in flight is NOT published', async () => {
    const store = createStoryInteractions();
    const listener = vi.fn();
    store.subscribe(listener);
    const first = deferred<StoryLikeActionResult>();
    const second = deferred<StoryLikeActionResult>();

    const liking = store.trackLike(STORY, () => first.promise);
    const unliking = store.trackLike(STORY, () => second.promise);

    first.resolve(LIKED);
    await expect(liking).resolves.toBe(LIKED);
    // The member already left that state: nothing re-seeds the row mid-flight.
    expect(store.entry(STORY)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();

    second.resolve(UNLIKED);
    await expect(unliking).resolves.toBe(UNLIKED);
    expect(store.entry(STORY)).toEqual({ like: { liked: false, likeCount: 12 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an older `ok` arriving AFTER the newer answer never replaces it', async () => {
    const store = createStoryInteractions();
    const first = deferred<StoryLikeActionResult>();
    const second = deferred<StoryLikeActionResult>();

    const liking = store.trackLike(STORY, () => first.promise);
    const unliking = store.trackLike(STORY, () => second.promise);

    second.resolve(UNLIKED);
    await unliking;
    first.resolve(LIKED);
    await liking;

    expect(store.entry(STORY)).toEqual({ like: { liked: false, likeCount: 12 } });
  });

  it('a REFUSED latest request publishes the older confirmed pair', async () => {
    const store = createStoryInteractions();
    const first = deferred<StoryLikeActionResult>();
    const second = deferred<StoryLikeActionResult>();

    const liking = store.trackLike(STORY, () => first.promise);
    const unliking = store.trackLike(STORY, () => second.promise);
    first.resolve(LIKED);
    await liking;
    expect(store.entry(STORY)).toBeUndefined();

    second.resolve(REFUSED);
    await expect(unliking).resolves.toBe(REFUSED);
    expect(store.entry(STORY)).toEqual({ like: { liked: true, likeCount: 13 } });
  });

  it('a REJECTED latest request publishes the older confirmed pair and rethrows', async () => {
    const store = createStoryInteractions();
    const first = deferred<StoryLikeActionResult>();
    const second = deferred<StoryLikeActionResult>();

    const liking = store.trackLike(STORY, () => first.promise);
    const unliking = store.trackLike(STORY, () => second.promise);
    first.resolve(LIKED);
    await liking;

    second.reject(new Error('network'));
    await expect(unliking).rejects.toThrow('network');
    expect(store.entry(STORY)).toEqual({ like: { liked: true, likeCount: 13 } });
  });

  it('a refusal or a rejection with NOTHING confirmed creates no entry', async () => {
    const store = createStoryInteractions();
    const listener = vi.fn();
    store.subscribe(listener);

    await expect(store.trackLike(STORY, async () => REFUSED)).resolves.toBe(REFUSED);
    await expect(
      store.trackLike(STORY, async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');

    expect(store.entry(STORY)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('an unsubscribed listener hears nothing more', async () => {
    const store = createStoryInteractions();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    await store.trackLike(STORY, async () => LIKED);
    store.bumpCommentCount(STORY, 3, 1);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createStoryInteractions — the comment count', () => {
  it('starts from the count shown, then from the entry, clamps at zero and notifies', () => {
    const store = createStoryInteractions();
    const listener = vi.fn();
    store.subscribe(listener);

    store.bumpCommentCount(STORY, 3, 1);
    expect(store.entry(STORY)).toEqual({ commentCount: 4 });

    // The entry wins over whatever count a later read shows: never counted twice.
    store.bumpCommentCount(STORY, 99, -1);
    expect(store.entry(STORY)).toEqual({ commentCount: 3 });

    store.bumpCommentCount(STORY, 3, -10);
    expect(store.entry(STORY)).toEqual({ commentCount: 0 });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps the like beside the count; only the bumped story’s entry changes identity', async () => {
    const store = createStoryInteractions();
    await store.trackLike(STORY, async () => LIKED);
    await store.trackLike(OTHER, async () => UNLIKED);
    const story = store.entry(STORY);
    const other = store.entry(OTHER);

    store.bumpCommentCount(STORY, 3, 1);

    expect(store.entry(STORY)).not.toBe(story);
    expect(store.entry(STORY)).toEqual({ like: { liked: true, likeCount: 13 }, commentCount: 4 });
    expect(store.entry(OTHER)).toBe(other);
    // Read twice without a change in between: the same object, which `useSyncExternalStore` needs.
    expect(store.entry(STORY)).toBe(store.entry(STORY));
  });
});
