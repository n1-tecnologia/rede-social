import { readFileSync } from 'node:fs';
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
  it('declares exactly the keys of the contract and nothing invented', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.member.json'), 'utf8'),
    );
    expect(Object.keys(parsed.profileForm.member.stepper).sort()).toEqual(
      [
        'back',
        'finish',
        'hidden',
        'next',
        'pendingElsewhere',
        'progress',
        'revealedMany',
        'revealedOne',
        'savedHint',
      ].sort(),
    );
  });

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

  it('the notice that sends the member back to a step the gate still finds incomplete', () => {
    expect(t('stepper.pendingElsewhere', { step: 'Informações gerais' })).toBe(
      'Falta responder uma pergunta obrigatória na etapa “Informações gerais”. Levamos você até lá.',
    );
  });

  it('the announcements of a question that opens and of questions that close', () => {
    expect(t('stepper.revealedOne', { title: 'Nome da clínica' })).toBe(
      'Apareceu uma nova pergunta: Nome da clínica.',
    );
    expect(t('stepper.revealedMany', { count: 3 })).toBe('Apareceram 3 novas perguntas.');
    expect(t('stepper.hidden', { count: 1 })).toBe('Uma pergunta saiu da lista.');
    expect(t('stepper.hidden', { count: 2 })).toBe('2 perguntas saíram da lista.');
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
