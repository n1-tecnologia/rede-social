import { describe, expect, it } from 'vitest';
import {
  buildNormalizeArgs,
  judgeVoiceDuration,
  VOICE_INPUT_LIMIT_SECONDS,
  VOICE_REJECT_ABOVE_SECONDS,
  VoiceNormalizeError,
  voiceDecoderFor,
  voiceDemuxerFor,
} from '../server/media/voice';

/**
 * 12.5-02 (D-848, D-863; T-12.5-05, T-12.5-06): the hostile-input shape of the ffmpeg call and the
 * duration verdict, as pure functions so no ffmpeg is needed here. The real binary is exercised by
 * `apps/api/tests/integration/media-voice.test.ts`.
 */

function valueAfter(args: string[], flag: string, from = 0): string | undefined {
  const index = args.indexOf(flag, from);
  return index === -1 ? undefined : args[index + 1];
}

describe('buildNormalizeArgs', () => {
  const args = buildNormalizeArgs('audio/webm', '/tmp/x/in', '/tmp/x/out.mp4');

  it('is an array of plain strings, never one shell line', () => {
    expect(Array.isArray(args)).toBe(true);
    expect(args.every((arg) => typeof arg === 'string')).toBe(true);
    // No element carries a shell operator or a second command: the paths are single arguments.
    expect(args.filter((arg) => arg.includes('/tmp/x/'))).toEqual(['/tmp/x/in', '/tmp/x/out.mp4']);
    expect(args.some((arg) => /[;&|`$]/.test(arg))).toBe(false);
  });

  it('closes the box: no stdin, files only, first audio stream only, no video, subtitles or data', () => {
    expect(args).toContain('-nostdin');
    expect(valueAfter(args, '-protocol_whitelist')).toBe('file');
    expect(valueAfter(args, '-map')).toBe('0:a:0');
    for (const flag of ['-vn', '-sn', '-dn']) expect(args).toContain(flag);
  });

  it('bounds the read at 302 s and the output at 8 MB', () => {
    expect(valueAfter(args, '-t')).toBe(String(VOICE_INPUT_LIMIT_SECONDS));
    expect(VOICE_INPUT_LIMIT_SECONDS).toBe(302);
    expect(valueAfter(args, '-fs')).toBe('8000000');
  });

  it('writes mono AAC with the index at the front', () => {
    expect(valueAfter(args, '-ac')).toBe('1');
    expect(valueAfter(args, '-movflags')).toBe('+faststart');
    expect(valueAfter(args, '-f', args.indexOf('-i'))).toBe('mp4');
    expect(args.at(-1)).toBe('/tmp/x/out.mp4');
  });

  it.each([
    ['audio/webm', 'matroska', 'opus'],
    ['audio/mp4', 'mov', 'aac'],
    ['audio/ogg', 'ogg', 'opus'],
  ])('%s pins the demuxer %s and the decoder %s BEFORE the input', (mime, demuxer, decoder) => {
    const built = buildNormalizeArgs(mime, 'in', 'out');
    const inputAt = built.indexOf('-i');
    expect(valueAfter(built, '-f')).toBe(demuxer);
    expect(built.indexOf('-f')).toBeLessThan(inputAt);
    expect(valueAfter(built, '-c:a')).toBe(decoder);
    expect(built.indexOf('-c:a')).toBeLessThan(inputAt);
    expect(voiceDemuxerFor(mime)).toBe(demuxer);
    expect(voiceDecoderFor(mime)).toBe(decoder);
  });

  it('refuses an unlisted mime instead of letting ffmpeg probe the file', () => {
    expect(() => buildNormalizeArgs('audio/mpeg', 'in', 'out')).toThrow(VoiceNormalizeError);
    expect(() => buildNormalizeArgs('constructor', 'in', 'out')).toThrow(VoiceNormalizeError);
  });
});

describe('judgeVoiceDuration', () => {
  it('rounds an accepted value and clamps it to 1..300', () => {
    expect(judgeVoiceDuration(0.4)).toBe(1);
    expect(judgeVoiceDuration(1)).toBe(1);
    expect(judgeVoiceDuration(2.6)).toBe(3);
    expect(judgeVoiceDuration(300)).toBe(300);
    expect(judgeVoiceDuration(300.4)).toBe(300);
    expect(judgeVoiceDuration(VOICE_REJECT_ABOVE_SECONDS)).toBe(300);
  });

  it('above 301 seconds is duration_too_long, never truncated into a pass', () => {
    for (const seconds of [301.01, 302, 400]) {
      expect(() => judgeVoiceDuration(seconds)).toThrow(
        expect.objectContaining({ reason: 'duration_too_long' }),
      );
    }
  });

  it('NaN, infinity, zero and a negative are transcode_failed', () => {
    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      expect(() => judgeVoiceDuration(seconds)).toThrow(
        expect.objectContaining({ reason: 'transcode_failed' }),
      );
    }
  });

  it('the input bound is exactly one second above the verdict line', () => {
    expect(VOICE_INPUT_LIMIT_SECONDS).toBe(VOICE_REJECT_ABOVE_SECONDS + 1);
  });
});
