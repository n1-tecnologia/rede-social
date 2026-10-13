import { describe, expect, it } from 'vitest';
import {
  MEDIA_LIMITS,
  MEDIA_PURPOSES,
  mediaAcceptFor,
  mediaStartBodySchema,
  PLAYBACK_TOKEN_MARGIN_SECONDS,
  PLAYBACK_TOKEN_MAX_TTL_SECONDS,
  PLAYBACK_TOKEN_TTL_SECONDS,
  PURPOSE_WIDTHS,
  playbackTtlSeconds,
} from '../src/media';

/**
 * 08.3-01 (D-409, COURSE-12): the `lesson` purpose is a VIDEO-only entry of the media table, with
 * long-form caps, and nothing else about the table moved. The server's `limitFor` is
 * `MEDIA_LIMITS[kind][purpose]` with a throw on a missing pair, so the lookups here are the same
 * ones the API and the ready-event job perform.
 */
describe('media contract: the lesson purpose (08.3-01)', () => {
  it('MEDIA_PURPOSES ends with lesson (appended LAST, the CHECK is generated from this order)', () => {
    expect(MEDIA_PURPOSES.at(-1)).toBe('lesson');
    expect(MEDIA_PURPOSES.slice(0, -1)).toEqual(['avatar', 'post', 'cover', 'story', 'attachment']);
  });

  it('lesson derives no WebP ladder (the provider owns thumbnails and HLS)', () => {
    expect(PURPOSE_WIDTHS.lesson).toEqual([]);
  });

  it('video/lesson is 4 GiB and 14 400 s; the post caps are untouched', () => {
    const lesson = MEDIA_LIMITS.video.lesson;
    expect(lesson?.maxBytes).toBe(4 * 1024 * 1024 * 1024);
    expect(lesson?.maxDurationSeconds).toBe(14_400);
    expect(lesson?.mimes).toEqual(['video/mp4', 'video/quicktime']);
    expect(MEDIA_LIMITS.video.post?.maxDurationSeconds).toBe(300);
    expect(MEDIA_LIMITS.video.post?.maxBytes).toBe(500 * 1024 * 1024);
  });

  it('no image.lesson or file.lesson pair exists (covers use cover, materials use attachment)', () => {
    expect(MEDIA_LIMITS.image.lesson).toBeUndefined();
    expect(MEDIA_LIMITS.file.lesson).toBeUndefined();
    expect(mediaAcceptFor('image', 'lesson')).toBe('');
    expect(mediaAcceptFor('file', 'lesson')).toBe('');
  });

  it('the pick-time accept list of a lesson video equals the post video one', () => {
    expect(mediaAcceptFor('video', 'lesson')).toBe(mediaAcceptFor('video', 'post'));
    expect(mediaAcceptFor('video', 'lesson')).toBe('video/mp4,video/quicktime');
  });

  it('the start body accepts purpose lesson by the enum alone (the server decides the pair)', () => {
    const parsed = mediaStartBodySchema.safeParse({
      kind: 'video',
      purpose: 'lesson',
      mime: 'video/mp4',
      size: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * 08.3-03 (D-409, COURSE-12; RESEARCH Pattern 5 item 4, Pitfall 5): a playback credential is sized
 * from the asset's own duration — the two-hour value became the FLOOR, thirty minutes of margin are
 * added past the duration, and the provider's 12 h asset limit caps it. Pure, so pinned here value
 * for value (P46 boundaries, P47 integer seconds); `media-playback.test.ts` proves the route obeys.
 */
describe('media contract: the duration-sized playback TTL (08.3-03)', () => {
  it('names the floor, the margin and the cap', () => {
    expect(PLAYBACK_TOKEN_TTL_SECONDS).toBe(2 * 60 * 60);
    expect(PLAYBACK_TOKEN_MARGIN_SECONDS).toBe(30 * 60);
    expect(PLAYBACK_TOKEN_MAX_TTL_SECONDS).toBe(12 * 60 * 60);
  });

  it('maps an unknown or short duration to the floor', () => {
    expect(playbackTtlSeconds(null)).toBe(7200);
    expect(playbackTtlSeconds(0)).toBe(7200);
    expect(playbackTtlSeconds(60)).toBe(7200);
    // The floor holds exactly while `duration + margin` is under it: 5400 s is the last such value.
    expect(playbackTtlSeconds(5400)).toBe(7200);
    expect(playbackTtlSeconds(5401)).toBe(7201);
  });

  it('adds the margin above the floor and stops at the cap (P46)', () => {
    // `max(floor, duration + margin)`, never a step at the floor: a lecture one second short of two
    // hours still gets its full thirty minutes (Pitfall 5 is precisely a token that dies mid-pause).
    expect(playbackTtlSeconds(7199)).toBe(8999);
    expect(playbackTtlSeconds(7200)).toBe(9000);
    expect(playbackTtlSeconds(9000)).toBe(10_800);
    expect(playbackTtlSeconds(14_400)).toBe(16_200);
    expect(playbackTtlSeconds(41_400)).toBe(43_200);
    expect(playbackTtlSeconds(41_401)).toBe(43_200);
    expect(playbackTtlSeconds(100_000)).toBe(43_200);
  });

  it('answers integer seconds even for a float duration (P47)', () => {
    expect(Number.isInteger(playbackTtlSeconds(9000.7))).toBe(true);
    expect(playbackTtlSeconds(9000.7)).toBe(10_800);
  });
});
