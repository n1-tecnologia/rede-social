import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.1-15 (D-626, D-634; UI-D-656, UI-D-659; PFORM-36, PFORM-39) — the erase dialog's catalog block and the
 * staff "Não se aplica" string, verbatim against the approved Copywriting Contract, through the real merged
 * catalog and the real next-intl formatter, so a plural that stops parsing fails here and not on a phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
type Translate = (key: string, values?: Record<string, string | number>) => string;
const member = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.member',
}) as unknown as Translate;

describe('profileForm.member.erase: verbatim strings of the Copywriting Contract', () => {
  it('declares exactly the keys of the contract and nothing invented', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.member.json'), 'utf8'),
    );
    expect(Object.keys(parsed.profileForm.member.erase).sort()).toEqual(
      ['body', 'cancel', 'confirmNext', 'confirmSave', 'hint', 'listLabel', 'more', 'title'].sort(),
    );
  });

  it('the title and the three buttons', () => {
    expect(member('erase.title')).toBe('Apagar respostas que deixaram de valer?');
    expect(member('erase.confirmNext')).toBe('Apagar e continuar');
    expect(member('erase.confirmSave')).toBe('Apagar e salvar');
    expect(member('erase.cancel')).toBe('Rever respostas');
  });

  it('the body in the singular and in the plural', () => {
    expect(member('erase.body', { n: 1 })).toBe(
      'Você mudou uma resposta e a pergunta abaixo deixou de se aplicar. A sua resposta a ela será apagada.',
    );
    expect(member('erase.body', { n: 3 })).toBe(
      'Você mudou uma resposta e 3 perguntas abaixo deixaram de se aplicar. As suas respostas a elas serão apagadas.',
    );
  });

  it('the overflow line, the hint and the list label', () => {
    expect(member('erase.more', { count: 1 })).toBe('e mais 1 pergunta');
    expect(member('erase.more', { count: 2 })).toBe('e mais 2 perguntas');
    expect(member('erase.hint')).toBe('Se você voltar atrás, vai precisar responder de novo.');
    expect(member('erase.listLabel')).toBe('Perguntas que serão apagadas');
  });

  it('never promises that every deleted answer is listed (D-636)', () => {
    const copy = ['title', 'body', 'more', 'hint', 'confirmNext', 'confirmSave', 'cancel']
      .map((key) => member(`erase.${key}`, { n: 2, count: 2 }))
      .join(' ')
      .toLowerCase();
    expect(copy).not.toContain('todas as respostas');
    expect(copy).not.toContain('arquivad');
  });

  it('keeps the Phase 12 strings the dialog reuses', () => {
    expect(member('saving')).toBe('Salvando…');
    expect(member('saveFailed')).toBe(
      'Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.',
    );
  });
});

const profile = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.profile',
}) as unknown as Translate;

describe('profileForm.profile.staff.notApplicable: the staff reading of a closed follow-up (UI-D-659)', () => {
  it('reads "Não se aplica" and leaves the Phase 12 staff strings as they were', () => {
    expect(profile('staff.notApplicable')).toBe('Não se aplica');
    expect(profile('answers.none')).toBe('Sem resposta');
    expect(profile('staff.public')).toBe('Público no perfil');
    expect(profile('staff.archived')).toBe('Arquivada');
    expect(profile('staff.empty')).toBe('Esta pessoa ainda não respondeu o formulário.');
  });

  it('declares exactly the staff keys of Phase 12 plus the one new string', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.profile.json'), 'utf8'),
    );
    expect(Object.keys(parsed.profileForm.profile.staff).sort()).toEqual(
      ['archived', 'archivedTitle', 'empty', 'notApplicable', 'public', 'title'].sort(),
    );
  });
});
