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

describe('profileForm.admin.editor.branch: the "Ramo" field of the question sheet (UI-D-669)', () => {
  it('declares the keys the Copywriting Contract names under editor.branch', () => {
    const branch = parsed.profileForm.admin.editor.branch;
    for (const key of ['label', 'none', 'helper', 'privateHidden', 'locked', 'requiredNote']) {
      expect(branch).toHaveProperty(key);
    }
  });

  it('reads the label, the empty choice and the helpers verbatim', () => {
    expect(t('editor.branch.label')).toBe('Ramo');
    expect(t('editor.branch.none')).toBe('Nenhum: todos os membros veem');
    expect(t('editor.branch.helper', { max: 3 })).toBe(
      'Aparecem aqui os ramos cuja pergunta que decide vem antes desta e que não passam de 3 níveis. Ao mudar de ramo, a pergunta continua na mesma etapa e vai para o fim do ramo.',
    );
    expect(t('editor.branch.privateHidden')).toBe(
      'Ramos que dependem de perguntas que não aparecem no perfil ficam de fora porque esta pergunta aparece.',
    );
    expect(t('editor.branch.requiredNote')).toBe(
      'Como esta pergunta é obrigatória, só quem a vê precisa responder.',
    );
  });

  it('the lock sentence is an ICU plural on the answers', () => {
    expect(t('editor.branch.locked', { n: 1 })).toBe(
      'Esta pergunta já tem 1 resposta, então não pode entrar nem sair de um ramo. Para mudar, crie uma nova pergunta e arquive esta.',
    );
    expect(t('editor.branch.locked', { n: 12 })).toBe(
      'Esta pergunta já tem 12 respostas, então não pode entrar nem sair de um ramo. Para mudar, crie uma nova pergunta e arquive esta.',
    );
  });
});

describe('profileForm.admin.editor.branches: "Ramos desta pergunta" and "Criar ramo" (UI-D-670)', () => {
  it('declares the keys the Copywriting Contract names under editor.branches', () => {
    const branches = parsed.profileForm.admin.editor.branches;
    for (const key of ['title', 'hint', 'create', 'none', 'saveFirst', 'depth']) {
      expect(branches).toHaveProperty(key);
    }
  });

  it('reads every sentence verbatim, the depth number coming from the limit', () => {
    expect(t('editor.branches.title')).toBe('Ramos desta pergunta');
    expect(t('editor.branches.hint')).toBe(
      'Um ramo abre um grupo de perguntas só para quem responder como você definir.',
    );
    expect(t('editor.branches.create')).toBe('Criar ramo');
    expect(t('editor.branches.none')).toBe('Esta pergunta ainda não abre nenhum ramo.');
    expect(t('editor.branches.saveFirst')).toBe(
      'Salve a pergunta para poder criar ramos a partir dela.',
    );
    expect(t('editor.branches.depth', { max: 3 })).toBe(
      'Esta pergunta já está dentro de 3 níveis de ramo, o máximo. Ela não pode abrir outro ramo.',
    );
  });

  it('the branch limit line takes its number from the limits', () => {
    expect(t('branches.limit', { max: 15 })).toBe(
      'Você chegou ao limite de 15 ramos. Desfaça ou arquive um ramo para criar outro.',
    );
  });
});

describe('profileForm.admin.branches.sheet: the branch sheet, create mode (UI-D-671)', () => {
  it('declares the create keys under branches.sheet and the toast under branches.toasts', () => {
    const sheet = parsed.profileForm.admin.branches.sheet;
    for (const key of [
      'createTitle',
      'opener',
      'legend',
      'help',
      'otherNote',
      'save',
      'saving',
      'discardBody',
      'failed',
    ]) {
      expect(sheet).toHaveProperty(key);
    }
    for (const key of ['label', 'placeholder', 'counter', 'help', 'tooLong']) {
      expect(sheet.name).toHaveProperty(key);
    }
    expect(sheet.errors).toHaveProperty('values');
    expect(parsed.profileForm.admin.branches.toasts).toHaveProperty('created');
  });

  it('reads the titles, the picker, the name and the footer verbatim', () => {
    expect(t('branches.sheet.createTitle')).toBe('Novo ramo');
    expect(t('branches.sheet.opener')).toBe('Pergunta que decide');
    expect(t('branches.sheet.legend')).toBe('Mostrar quando a resposta for');
    expect(t('branches.sheet.help')).toBe('Basta uma das opções marcadas para o ramo abrir.');
    expect(t('branches.sheet.otherNote')).toBe('A opção “Outro” não abre ramos.');
    expect(t('branches.sheet.name.label')).toBe('Nome do ramo (opcional)');
    expect(t('branches.sheet.name.placeholder')).toBe('Ex.: Quem tem clínica');
    expect(t('branches.sheet.name.counter', { n: 17, max: 60 })).toBe('17/60');
    expect(t('branches.sheet.name.help')).toBe(
      'O nome só aparece para você, no construtor e no Fluxo. Os membros não o veem.',
    );
    expect(t('branches.sheet.name.tooLong', { max: 60 })).toBe('Use até 60 caracteres.');
    expect(t('branches.sheet.save')).toBe('Salvar ramo');
    expect(t('branches.sheet.saving')).toBe('Salvando…');
  });

  it('reads the validation, the discard body, the failure and the toast verbatim', () => {
    expect(t('branches.sheet.errors.values')).toBe(
      'Escolha pelo menos uma resposta que abre este ramo.',
    );
    expect(t('branches.sheet.discardBody')).toBe('As mudanças deste ramo ainda não foram salvas.');
    expect(t('branches.sheet.failed')).toBe('Não foi possível salvar o ramo agora. Tente de novo.');
    expect(t('branches.toasts.created')).toBe('Ramo criado.');
  });
});

describe('the vocabulary of the new strings (Copywriting Contract: ramo, never "branch", "fork" or "grupo condicional")', () => {
  const groups: Record<string, unknown> = {
    'editor.branch': parsed.profileForm.admin.editor.branch,
    'editor.branches': parsed.profileForm.admin.editor.branches,
    'branches.sheet': parsed.profileForm.admin.branches.sheet,
    'branches.toasts': parsed.profileForm.admin.branches.toasts,
  };

  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
  }

  it('says ramo and uses curly quotes, in every string of the new groups', () => {
    for (const [name, group] of Object.entries(groups)) {
      for (const text of strings(group)) {
        expect(text, `${name}: ${text}`).not.toMatch(
          /\b(branch|fork|bifurca\w*|grupo condicional|diagrama|nó)\b/i,
        );
        expect(text, `${name}: ${text}`).not.toMatch(/[«»"]/);
      }
    }
  });

  it('puts every number in the strings through an interpolation, never typed', () => {
    for (const [name, group] of Object.entries(groups)) {
      for (const text of strings(group)) {
        expect(text.replace(/\{[^}]*\}/g, ''), `${name}: ${text}`).not.toMatch(/\d/);
      }
    }
  });
});
