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
