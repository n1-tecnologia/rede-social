import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MIMES,
  attachmentKindFor,
  classifyMediaFile,
  MEDIA_KINDS,
  MEDIA_LIMITS,
  MEDIA_PURPOSES,
  mediaAcceptFor,
  mediaStartBodySchema,
  PLAYBACK_TOKEN_MARGIN_SECONDS,
  PLAYBACK_TOKEN_MAX_TTL_SECONDS,
  PLAYBACK_TOKEN_TTL_SECONDS,
  PURPOSE_WIDTHS,
  playbackTtlSeconds,
  RESUMABLE_THRESHOLD_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_MIMES,
} from '../src/media';

/**
 * 08.3-01 (D-409, COURSE-12): the `lesson` purpose is a VIDEO-only entry of the media table, with
 * long-form caps, and nothing else about the table moved. The server's `limitFor` is
 * `MEDIA_LIMITS[kind][purpose]` with a throw on a missing pair, so the lookups here are the same
 * ones the API and the ready-event job perform.
 */
describe('media contract: the lesson purpose (08.3-01)', () => {
  it('MEDIA_PURPOSES keeps lesson in its place (12.5 appended voice after it, never before)', () => {
    expect(MEDIA_PURPOSES.indexOf('lesson')).toBe(5);
    expect(MEDIA_PURPOSES.slice(0, 6)).toEqual([
      'avatar',
      'post',
      'cover',
      'story',
      'attachment',
      'lesson',
    ]);
  });

  it('lesson derives no WebP ladder (the provider owns thumbnails and HLS)', () => {
    expect(PURPOSE_WIDTHS.lesson).toEqual([]);
  });

  it('video/lesson is 4 GiB and 14 400 s', () => {
    const lesson = MEDIA_LIMITS.video.lesson;
    expect(lesson?.maxBytes).toBe(4 * 1024 * 1024 * 1024);
    expect(lesson?.maxDurationSeconds).toBe(14_400);
    expect(lesson?.mimes).toEqual(['video/mp4', 'video/quicktime']);
  });

  it('TEMPORARY raise (quick 261117-d1o to 4 GiB, quick 261118-glh to 8 GiB): video/post is 8 GiB and 9000 s; story and lesson did not move', () => {
    // TEMPORARY pin: flipping the constant back means 500 MiB and 300 s; flip this pin with it.
    expect(MEDIA_LIMITS.video.post?.maxBytes).toBe(8 * 1024 ** 3);
    expect(MEDIA_LIMITS.video.post?.maxDurationSeconds).toBe(9000);
    expect(MEDIA_LIMITS.video.story?.maxBytes).toBe(500 * 1024 * 1024);
    expect(MEDIA_LIMITS.video.story?.maxDurationSeconds).toBe(60);
    expect(MEDIA_LIMITS.video.lesson?.maxDurationSeconds).toBe(14_400);
  });

  it('the post video cap is judged by the table: at the cap passes, one byte more is size; the start body only checks positivity', () => {
    // Derived from the table so this case survives the revert of the TEMPORARY cap.
    const cap = MEDIA_LIMITS.video.post?.maxBytes ?? 0;
    const at = { name: 'v.mp4', type: 'video/mp4', size: cap } as File;
    const over = { name: 'v.mp4', type: 'video/mp4', size: cap + 1 } as File;
    expect(classifyMediaFile(at, 'video', 'post')).toBeNull();
    expect(classifyMediaFile(over, 'video', 'post')).toBe('size');
    for (const size of [cap, cap + 1]) {
      expect(
        mediaStartBodySchema.safeParse({ kind: 'video', purpose: 'post', mime: 'video/mp4', size })
          .success,
      ).toBe(true);
    }
    expect(Number.isSafeInteger(cap)).toBe(true);
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

/**
 * 08.3-03 (D-410, COURSE-07): materials are PDF, spreadsheets, slides or images at the bucket's
 * 50 MiB cap. The pick-time accept list is the SAME table the server judges at `start`, and the
 * kind label every UI shows derives from the mime through one function.
 */
describe('media contract: the widened attachment (08.3-03)', () => {
  it('ATTACHMENT_MIMES is exactly the eight D-410 mimes, in the decision order', () => {
    expect([...ATTACHMENT_MIMES]).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(MEDIA_LIMITS.file.attachment?.mimes).toBe(ATTACHMENT_MIMES);
  });

  it('mediaAcceptFor(file, attachment) carries the eight mimes and the cap is 52 428 800', () => {
    const accept = mediaAcceptFor('file', 'attachment').split(',');
    expect(accept).toHaveLength(8);
    for (const mime of ATTACHMENT_MIMES) expect(accept).toContain(mime);
    expect(MEDIA_LIMITS.file.attachment?.maxBytes).toBe(52_428_800);
    expect(MEDIA_LIMITS.file.attachment?.maxBytes).toBe(50 * 1024 * 1024);
    // Still no ladder: a material derives nothing in Storage.
    expect(PURPOSE_WIDTHS.attachment).toEqual([]);
  });

  it('the pick-time gate agrees: an xlsx passes, a docx is a type refusal, 50 MiB + 1 is a size one', () => {
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(classifyMediaFile({ type: xlsx, size: 52_428_800 }, 'file', 'attachment')).toBeNull();
    expect(classifyMediaFile({ type: xlsx, size: 52_428_801 }, 'file', 'attachment')).toBe('size');
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(classifyMediaFile({ type: docx, size: 10 }, 'file', 'attachment')).toBe('type');
    expect(classifyMediaFile({ type: 'image/png', size: 10 }, 'file', 'attachment')).toBeNull();
  });

  it('attachmentKindFor maps every mime to its label key and anything else to file', () => {
    expect(attachmentKindFor('application/pdf')).toBe('pdf');
    expect(attachmentKindFor('application/vnd.ms-excel')).toBe('sheet');
    expect(
      attachmentKindFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('sheet');
    expect(attachmentKindFor('application/vnd.ms-powerpoint')).toBe('slides');
    expect(
      attachmentKindFor(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('slides');
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(attachmentKindFor(mime)).toBe('image');
    }
    expect(attachmentKindFor('application/zip')).toBe('file');
    expect(attachmentKindFor(null)).toBe('file');
    expect(attachmentKindFor(undefined)).toBe('file');
  });
});

/**
 * 12.5-01 (D-848, D-864, VOICE-13): a chat voice message is an `audio` asset with the `voice`
 * purpose. Both values are APPENDED last (the CHECKs are generated from these lists, and the order
 * is what keeps every earlier migration's diff stable); a take is at most 300 seconds and 6 MiB so
 * it is always ONE signed PUT, never a TUS upload; and the bucket allow-list (pinned in
 * supabase/tests/070-media-bucket.sql) is exactly the union of the mimes below.
 */
describe('media contract: the audio kind and the voice purpose (12.5-01)', () => {
  it('MEDIA_KINDS ends with audio and MEDIA_PURPOSES ends with voice (appended LAST)', () => {
    expect(MEDIA_KINDS.at(-1)).toBe('audio');
    expect(MEDIA_KINDS.slice(0, -1)).toEqual(['image', 'video', 'file']);
    expect(MEDIA_PURPOSES.at(-1)).toBe('voice');
    expect(MEDIA_PURPOSES.slice(0, -1)).toEqual([
      'avatar',
      'post',
      'cover',
      'story',
      'attachment',
      'lesson',
    ]);
  });

  it('audio/voice is three base mimes, 6 MiB and 300 seconds', () => {
    expect(VOICE_MAX_SECONDS).toBe(300);
    expect([...VOICE_MIMES]).toEqual(['audio/webm', 'audio/mp4', 'audio/ogg']);
    const voice = MEDIA_LIMITS.audio.voice;
    expect(voice?.mimes).toBe(VOICE_MIMES);
    expect(voice?.maxBytes).toBe(6 * 1024 * 1024);
    expect(voice?.maxDurationSeconds).toBe(VOICE_MAX_SECONDS);
  });

  it('a take is always ONE signed PUT: maxBytes equals the resumable threshold', () => {
    expect(MEDIA_LIMITS.audio.voice?.maxBytes).toBe(RESUMABLE_THRESHOLD_BYTES);
  });

  it('voice derives no image ladder and is the only audio pair', () => {
    expect(PURPOSE_WIDTHS.voice).toEqual([]);
    expect(Object.keys(MEDIA_LIMITS.audio)).toEqual(['voice']);
    expect(MEDIA_LIMITS.image.voice).toBeUndefined();
    expect(MEDIA_LIMITS.video.voice).toBeUndefined();
    expect(MEDIA_LIMITS.file.voice).toBeUndefined();
    expect(MEDIA_LIMITS.audio.post).toBeUndefined();
  });

  it('the union of every MEDIA_LIMITS mime is the thirteen the private bucket allows', () => {
    const union = new Set<string>();
    for (const purposes of Object.values(MEDIA_LIMITS)) {
      for (const limit of Object.values(purposes)) {
        for (const mime of limit?.mimes ?? []) union.add(mime);
      }
    }
    expect([...union].sort()).toEqual(
      [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'audio/mp4',
        'audio/ogg',
        'audio/webm',
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime',
      ].sort(),
    );
  });

  it('the pick-time gate judges a take: webm passes, wav is a type refusal, 6 MiB + 1 is a size one', () => {
    expect(classifyMediaFile({ type: 'audio/webm', size: 1000 }, 'audio', 'voice')).toBeNull();
    expect(classifyMediaFile({ type: 'audio/wav', size: 1000 }, 'audio', 'voice')).toBe('type');
    expect(
      classifyMediaFile({ type: 'audio/mp4', size: 6 * 1024 * 1024 + 1 }, 'audio', 'voice'),
    ).toBe('size');
    expect(mediaAcceptFor('audio', 'voice')).toBe('audio/webm,audio/mp4,audio/ogg');
  });
});
