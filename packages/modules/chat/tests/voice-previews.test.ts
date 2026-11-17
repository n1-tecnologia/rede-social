import { describe, expect, it } from 'vitest';
import { lastMessagePreview, subjectLabelOf } from '../server/cases';
import {
  CHAT_PUSH_BODY_MAX,
  CHAT_VOICE_COPY,
  caseNewPushCopy,
  caseReopenedPushCopy,
  formatVoiceClock,
  memberMessagePushCopy,
  supportReplyPushCopy,
  voicePreview,
} from '../server/notification-copy';

/**
 * The words of a recording on the server (Phase 12.5, plan 09; D-860, D-861, D-868; VOICE-28, VOICE-29, VOICE-30):
 * the `m:ss` clock, the push preview, the constant label of a case opened by voice and the `lastMessage` facts of
 * a list row. Pure functions, no database.
 */

const graphemes = (text: string): number =>
  [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].length;

describe('formatVoiceClock', () => {
  it.each([
    [0, '0:00'],
    [1, '0:01'],
    [9, '0:09'],
    [10, '0:10'],
    [42, '0:42'],
    [59, '0:59'],
    [60, '1:00'],
    [61, '1:01'],
    [65, '1:05'],
    [119, '1:59'],
    [300, '5:00'],
  ])('%i seconds reads %s', (seconds, clock) => {
    expect(formatVoiceClock(seconds)).toBe(clock);
  });

  it('clamps to 0..300 and rounds a fraction, and never prints NaN', () => {
    expect(formatVoiceClock(-4)).toBe('0:00');
    expect(formatVoiceClock(301)).toBe('5:00');
    expect(formatVoiceClock(10_000)).toBe('5:00');
    expect(formatVoiceClock(41.6)).toBe('0:42');
    expect(formatVoiceClock(41.4)).toBe('0:41');
    expect(formatVoiceClock(Number.NaN)).toBe('0:00');
    expect(formatVoiceClock(Number.POSITIVE_INFINITY)).toBe('5:00');
  });
});

describe('the push words of a recording', () => {
  const preview = voicePreview(42);

  it('the constants and the preview are the specified words', () => {
    expect(CHAT_VOICE_COPY.label).toBe('Mensagem de voz');
    expect(CHAT_VOICE_COPY.deleted).toBe('Mensagem de voz apagada');
    expect(preview).toBe('Mensagem de voz · 0:42');
  });

  it('the three team sentences carry the preview in the slot a text preview takes', () => {
    expect(caseNewPushCopy(42, 'Ana Souza', preview)).toBe(
      'Novo chamado #42 de Ana Souza: Mensagem de voz · 0:42',
    );
    expect(caseReopenedPushCopy(42, 'Ana Souza', preview)).toBe(
      'O chamado #42 de Ana Souza foi reaberto: Mensagem de voz · 0:42',
    );
    expect(memberMessagePushCopy('Ana Souza', 42, preview)).toBe(
      'Nova mensagem de Ana Souza no chamado #42: Mensagem de voz · 0:42',
    );
  });

  it("the member's push for a staff voice reply is the preview alone", () => {
    expect(supportReplyPushCopy(preview)).toBe('Mensagem de voz · 0:42');
  });

  it('a long member name still cuts the whole banner on a word at 100 graphemes, as for text', () => {
    const longName = Array.from({ length: 30 }, () => 'Sobrenome').join(' ');
    const banner = memberMessagePushCopy(longName, 42, preview);
    expect(graphemes(banner)).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(banner.endsWith('…')).toBe(true);
    expect(banner.startsWith('Nova mensagem de Sobrenome Sobrenome')).toBe(true);
  });

  it('a produced string never carries an id, a path or a URL (T-12.5-37)', () => {
    const produced = [
      preview,
      caseNewPushCopy(42, 'Ana Souza', preview),
      caseReopenedPushCopy(42, 'Ana Souza', preview),
      memberMessagePushCopy('Ana Souza', 42, preview),
      supportReplyPushCopy(preview),
    ];
    for (const text of produced) {
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(text).not.toMatch(/https?:|\/media\/|\.(webm|mp4|m4a)/);
    }
  });
});

describe('subjectLabelOf', () => {
  it('the typed subject wins over everything else', () => {
    expect(subjectLabelOf('  Problema   no pagamento ', 'texto', false)).toBe(
      'Problema no pagamento',
    );
    expect(subjectLabelOf('Problema no pagamento', null, true)).toBe('Problema no pagamento');
    expect(subjectLabelOf('Problema no pagamento', 'texto', true)).toBe('Problema no pagamento');
  });

  it('a case opened by a recording with no typed subject is the constant label, no duration', () => {
    expect(subjectLabelOf(null, null, true)).toBe('Mensagem de voz');
    expect(subjectLabelOf('', null, true)).toBe('Mensagem de voz');
    expect(subjectLabelOf('   ', '', true)).toBe('Mensagem de voz');
    expect(subjectLabelOf(null, null, true)).not.toMatch(/\d/);
  });

  it('a text first message is the cut first text as before', () => {
    expect(subjectLabelOf(null, 'Quero   trocar\nmeu e-mail', false)).toBe(
      'Quero trocar meu e-mail',
    );
    const long = `${'palavra '.repeat(30)}fim`;
    const label = subjectLabelOf(null, long, false);
    expect(label.endsWith('…')).toBe(true);
    expect(graphemes(label)).toBeLessThanOrEqual(81);
  });

  it('nothing at all is the empty string', () => {
    expect(subjectLabelOf(null, null, false)).toBe('');
    expect(subjectLabelOf('', '   ', false)).toBe('');
  });
});

describe('lastMessagePreview', () => {
  it('a text message is the cut body and has no voice key', () => {
    const text = lastMessagePreview('Preciso de ajuda', null, false);
    expect(text).toEqual({ preview: 'Preciso de ajuda' });
    expect('voiceSeconds' in text).toBe(false);
    expect('voiceDeleted' in text).toBe(false);
  });

  it('a recording is an empty preview plus the stored length and no deleted key', () => {
    const live = lastMessagePreview(null, 42, false);
    expect(live).toEqual({ preview: '', voiceSeconds: 42 });
    expect('voiceDeleted' in live).toBe(false);
  });

  it('a gone recording keeps the length and says it is deleted', () => {
    expect(lastMessagePreview(null, 42, true)).toEqual({
      preview: '',
      voiceSeconds: 42,
      voiceDeleted: true,
    });
  });

  it('a text body never reads the gone flag', () => {
    expect(lastMessagePreview('oi', null, true)).toEqual({ preview: 'oi' });
  });
});
