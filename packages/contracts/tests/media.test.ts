import { describe, expect, it } from 'vitest';
import {
  MEDIA_LIMITS,
  MEDIA_PURPOSES,
  mediaAcceptFor,
  mediaStartBodySchema,
  PURPOSE_WIDTHS,
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
