import { VOICE_MAX_SECONDS } from '@rede-social/contracts/media';
import { describe, expect, it } from 'vitest';
import {
  CHAT_SUBJECT_MAX,
  CHAT_VOICE_MAX_SECONDS,
  messageRowSchema,
  messageVoiceSchema,
  sendResultSchema,
  voiceReplyInputSchema,
  voiceSendInputSchema,
} from '../contracts/index';

/**
 * The chat contracts of a voice message (Phase 12.5, plan 05; D-846, D-866, VOICE-04): the member's send input,
 * the staff reply input, the optional `voice` key of a message row and the duration bound. The pre-12.5 text row
 * fixtures keep parsing byte for byte (every new key is optional).
 */

const ID = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const MEDIA = '0f3f4a35-5f1b-4c52-a0e5-5d0e0c0a7a11';

const textRow = {
  id: ID,
  seq: 3,
  side: 'member',
  body: 'Oi',
  createdAt: '2026-11-17T10:00:00.000000Z',
  author: null,
  authorIsViewer: true,
} as const;

const voiceRow = {
  ...textRow,
  body: '',
  voice: { mediaId: MEDIA, durationSeconds: 12 },
};

describe('voice contracts', () => {
  it('the local duration bound equals the media contract bound', () => {
    expect(CHAT_VOICE_MAX_SECONDS).toBe(VOICE_MAX_SECONDS);
  });

  describe('voiceSendInputSchema', () => {
    it('accepts the media id alone and with the opener pair', () => {
      expect(voiceSendInputSchema.parse({ mediaId: MEDIA })).toEqual({ mediaId: MEDIA });
      expect(
        voiceSendInputSchema.parse({ mediaId: MEDIA, category: 'payment', subject: 'Pix' }),
      ).toEqual({ mediaId: MEDIA, category: 'payment', subject: 'Pix' });
    });

    it('trims a subject and drops a blank one', () => {
      expect(voiceSendInputSchema.parse({ mediaId: MEDIA, subject: '  Pix  ' }).subject).toBe(
        'Pix',
      );
      expect(
        voiceSendInputSchema.parse({ mediaId: MEDIA, subject: '   ' }).subject,
      ).toBeUndefined();
    });

    it('refuses an unknown key, a number for the media id and an unknown category', () => {
      expect(voiceSendInputSchema.safeParse({ mediaId: MEDIA, priority: 'high' }).success).toBe(
        false,
      );
      expect(voiceSendInputSchema.safeParse({ mediaId: MEDIA, durationSeconds: 3 }).success).toBe(
        false,
      );
      expect(voiceSendInputSchema.safeParse({ mediaId: MEDIA, body: 'oi' }).success).toBe(false);
      expect(voiceSendInputSchema.safeParse({ mediaId: 7 }).success).toBe(false);
      expect(voiceSendInputSchema.safeParse({ mediaId: 'nope' }).success).toBe(false);
      expect(voiceSendInputSchema.safeParse({}).success).toBe(false);
      expect(voiceSendInputSchema.safeParse({ mediaId: MEDIA, category: 'billing' }).success).toBe(
        false,
      );
    });

    it('a subject of 81 code points is subject_too_long, 80 is fine', () => {
      const long = voiceSendInputSchema.safeParse({
        mediaId: MEDIA,
        subject: '😀'.repeat(CHAT_SUBJECT_MAX + 1),
      });
      expect(long.success).toBe(false);
      if (!long.success)
        expect(long.error.issues.map((i) => i.message)).toEqual(['subject_too_long']);
      expect(
        voiceSendInputSchema.safeParse({ mediaId: MEDIA, subject: '😀'.repeat(CHAT_SUBJECT_MAX) })
          .success,
      ).toBe(true);
    });
  });

  describe('voiceReplyInputSchema', () => {
    it('accepts only the media id', () => {
      expect(voiceReplyInputSchema.parse({ mediaId: MEDIA })).toEqual({ mediaId: MEDIA });
      expect(voiceReplyInputSchema.safeParse({ mediaId: MEDIA, category: 'other' }).success).toBe(
        false,
      );
      expect(voiceReplyInputSchema.safeParse({ mediaId: MEDIA, subject: 'x' }).success).toBe(false);
      expect(voiceReplyInputSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('messageRowSchema', () => {
    it('still parses the pre-12.5 text row with NO voice key, byte for byte', () => {
      const parsed = messageRowSchema.parse(textRow);
      expect(parsed).toEqual(textRow);
      expect('voice' in parsed).toBe(false);
    });

    it('parses a voice row with an empty body, and with voice.deleted', () => {
      expect(messageRowSchema.parse(voiceRow)).toEqual(voiceRow);
      const gone = { ...voiceRow, voice: { ...voiceRow.voice, deleted: true } };
      expect(messageRowSchema.parse(gone)).toEqual(gone);
    });

    it('refuses a duration of 0 or 301 and an unknown key inside voice', () => {
      for (const durationSeconds of [0, 301]) {
        expect(
          messageRowSchema.safeParse({ ...voiceRow, voice: { mediaId: MEDIA, durationSeconds } })
            .success,
        ).toBe(false);
      }
      expect(
        messageRowSchema.safeParse({ ...voiceRow, voice: { ...voiceRow.voice, url: 'x' } }).success,
      ).toBe(false);
      expect(messageRowSchema.safeParse({ ...voiceRow, voice: null }).success).toBe(false);
    });

    it('accepts the bounds 1 and 300 seconds', () => {
      for (const durationSeconds of [1, CHAT_VOICE_MAX_SECONDS]) {
        expect(messageVoiceSchema.safeParse({ mediaId: MEDIA, durationSeconds }).success).toBe(
          true,
        );
      }
    });
  });

  it('the send answer carries a voice message and the case', () => {
    const answer = {
      conversationId: ID,
      message: voiceRow,
      case: { id: ID, number: 4, state: 'open', opened: true, reopened: false },
    };
    expect(sendResultSchema.parse(answer)).toEqual(answer);
  });
});
