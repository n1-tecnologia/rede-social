import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12.1-17 (PFORM-29, PFORM-31, PFORM-37, PFORM-38, PFORM-42; UI-D-647..UI-D-651) — the builder's condition
 * strings, one by one against the approved Copywriting Contract ("Admin: the question sheet" and "Admin:
 * refusals, impact, preview"), through the real merged catalog and the real next-intl formatter, so a plural
 * that stops parsing fails here and not on a phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.admin',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.admin.editor: where and when it appears (UI-D-647, UI-D-648)', () => {
  it('the block title and the step field', () => {
    expect(t('editor.where.title')).toBe('Onde e quando aparece');
    expect(t('editor.step.label')).toBe('Etapa');
    expect(t('editor.step.helper')).toBe(
      'Os membros respondem as etapas em ordem. Ao mudar de etapa, a pergunta vai para o fim da nova etapa.',
    );
    expect(t('editor.step.errors.mustFollow', { opener: 'Tem clínica?' })).toBe(
      'Esta pergunta depende de “Tem clínica?”, então precisa ficar na etapa dela ou em uma depois.',
    );
  });

  it('the opener refusal of the step field reads as the UI-SPEC wrote it (sketch finding F-9)', () => {
    // UI-SPEC verbatim. `{dependent}` appears twice in the sentence: flagged to Igor in the 12.1-17 SUMMARY, not
    // reworded here.
    expect(t('editor.step.errors.mustPrecede', { dependent: 'Nome da clínica' })).toBe(
      '“Nome da clínica” depende desta pergunta, então ela precisa ficar na etapa de “Nome da clínica” ou em uma antes.',
    );
  });

  it('the switch and the opener field', () => {
    expect(t('editor.condition.label')).toBe('Mostrar só em alguns casos');
    expect(t('editor.condition.helper')).toBe('Sem condição, todos os membros veem esta pergunta.');
    expect(t('editor.condition.opener.label')).toBe('Pergunta que decide');
    expect(t('editor.condition.opener.placeholder')).toBe('Selecione');
    expect(t('editor.condition.opener.help')).toBe(
      'Só aparecem aqui perguntas de escolha ou de Sim ou não, sem condição, que vêm antes desta.',
    );
    expect(t('editor.condition.none')).toBe(
      'Para usar uma condição, crie antes uma pergunta de escolha ou de Sim ou não, sem condição, que venha antes desta.',
    );
  });

  it('the value picker, the required line and the polite reset note', () => {
    expect(t('editor.condition.values.legend')).toBe('Mostrar quando a resposta for');
    expect(t('editor.condition.values.help')).toBe(
      'Basta uma das opções marcadas para a pergunta aparecer.',
    );
    expect(t('editor.condition.values.otherNote')).toBe('A opção “Outro” não abre perguntas.');
    expect(t('editor.condition.requiredNote')).toBe(
      'Como esta pergunta é obrigatória, só quem a vê precisa responder.',
    );
    expect(t('editor.condition.reset')).toBe(
      'A pergunta que decide mudou, então as respostas escolhidas foram limpas.',
    );
  });

  it('the validation and the 409 line', () => {
    expect(t('editor.condition.errors.opener')).toBe('Escolha a pergunta que decide.');
    expect(t('editor.condition.errors.values')).toBe(
      'Escolha pelo menos uma resposta que abre esta pergunta.',
    );
    expect(t('editor.condition.errors.stale')).toBe(
      'Esta condição não vale mais. Escolha a pergunta e a resposta de novo.',
    );
  });
});

describe('profileForm.admin: the list markers (UI-D-650)', () => {
  it('the pills and the condition sentence', () => {
    expect(t('row.conditional')).toBe('Condicional');
    expect(t('row.opens', { count: 1 })).toBe('Abre 1 pergunta');
    expect(t('row.opens', { count: 3 })).toBe('Abre 3 perguntas');
    expect(t('row.condition', { opener: 'Tem clínica?', options: '“A” ou “B”' })).toBe(
      'Só aparece se “Tem clínica?” for “A” ou “B”.',
    );
  });

  it('the opener block of the sheet', () => {
    expect(t('editor.opens.title', { count: 1 })).toBe('Esta pergunta abre 1 pergunta:');
    expect(t('editor.opens.title', { count: 4 })).toBe('Esta pergunta abre 4 perguntas:');
    expect(t('editor.opens.hint')).toBe(
      'Elas só aparecem para quem responder como você definiu. Para arquivar ou mudar esta pergunta, ajuste essas antes.',
    );
    expect(t('editor.opens.listLabel')).toBe('Perguntas que dependem desta');
  });
});

describe('profileForm.admin: the refusals and the used option (UI-D-651)', () => {
  it('the four titles', () => {
    expect(t('dependents.title.archive')).toBe(
      'Esta pergunta abre outras e não pode ser arquivada agora.',
    );
    expect(t('dependents.title.delete')).toBe(
      'Esta pergunta abre outras e não pode ser excluída agora.',
    );
    expect(t('dependents.title.type')).toBe(
      'Esta pergunta abre outras e não pode mudar de tipo agora.',
    );
    expect(t('dependents.title.option', { label: 'Tenho' })).toBe(
      'A opção “Tenho” abre outras perguntas e não pode ser removida agora.',
    );
  });

  it('the hints and the overflow line', () => {
    expect(t('dependents.hint')).toBe(
      'Remova a condição destas perguntas, ou arquive-as, e tente de novo:',
    );
    expect(t('dependents.hintOption')).toBe(
      'Tire esta opção da condição destas perguntas, ou remova a condição delas, e tente de novo:',
    );
    expect(t('dependents.more', { count: 1 })).toBe('e mais 1 pergunta');
    expect(t('dependents.more', { count: 4 })).toBe('e mais 4 perguntas');
  });

  it('the option row', () => {
    // 12.2-18 (UI-D-673): the caption counts branches now; pinned in profile-form-12-2-admin-messages.test.ts.
    expect(t('editor.options.usedBy', { count: 1 })).toBe('Abre 1 ramo');
    expect(t('editor.options.usedBy', { count: 2 })).toBe('Abre 2 ramos');
    expect(t('editor.options.usedLocked')).toBe(
      'Opção usada em uma condição. Não pode ser removida.',
    );
    expect(t('editor.options.usedNote')).toBe(
      'As opções que abrem perguntas não podem ser removidas. Você pode renomear e mudar a ordem.',
    );
  });

  it('the reactivation toast', () => {
    expect(t('archived.openerArchived', { title: 'Nome da clínica', opener: 'Tem clínica?' })).toBe(
      'Para reativar “Nome da clínica”, reative antes “Tem clínica?”, que decide se ela aparece.',
    );
  });
});

describe('profileForm.admin: a question with answers and the impact reading (D-625, D-634, UI-D-649)', () => {
  it('the locked rows', () => {
    expect(t('editor.condition.locked.none', { n: 1 })).toBe(
      'Esta pergunta já tem 1 resposta, então a condição não pode ser criada nem mudada. Para mudar, crie uma nova pergunta e arquive esta.',
    );
    expect(t('editor.condition.locked.none', { n: 12 })).toBe(
      'Esta pergunta já tem 12 respostas, então a condição não pode ser criada nem mudada. Para mudar, crie uma nova pergunta e arquive esta.',
    );
    expect(t('editor.locked.replace')).toBe('Criar nova pergunta e arquivar esta');
    expect(t('editor.condition.locked.removable')).toBe(
      'Como a pergunta já tem respostas, a condição só pode ser removida.',
    );
  });

  it('the condition sentence, the removal and the undo', () => {
    expect(t('editor.condition.summary', { opener: 'Tem clínica?', options: '“A” ou “B”' })).toBe(
      'Só aparece se “Tem clínica?” for “A” ou “B”.',
    );
    expect(t('editor.condition.remove')).toBe('Remover condição');
    expect(t('editor.condition.removePending')).toBe(
      'A condição será removida quando você salvar.',
    );
    expect(t('editor.condition.undo')).toBe('Desfazer');
  });

  it('the "Remover a condição?" dialog', () => {
    expect(t('impact.unconditionalTitle')).toBe('Remover a condição?');
    expect(t('impact.unconditionalBody', { n: 1 })).toBe(
      '1 membro que hoje não vê esta pergunta vai precisar respondê-la antes de continuar usando a comunidade. Quem já respondeu mantém a resposta.',
    );
    expect(t('impact.unconditionalBody', { n: 7 })).toBe(
      '7 membros que hoje não veem esta pergunta vão precisar respondê-la antes de continuar usando a comunidade. Quem já respondeu mantém a resposta.',
    );
    expect(t('impact.unconditionalConfirm')).toBe('Remover e exigir');
    expect(t('impact.cancel')).toBe('Voltar');
    expect(t('impact.previewFailed')).toBe(
      'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
    );
  });

  it('the sentence every impact dialog of a required conditional question gains', () => {
    expect(t('impact.conditionalNote', { opener: 'Tem clínica?', options: '“A” ou “B”' })).toBe(
      'Só conta quem vê esta pergunta: quem respondeu “Tem clínica?” com “A” ou “B”.',
    );
  });
});
