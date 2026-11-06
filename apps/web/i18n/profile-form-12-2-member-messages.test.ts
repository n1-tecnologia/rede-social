import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.2-14 (D-641, D-643, D-644, D-645; UI-D-679, UI-D-680): the member strings that branches add, verbatim
 * against the approved Copywriting Contract, through the real merged catalog and the real next-intl formatter,
 * so a plural that stops parsing fails here and not on a phone. Everything else a member reads in a block (the
 * 12.1 announcements, the erase dialog) is pinned by the 12.1 tests and is NOT changed by this phase.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.member',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.member.stepper: the other-step announcements of the one-scroll edit', () => {
  it('declares both keys under stepper, exactly as the Copywriting Contract names them', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.member.json'), 'utf8'),
    );
    expect(parsed.profileForm.member.stepper).toHaveProperty('revealedOtherStep');
    expect(parsed.profileForm.member.stepper).toHaveProperty('hiddenOtherStep');
  });

  it('a block that opens in another step: one question names the step, several count', () => {
    expect(t('stepper.revealedOtherStep', { count: 1, step: 'Sobre a clínica' })).toBe(
      'Apareceu uma nova pergunta na etapa “Sobre a clínica”.',
    );
    expect(t('stepper.revealedOtherStep', { count: 3, step: 'Contato' })).toBe(
      'Apareceram 3 novas perguntas na etapa “Contato”.',
    );
  });

  it('a block that leaves another step: one question names the step, several count', () => {
    expect(t('stepper.hiddenOtherStep', { count: 1, step: 'Sobre a clínica' })).toBe(
      'Uma pergunta saiu da etapa “Sobre a clínica”.',
    );
    expect(t('stepper.hiddenOtherStep', { count: 2, step: 'Contato' })).toBe(
      '2 perguntas saíram da etapa “Contato”.',
    );
  });

  it('carries the step title only: no answer, no branch name, no placeholder besides count and step', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.member.json'), 'utf8'),
    );
    for (const key of ['revealedOtherStep', 'hiddenOtherStep']) {
      const text: string = parsed.profileForm.member.stepper[key];
      const names = [...text.matchAll(/\{(\w+)/g)].map((match) => match[1]);
      expect(new Set(names)).toEqual(new Set(['count', 'step']));
      expect(text).not.toMatch(/ramo/i);
    }
  });
});
