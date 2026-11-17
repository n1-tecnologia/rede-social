import { describe, expect, it } from 'vitest';
import {
  fileSignaturePrefixBytes,
  inspectAudioSignature,
  inspectFile,
  MediaImageError,
} from '../server/media/inspect';

/**
 * 12.5-02 (D-863, VOICE-15): the request path judges a voice take by its first bytes alone, against the
 * signature the DECLARED mime demands. The buffers are built here, 16 bytes each, exactly the size of
 * the ranged read `complete` performs; nothing is decoded.
 */

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** An MP4 starts with a box size, then `ftyp` at offset 4. */
function mp4Prefix(): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(0x18, 0);
  buf.write('ftyp', 4, 'latin1');
  buf.write('M4A ', 8, 'latin1');
  return buf;
}

function webmPrefix(): Buffer {
  const buf = Buffer.alloc(16);
  EBML.copy(buf, 0);
  return buf;
}

function oggPrefix(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('OggS', 0, 'latin1');
  return buf;
}

const PREFIXES: Record<string, () => Buffer> = {
  'audio/webm': webmPrefix,
  'audio/mp4': mp4Prefix,
  'audio/ogg': oggPrefix,
};

function reasonOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof MediaImageError) return error.reason;
    throw error;
  }
}

describe('inspectAudioSignature', () => {
  it.each(Object.keys(PREFIXES))(
    '%s: the signature the declared mime demands is accepted',
    (mime) => {
      expect(
        reasonOf(() => inspectAudioSignature(PREFIXES[mime]?.() ?? Buffer.alloc(0), mime)),
      ).toBe(null);
    },
  );

  it('the three cross-mismatches are all format_mismatch', () => {
    const cases: [string, string][] = [
      ['audio/mp4', 'audio/webm'],
      ['audio/webm', 'audio/ogg'],
      ['audio/ogg', 'audio/mp4'],
      ['audio/webm', 'audio/mp4'],
      ['audio/ogg', 'audio/webm'],
      ['audio/mp4', 'audio/ogg'],
    ];
    for (const [declared, actual] of cases) {
      const buf = PREFIXES[actual]?.() ?? Buffer.alloc(0);
      expect(reasonOf(() => inspectAudioSignature(buf, declared))).toBe('format_mismatch');
    }
  });

  it('an MP4 whose ftyp sits at offset 0 instead of 4 is not an MP4', () => {
    const buf = Buffer.alloc(16);
    buf.write('ftyp', 0, 'latin1');
    expect(reasonOf(() => inspectAudioSignature(buf, 'audio/mp4'))).toBe('format_mismatch');
  });

  it('a short buffer (shorter than the offset plus the magic) and an empty buffer are format_mismatch', () => {
    expect(reasonOf(() => inspectAudioSignature(Buffer.from([0x1a, 0x45]), 'audio/webm'))).toBe(
      'format_mismatch',
    );
    expect(reasonOf(() => inspectAudioSignature(mp4Prefix().subarray(0, 7), 'audio/mp4'))).toBe(
      'format_mismatch',
    );
    expect(reasonOf(() => inspectAudioSignature(Buffer.alloc(0), 'audio/ogg'))).toBe(
      'format_mismatch',
    );
  });

  it('an unlisted mime is format_mismatch, whatever the bytes', () => {
    expect(reasonOf(() => inspectAudioSignature(webmPrefix(), 'audio/mpeg'))).toBe(
      'format_mismatch',
    );
    expect(reasonOf(() => inspectAudioSignature(webmPrefix(), 'constructor'))).toBe(
      'format_mismatch',
    );
  });
});

describe('inspectFile routes the audio mimes to the signature check', () => {
  it('accepts a matching prefix and refuses a mismatching one with the same code', async () => {
    await expect(inspectFile(oggPrefix(), 'audio/ogg')).resolves.toBeUndefined();
    await expect(inspectFile(webmPrefix(), 'audio/mp4')).rejects.toMatchObject({
      reason: 'format_mismatch',
    });
  });

  it('the request path reads a 16 byte prefix for every audio mime, never the whole object', () => {
    for (const mime of Object.keys(PREFIXES)) expect(fileSignaturePrefixBytes(mime)).toBe(16);
  });
});
