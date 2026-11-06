import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.2-15 (D-640, D-641, D-642, D-643, D-652; UI-D-666, UI-D-667, UI-D-668): the admin strings that branches add
 * to the Lista, verbatim against the approved Copywriting Contract, through the real merged catalog and the
 * real next-intl formatter, so a plural that stops parsing fails here and not in the builder. The 12.1 strings
 * (`row.opens`, `reorder.mustFollow`, `reorder.mustPrecede`) are reused and pinned by their own tests.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.admin',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const parsed = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.admin.json'), 'utf8'),
);

describe('profileForm.admin.branches: the strip of a branch in the Lista (UI-D-666)', () => {
  it('declares the Lista keys under branches, exactly as the Copywriting Contract names them', () => {
    const branches = parsed.profileForm.admin.branches;
    for (const key of [
      'label',
      'count',
      'openerStep',
      'edit',
      'addQuestion',
      'addQuestionLabel',
      'empty',
    ]) {
      expect(branches).toHaveProperty(key);
    }
    expect(branches.row).toHaveProperty('inBranch');
  });

  it('the label of a branch with no name has no final period', () => {
    expect(t('branches.label', { opener: 'Tem clínica?', options: '“Tenho” ou “Trabalho”' })).toBe(
      'Se “Tem clínica?” for “Tenho” ou “Trabalho”',
    );
    expect(t('branches.label', { opener: 'Tem equipe?', options: 'Sim' })).toBe(
      'Se “Tem equipe?” for Sim',
    );
  });

  it('the count is an ICU plural: none, one, many', () => {
    expect(t('branches.count', { count: 0 })).toBe('Sem perguntas');
    expect(t('branches.count', { count: 1 })).toBe('1 pergunta');
    expect(t('branches.count', { count: 3 })).toBe('3 perguntas');
  });

  it('says where the deciding question is when it sits in another step', () => {
    expect(t('branches.openerStep', { step: 'Informações gerais' })).toBe(
      'A pergunta que decide está na etapa “Informações gerais”.',
    );
  });

  it('the pencil, the footer and the empty line read as the contract says', () => {
    expect(t('branches.edit', { label: 'Quem tem clínica' })).toBe('Editar ramo: Quem tem clínica');
    expect(t('branches.addQuestion')).toBe('Adicionar pergunta ao ramo');
    expect(t('branches.addQuestionLabel', { label: 'Quem tem clínica' })).toBe(
      'Adicionar pergunta ao ramo: Quem tem clínica',
    );
    expect(t('branches.empty')).toBe(
      'Este ramo está vazio. Ele só muda algo para os membros quando tiver uma pergunta.',
    );
  });

  it('the row description names the branch the row sits in', () => {
    expect(t('branches.row.inBranch', { label: 'Se “A” for Sim' })).toBe(
      'Fica no ramo: Se “A” for Sim.',
    );
  });

  it('keeps the 12.1 "Abre N" pill as it was', () => {
    expect(t('row.opens', { count: 1 })).toBe('Abre 1 pergunta');
    expect(t('row.opens', { count: 3 })).toBe('Abre 3 perguntas');
  });
});

describe('profileForm.admin.branches.reorder: the branch arrows and their announcement (UI-D-668)', () => {
  it('declares up, down and moved under branches.reorder', () => {
    const reorder = parsed.profileForm.admin.branches.reorder;
    for (const key of ['up', 'down', 'moved']) expect(reorder).toHaveProperty(key);
  });

  it('labels the arrows with the curly-quoted label of the branch', () => {
    expect(t('branches.reorder.up', { label: 'Se “A” for Sim' })).toBe(
      'Subir ramo “Se “A” for Sim”',
    );
    expect(t('branches.reorder.down', { label: 'Quem tem clínica' })).toBe(
      'Descer ramo “Quem tem clínica”',
    );
  });

  it('announces the new place of the branch among the branches of its question', () => {
    expect(t('branches.reorder.moved', { label: 'Quem tem clínica', position: 2, total: 3 })).toBe(
      'O ramo “Quem tem clínica” agora é o ramo 2 de 3 desta pergunta.',
    );
  });

  it('reuses the 12.1 refusal sentences that name the two questions', () => {
    expect(t('reorder.mustFollow', { title: 'A', other: 'B' })).toBe(
      '“A” precisa ficar depois de “B”, que decide se ela aparece.',
    );
    expect(t('reorder.mustPrecede', { title: 'B', other: 'A' })).toBe(
      '“B” precisa ficar antes de “A”, que só aparece conforme a resposta dela.',
    );
  });
});
