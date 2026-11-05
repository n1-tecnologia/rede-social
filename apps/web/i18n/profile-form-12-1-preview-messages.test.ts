import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.1-18 (D-627, D-628; UI-D-652; PFORM-37, PFORM-42) — the preview strings of the admin catalog, verbatim
 * against the approved Copywriting Contract, through the real merged catalog and the real next-intl
 * formatter, so a plural that stops parsing fails here and not on a phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
type Translate = (key: string, values?: Record<string, string | number>) => string;
const preview = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.admin.preview',
}) as unknown as Translate;
const member = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.member',
}) as unknown as Translate;

describe('profileForm.admin.preview: verbatim strings of the Copywriting Contract', () => {
  it('declares exactly the Phase 12 keys plus the three of the contract and nothing invented', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.admin.json'), 'utf8'),
    );
    expect(Object.keys(parsed.profileForm.admin.preview).sort()).toEqual(
      ['open', 'restart', 'skipNote', 'summary', 'title'].sort(),
    );
  });

  it('the extra banner sentence and the restart button', () => {
    expect(preview('skipNote')).toBe('Aqui você avança sem precisar responder.');
    expect(preview('restart')).toBe('Recomeçar');
  });

  it('the status line in the singular and in the plural of each count', () => {
    expect(preview('summary', { steps: 2, questions: 3 })).toBe(
      'Com estas respostas, o membro vê 2 etapas e 3 perguntas.',
    );
    expect(preview('summary', { steps: 1, questions: 1 })).toBe(
      'Com estas respostas, o membro vê 1 etapa e 1 pergunta.',
    );
    expect(preview('summary', { steps: 3, questions: 1 })).toBe(
      'Com estas respostas, o membro vê 3 etapas e 1 pergunta.',
    );
    expect(preview('summary', { steps: 1, questions: 6 })).toBe(
      'Com estas respostas, o membro vê 1 etapa e 6 perguntas.',
    );
  });

  it('keeps the Phase 12 preview strings the sheet reuses', () => {
    expect(preview('open')).toBe('Ver como o membro vê');
    expect(preview('title')).toBe('Como o membro vê');
    expect(member('preview.banner')).toBe('Prévia: nada do que você preencher aqui é salvo.');
    expect(member('preview.close')).toBe('Fechar');
  });

  it('the preview never promises a save (the last button is Fechar, not Concluir)', () => {
    const copy = [
      preview('skipNote'),
      preview('summary', { steps: 2, questions: 2 }),
      preview('restart'),
    ]
      .join(' ')
      .toLowerCase();
    expect(copy).not.toContain('salv');
    expect(copy).not.toContain('concluir');
  });
});
