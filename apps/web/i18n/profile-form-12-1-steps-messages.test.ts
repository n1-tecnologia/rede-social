import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.1-16 (PFORM-27, PFORM-28, PFORM-37, PFORM-42; UI-D-642..UI-D-646) — the builder's steps catalog block,
 * string by string against the approved Copywriting Contract ("Admin: steps"), through the real merged
 * catalog and the real next-intl formatter, so a plural that stops parsing fails here and not on a phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.admin',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.admin.steps: verbatim strings of the Copywriting Contract', () => {
  it('declares exactly the keys of the contract and nothing invented', () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'profileForm.admin.json'), 'utf8'),
    );
    const steps = parsed.profileForm.admin.steps;
    expect(Object.keys(steps).sort()).toEqual(
      [
        'add',
        'addQuestion',
        'addQuestionLabel',
        'count',
        'defaultTitle',
        'delete',
        'empty',
        'errors',
        'eyebrow',
        'limit',
        'note',
        'rename',
        'reorder',
        'sheet',
        'toasts',
      ].sort(),
    );
    expect(Object.keys(steps.sheet).sort()).toEqual(
      [
        'counter',
        'createTitle',
        'delete',
        'discardBody',
        'errors',
        'failed',
        'field',
        'last',
        'notEmpty',
        'placeholder',
        'renameTitle',
        'save',
        'saving',
      ].sort(),
    );
  });

  it('the actions row and the one-time note', () => {
    expect(t('steps.add')).toBe('Adicionar etapa');
    expect(t('steps.note')).toBe(
      'Os membros respondem uma etapa por vez e avançam com “Avançar”. Uma etapa sem pergunta visível para o membro é pulada.',
    );
  });

  it('the well: eyebrow, the plural meta line, rename and the footer button', () => {
    expect(t('steps.eyebrow', { n: 2 })).toBe('Etapa 2');
    expect(t('steps.count', { count: 0 })).toBe('Sem perguntas');
    expect(t('steps.count', { count: 1 })).toBe('1 pergunta');
    expect(t('steps.count', { count: 3 })).toBe('3 perguntas');
    expect(t('steps.rename', { title: 'Contato' })).toBe('Renomear etapa: Contato');
    expect(t('steps.addQuestion')).toBe('Adicionar pergunta');
    expect(t('steps.addQuestionLabel', { title: 'Contato' })).toBe(
      'Adicionar pergunta à etapa: Contato',
    );
    expect(t('steps.empty')).toBe(
      'Esta etapa está vazia. Enquanto estiver vazia, os membros não a veem.',
    );
    expect(t('steps.defaultTitle')).toBe('Informações gerais');
  });

  it('the step limit takes its number from the caller, never from the catalog', () => {
    expect(t('steps.limit', { max: 10 })).toBe(
      'Você chegou ao limite de 10 etapas. Exclua uma etapa vazia para adicionar outra.',
    );
    expect(t('steps.limit', { max: 12 })).toContain('12 etapas');
    const raw = readFileSync(
      join(process.cwd(), 'messages', 'pt-BR', 'profileForm.admin.json'),
      'utf8',
    );
    expect(raw).toContain('limite de {max} etapas');
  });

  it('the step sheet', () => {
    expect(t('steps.sheet.createTitle')).toBe('Nova etapa');
    expect(t('steps.sheet.renameTitle')).toBe('Renomear etapa');
    expect(t('steps.sheet.field')).toBe('Título da etapa');
    expect(t('steps.sheet.placeholder')).toBe('Ex.: Sobre a sua clínica');
    expect(t('steps.sheet.counter', { n: 19, max: 60 })).toBe('19/60');
    expect(t('steps.sheet.errors.required')).toBe('Escreva o título da etapa.');
    expect(t('steps.sheet.errors.tooLong', { max: 60 })).toBe('Use até 60 caracteres.');
    expect(t('steps.sheet.save')).toBe('Salvar etapa');
    expect(t('steps.sheet.saving')).toBe('Salvando…');
    expect(t('steps.sheet.delete')).toBe('Excluir etapa');
    expect(t('steps.sheet.notEmpty')).toBe(
      'Para excluir esta etapa, mova ou arquive as perguntas dela primeiro.',
    );
    expect(t('steps.sheet.last')).toBe('Todo formulário precisa de pelo menos uma etapa.');
    expect(t('steps.sheet.discardBody')).toBe('As mudanças desta etapa ainda não foram salvas.');
    expect(t('steps.sheet.failed')).toBe('Não foi possível salvar a etapa agora. Tente de novo.');
  });

  it('the delete confirmation, whose dismiss has its own name', () => {
    expect(t('steps.delete.title')).toBe('Excluir esta etapa?');
    expect(t('steps.delete.body')).toBe('Ela está vazia. A exclusão não pode ser desfeita.');
    expect(t('steps.delete.confirm')).toBe('Excluir');
    expect(t('steps.delete.cancel')).toBe('Manter etapa');
  });

  it('the toasts and the 409 of a step that received questions', () => {
    expect(t('steps.toasts.added')).toBe('Etapa adicionada.');
    expect(t('steps.toasts.renamed')).toBe('Etapa renomeada.');
    expect(t('steps.toasts.deleted')).toBe('Etapa excluída.');
    expect(t('steps.errors.notEmpty')).toBe(
      'Esta etapa recebeu perguntas. Mova ou arquive antes de excluir.',
    );
  });

  it('the step reorder arrows and announcement', () => {
    expect(t('steps.reorder.up', { title: 'Contato' })).toBe('Subir etapa “Contato”');
    expect(t('steps.reorder.down', { title: 'Contato' })).toBe('Descer etapa “Contato”');
    expect(t('steps.reorder.moved', { title: 'Contato', position: 2, total: 3 })).toBe(
      'A etapa “Contato” agora é a etapa 2 de 3.',
    );
  });

  it('the two refusals name the two QUESTIONS and keep the Phase 12 reorder strings', () => {
    expect(t('reorder.mustFollow', { title: 'Nome da clínica', other: 'Tem clínica?' })).toBe(
      '“Nome da clínica” precisa ficar depois de “Tem clínica?”, que decide se ela aparece.',
    );
    expect(t('reorder.mustPrecede', { title: 'Tem clínica?', other: 'Nome da clínica' })).toBe(
      '“Tem clínica?” precisa ficar antes de “Nome da clínica”, que só aparece conforme a resposta dela.',
    );
    expect(t('reorder.up', { title: 'Cargo' })).toBe('Subir “Cargo”');
    expect(t('reorder.moved', { title: 'Cargo', position: 2, total: 3 })).toBe(
      '“Cargo” agora é a pergunta 2 de 3.',
    );
  });
});
