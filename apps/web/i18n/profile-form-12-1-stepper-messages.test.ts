import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.1-14 (PFORM-34, PFORM-42; UI-D-653, UI-D-654, UI-D-655) — the member stepper's catalog block, string by
 * string against the approved Copywriting Contract ("Member"), through the real merged catalog and the real
 * next-intl formatter, so a plural that stops parsing fails here and not on a phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.member',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.member.stepper: verbatim strings of the Copywriting Contract', () => {
  it('the progress eyebrow and the buttons', () => {
    expect(t('stepper.progress', { current: 2, total: 3 })).toBe('Etapa 2 de 3');
    expect(t('stepper.back')).toBe('Voltar');
    expect(t('stepper.next')).toBe('Avançar');
    expect(t('stepper.finish')).toBe('Concluir');
  });

  it('the hint under the buttons', () => {
    expect(t('stepper.savedHint')).toBe(
      'Suas respostas de cada etapa ficam salvas quando você avança.',
    );
  });

  it('keeps the Phase 12 button and state strings the stepper reuses', () => {
    expect(t('save')).toBe('Salvar');
    expect(t('saving')).toBe('Salvando…');
    expect(t('saved')).toBe('Respostas salvas.');
    expect(t('saveFailed')).toBe(
      'Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.',
    );
    expect(t('offline')).toBe(
      'Você está sem conexão. Suas respostas continuam aqui; salve quando voltar.',
    );
  });
});
