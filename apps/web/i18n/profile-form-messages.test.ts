import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

/**
 * 12-12 — the member's completion screen catalog (UI-D-581..UI-D-588, PFORM-26): `profileForm.member.json`
 * declares exactly the `profileForm` root and pins what a copy edit must not break, string by string
 * against the approved Copywriting Contract ("Member: the completion screen"), through the real merged
 * catalog and the real next-intl formatter, so a plural that stops parsing fails here and not on a phone.
 */

const dir = join(process.cwd(), 'messages', 'pt-BR');
const messages = loadMessages(dir);
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.member',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.member.json', () => {
  it('declares exactly the profileForm root, with the member branch', () => {
    const parsed = JSON.parse(readFileSync(join(dir, 'profileForm.member.json'), 'utf8'));
    expect(Object.keys(parsed)).toEqual(['profileForm']);
    expect(Object.keys(parsed.profileForm)).toEqual(['member']);
  });

  it('merges into the catalog under profileForm.member', () => {
    expect(messages.profileForm).toBeTypeOf('object');
    expect((messages.profileForm as Record<string, unknown>).member).toBeTypeOf('object');
  });
});

describe('verbatim strings of the Copywriting Contract', () => {
  const plain: [string, string][] = [
    ['first.title', 'Complete seu perfil'],
    ['returning.title', 'Faltam algumas respostas'],
    ['edit.title', 'Minhas respostas'],
    ['edit.intro', 'Atualize suas respostas quando quiser.'],
    ['missing.jump', 'Ir para a primeira'],
    ['required', 'Obrigatória'],
    ['optional', 'Opcional'],
    ['flag', 'Falta responder'],
    ['public', 'Esta resposta aparece no seu perfil.'],
    ['controls.select', 'Selecione'],
    ['controls.other', 'Qual?'],
    ['controls.yes', 'Sim'],
    ['controls.no', 'Não'],
    ['controls.clear', 'Limpar resposta'],
    ['controls.phonePlaceholder', '(11) 91234-5678'],
    ['controls.emailPlaceholder', 'nome@exemplo.com.br'],
    ['controls.linkPlaceholder', 'https://'],
    ['errors.required', 'Responda esta pergunta.'],
    ['errors.acceptance', 'Marque a caixa para continuar.'],
    ['errors.choice', 'Escolha uma opção.'],
    ['errors.multiple', 'Escolha pelo menos uma opção.'],
    ['errors.otherRequired', 'Escreva qual é a outra resposta.'],
    ['errors.numberInvalid', 'Informe um número.'],
    ['errors.dateInvalid', 'Informe uma data válida.'],
    ['errors.phone', 'Informe um telefone com DDD, como (11) 91234-5678.'],
    ['errors.email', 'Informe um e-mail válido, como nome@exemplo.com.br.'],
    ['errors.link', 'Informe um link válido, como https://exemplo.com.br.'],
    ['summary.jump', 'Ir para o primeiro'],
    ['save', 'Salvar'],
    ['saving', 'Salvando…'],
    ['saved', 'Respostas salvas.'],
    ['offline', 'Você está sem conexão. Suas respostas continuam aqui; salve quando voltar.'],
    ['saveFailed', 'Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.'],
    [
      'changed',
      'O formulário mudou enquanto você respondia. Atualizamos a lista; confira e salve de novo.',
    ],
    ['cancel', 'Cancelar'],
    ['home', 'Ir para o início'],
    ['retry', 'Tentar de novo'],
    ['none.title', 'Não há perguntas para responder'],
    ['none.body', 'Você já está com tudo em dia.'],
    ['loadFailed.title', 'Algo deu errado'],
    ['loadFailed.body', 'Não foi possível carregar as perguntas agora.'],
    ['preview.banner', 'Prévia: nada do que você preencher aqui é salvo.'],
    ['preview.close', 'Fechar'],
  ];

  it('pins at least 30 strings, each rendered exactly as approved', () => {
    expect(plain.length).toBeGreaterThanOrEqual(30);
    for (const [key, text] of plain) expect(t(key), key).toBe(text);
  });

  it('interpolates the tenant into the first and returning intros', () => {
    expect(t('first.intro', { tenant: 'Ana Mentoria' })).toBe(
      'Ana Mentoria pede estas informações para você continuar. As perguntas marcadas como “Obrigatória” precisam de resposta.',
    );
    expect(t('returning.intro', { tenant: 'Ana Mentoria' })).toBe(
      'Ana Mentoria acrescentou perguntas novas. Responda as marcadas para continuar.',
    );
  });

  it('pluralises the missing notice, the error summary and the star names', () => {
    expect(t('missing.notice', { n: 1 })).toBe(
      'Falta 1 pergunta obrigatória. O que você já respondeu continua guardado.',
    );
    expect(t('missing.notice', { n: 3 })).toBe(
      'Faltam 3 perguntas obrigatórias. O que você já respondeu continua guardado.',
    );
    expect(t('summary.title', { n: 1 })).toBe('Revise 1 campo antes de salvar.');
    expect(t('summary.title', { n: 4 })).toBe('Revise 4 campos antes de salvar.');
    expect(t('controls.star', { n: 1 })).toBe('1 estrela');
    expect(t('controls.star', { n: 5 })).toBe('5 estrelas');
    expect(t('controls.ratingOf', { n: 3 })).toBe('3 de 5');
  });

  it('interpolates the limits in the helpers and the range errors', () => {
    expect(t('controls.between', { min: 1, max: 10 })).toBe('Entre 1 e 10.');
    expect(t('controls.from', { min: 1 })).toBe('A partir de 1.');
    expect(t('controls.until', { max: 10 })).toBe('Até 10.');
    expect(t('errors.tooLong', { max: 120 })).toBe('Use até 120 caracteres.');
    expect(t('errors.numberRange', { min: 1, max: 10 })).toBe('Informe um valor entre 1 e 10.');
    expect(t('errors.numberMin', { min: 1 })).toBe('Informe um valor a partir de 1.');
    expect(t('errors.numberMax', { max: 10 })).toBe('Informe um valor até 10.');
    expect(t('errors.dateRange', { min: '01/01/2026', max: '31/12/2026' })).toBe(
      'Informe uma data entre 01/01/2026 e 31/12/2026.',
    );
    expect(t('errors.dateMin', { min: '01/01/2026' })).toBe(
      'Informe uma data a partir de 01/01/2026.',
    );
    expect(t('errors.dateMax', { max: '31/12/2026' })).toBe('Informe uma data até 31/12/2026.');
  });

  it('uses the same helper lines for a date question and the number one (12-13)', () => {
    expect(t('controls.between', { min: '01/01/2026', max: '31/12/2026' })).toBe(
      'Entre 01/01/2026 e 31/12/2026.',
    );
    expect(t('controls.from', { min: '31/01/2026' })).toBe('A partir de 31/01/2026.');
    expect(t('controls.until', { max: '31/12/2026' })).toBe('Até 31/12/2026.');
    expect(t('controls.between', { min: '1.000', max: '2.000' })).toBe('Entre 1.000 e 2.000.');
  });

  it('keeps the vocabulary rules: no "form", "survey" or "questionário" on a screen', () => {
    const text = JSON.stringify((messages.profileForm as Record<string, unknown>).member);
    expect(text).not.toMatch(/\b(survey|questionário|deletar|template)\b/i);
  });
});

/**
 * 12-14 — the profile surfaces' catalog (UI-D-589..UI-D-593): `profileForm.profile.json` declares the
 * `profileForm` root with the `profile` branch and pins the approved Copywriting Contract lines of
 * "Member and staff profile surfaces", through the real merged catalog and the real formatter.
 */
const p = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.profile',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.profile.json (12-14)', () => {
  it('declares exactly the profileForm root, with the profile branch', () => {
    const parsed = JSON.parse(readFileSync(join(dir, 'profileForm.profile.json'), 'utf8'));
    expect(Object.keys(parsed)).toEqual(['profileForm']);
    expect(Object.keys(parsed.profileForm)).toEqual(['profile']);
  });

  it('merges into the catalog next to the member branch', () => {
    const root = messages.profileForm as Record<string, unknown>;
    expect(root.member).toBeTypeOf('object');
    expect(root.profile).toBeTypeOf('object');
  });

  it('pins the Minhas respostas, answer-value, public and staff strings verbatim', () => {
    const plain: [string, string][] = [
      ['answers.title', 'Minhas respostas'],
      ['answers.edit', 'Editar'],
      ['answers.editLabel', 'Editar minhas respostas'],
      ['answers.visible', 'Visível no seu perfil'],
      ['answers.none', 'Sem resposta'],
      ['answers.showLess', 'Mostrar menos'],
      ['answers.empty.title', 'Você ainda não respondeu'],
      ['answers.empty.action', 'Responder'],
      ['answers.error.title', 'Algo deu errado'],
      ['answers.error.body', 'Não foi possível carregar suas respostas agora.'],
      ['answers.error.retry', 'Tentar novamente'],
      ['values.yes', 'Sim'],
      ['values.no', 'Não'],
      ['values.accepted', 'Aceito'],
      ['newQuestions.title', 'Há perguntas novas no seu perfil'],
      ['newQuestions.answer', 'Responder'],
      ['newQuestions.dismiss', 'Agora não'],
      ['newQuestions.dismissFailed', 'Não foi possível dispensar o aviso agora. Tente de novo.'],
      ['public.error', 'Não foi possível carregar as respostas agora.'],
      ['public.retry', 'Tentar novamente'],
      ['staff.title', 'Respostas do formulário'],
      ['staff.public', 'Público no perfil'],
      ['staff.archivedTitle', 'Perguntas arquivadas'],
      ['staff.archived', 'Arquivada'],
      ['staff.empty', 'Esta pessoa ainda não respondeu o formulário.'],
    ];
    for (const [key, text] of plain) expect(p(key), key).toBe(text);
  });

  it('interpolates the tenant, the name, the count and the rating', () => {
    expect(p('answers.empty.body', { tenant: 'Ana Mentoria' })).toBe(
      'Responda as perguntas de Ana Mentoria para completar seu perfil.',
    );
    expect(p('answers.showAll', { count: 6 })).toBe('Ver todas (6)');
    expect(p('public.title', { name: 'Carla Menezes' })).toBe('Sobre Carla Menezes');
    expect(p('values.rating', { n: 4 })).toBe('4 de 5');
    expect(p('values.other', { text: 'Mentoria' })).toBe('Outro: Mentoria');
  });

  it('pluralises the new-questions notice', () => {
    expect(p('newQuestions.body', { tenant: 'Ana Mentoria', count: 1 })).toBe(
      'Ana Mentoria acrescentou 1 pergunta opcional.',
    );
    expect(p('newQuestions.body', { tenant: 'Ana Mentoria', count: 2 })).toBe(
      'Ana Mentoria acrescentou 2 perguntas opcionais.',
    );
  });

  it('keeps the vocabulary rules on the profile branch', () => {
    const text = JSON.stringify((messages.profileForm as Record<string, unknown>).profile);
    expect(text).not.toMatch(/\b(survey|questionário|deletar|template)\b/i);
  });
});

/**
 * 12-15 — the builder's catalog (UI-D-564..UI-D-568, UI-D-576, UI-D-578): `profileForm.admin.json`
 * declares the `profileForm` root with the `admin` and `types` branches and pins the approved
 * Copywriting Contract lines of "Admin: page, summary, list, reorder", "Admin: the 13 types" and
 * "Admin: confirmations, archived", through the real merged catalog and the real formatter.
 */
const a = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.admin',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;
const ty = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'profileForm.types',
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('profileForm.admin.json (12-15)', () => {
  it('declares exactly the profileForm root, with the admin and types branches', () => {
    const parsed = JSON.parse(readFileSync(join(dir, 'profileForm.admin.json'), 'utf8'));
    expect(Object.keys(parsed)).toEqual(['profileForm']);
    expect(Object.keys(parsed.profileForm)).toEqual(['admin', 'types']);
  });

  it('merges into the catalog next to the member and profile branches', () => {
    const root = messages.profileForm as Record<string, unknown>;
    expect(root.admin).toBeTypeOf('object');
    expect(root.types).toBeTypeOf('object');
    expect(root.member).toBeTypeOf('object');
    expect(root.profile).toBeTypeOf('object');
  });

  it('adds the Configurações row label', () => {
    const app = createTranslator({ locale: 'pt-BR', messages, namespace: 'app' }) as unknown as (
      key: string,
    ) => string;
    expect(app('settings.rows.profileForm')).toBe('Formulário de perfil');
  });

  it('pins the page, tabs, summary, list, reorder, state and archived strings verbatim', () => {
    const plain: [string, string][] = [
      ['title', 'Formulário de perfil'],
      ['back', 'Voltar'],
      ['tabs.label', 'Áreas do Formulário de perfil'],
      ['tabs.questions', 'Perguntas'],
      ['tabs.archived', 'Arquivadas'],
      ['summary.noRequired', 'Nenhuma pergunta obrigatória'],
      ['summary.noMembers', 'Ainda não há membros'],
      ['summary.definition', 'Completo é quem respondeu todas as perguntas obrigatórias.'],
      [
        'summary.noRequiredBody',
        'Ninguém precisa responder para continuar. As respostas são opcionais.',
      ],
      ['summary.noMembersBody', 'Quando alguém entrar, o andamento aparece aqui.'],
      ['actions.reorder', 'Reordenar'],
      ['actions.reorderDone', 'Concluir'],
      ['row.required', 'Obrigatória'],
      ['row.optional', 'Opcional'],
      ['row.onProfile', 'No perfil'],
      ['row.locked', 'Tipo bloqueado'],
      ['reorder.failed', 'Não foi possível salvar a nova ordem. A lista voltou como estava.'],
      ['empty.title', 'Seu formulário ainda está vazio'],
      [
        'empty.body',
        'Crie perguntas para conhecer melhor os membros. Se marcar alguma como obrigatória, todos precisam respondê-la para continuar usando a comunidade.',
      ],
      ['errors.title', 'Algo deu errado'],
      ['errors.body', 'Não foi possível carregar o formulário agora.'],
      ['errors.retry', 'Tentar novamente'],
      ['errors.moduleOff', 'O Formulário de perfil foi desativado para esta comunidade.'],
      [
        'archived.noteArchived',
        'Perguntas arquivadas não são mais feitas aos membros. As respostas continuam guardadas e entram na exportação.',
      ],
      [
        'archived.noteReactivate',
        'Ao reativar uma pergunta obrigatória, quem ainda não a respondeu volta a ser chamado para responder.',
      ],
      ['archived.wasRequired', 'Era obrigatória'],
      ['archived.wasOptional', 'Era opcional'],
      ['archived.reactivate', 'Reativar'],
      ['archived.confirmTitle', 'Reativar pergunta?'],
      [
        'archived.confirmBody',
        'Ela volta ao fim do formulário e as respostas guardadas voltam a valer.',
      ],
      ['archived.confirm', 'Reativar'],
      ['archived.done', 'Pergunta reativada.'],
      ['archived.failed', 'Não foi possível reativar agora. Tente de novo.'],
      ['archived.empty.title', 'Nenhuma pergunta arquivada'],
      [
        'archived.empty.body',
        'Quando você arquivar uma pergunta, ela aparece aqui com as respostas guardadas.',
      ],
      ['impact.addTitle', 'Adicionar pergunta obrigatória?'],
      ['impact.makeTitle', 'Tornar a pergunta obrigatória?'],
      ['impact.reactivateTitle', 'Reativar pergunta obrigatória?'],
      ['impact.replaceTitle', 'Substituir a pergunta?'],
      ['impact.addConfirm', 'Adicionar e exigir'],
      ['impact.makeConfirm', 'Tornar obrigatória'],
      ['impact.reactivateConfirm', 'Reativar e exigir'],
      ['impact.replaceConfirm', 'Substituir'],
      ['impact.cancel', 'Voltar'],
      ['impact.kept', 'As respostas guardadas continuam valendo.'],
      [
        'impact.previewFailed',
        'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
      ],
    ];
    for (const [key, text] of plain) expect(a(key), key).toBe(text);
  });

  it('interpolates the tenant, the title, the count, the position and the limit', () => {
    expect(a('intro', { tenant: 'Ana Mentoria' })).toBe(
      'Monte as perguntas que os membros de Ana Mentoria respondem. As alterações valem assim que você salva.',
    );
    expect(a('summary.percent', { percent: 38 })).toBe('38%');
    expect(a('list.title', { count: 3 })).toBe('Perguntas ativas (3)');
    expect(a('list.limit', { max: 30 })).toBe(
      'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
    );
    expect(a('row.edit', { title: 'Qual é o seu cargo?' })).toBe(
      'Editar pergunta: Qual é o seu cargo?',
    );
    expect(a('row.position', { position: 2, total: 5 })).toBe('Pergunta 2 de 5');
    expect(a('reorder.up', { title: 'Cargo' })).toBe('Subir “Cargo”');
    expect(a('reorder.down', { title: 'Cargo' })).toBe('Descer “Cargo”');
    expect(a('reorder.moved', { title: 'Cargo', position: 2, total: 5 })).toBe(
      '“Cargo” agora é a pergunta 2 de 5.',
    );
    expect(a('archived.reactivateLabel', { title: 'Cargo' })).toBe('Reativar pergunta: Cargo');
  });

  it('pluralises the summary title, the pending line, the answer count and the archived line', () => {
    expect(a('summary.title', { done: 1, total: 1 })).toBe('1 de 1 membro completo');
    expect(a('summary.title', { done: 3, total: 8 })).toBe('3 de 8 membros completos');
    expect(a('summary.pending', { pending: 1 })).toBe('1 membro ainda precisa responder.');
    expect(a('summary.pending', { pending: 5 })).toBe('5 membros ainda precisam responder.');
    expect(a('row.answers', { count: 0 })).toBe('Sem respostas');
    expect(a('row.answers', { count: 1 })).toBe('1 resposta');
    expect(a('row.answers', { count: 12 })).toBe('12 respostas');
    expect(a('archived.meta', { date: '20/10/2026', count: 0 })).toBe(
      'Arquivada em 20/10/2026 · Sem respostas guardadas',
    );
    expect(a('archived.meta', { date: '20/10/2026', count: 1 })).toBe(
      'Arquivada em 20/10/2026 · 1 resposta guardada',
    );
    expect(a('archived.meta', { date: '20/10/2026', count: 9 })).toBe(
      'Arquivada em 20/10/2026 · 9 respostas guardadas',
    );
    expect(a('impact.body', { n: 1 })).toBe(
      '1 membro vai precisar responder antes de continuar usando a comunidade. Quem já respondeu as outras perguntas responde só esta.',
    );
    expect(a('impact.body', { n: 12 })).toBe(
      '12 membros vão precisar responder antes de continuar usando a comunidade. Quem já respondeu as outras perguntas responde só esta.',
    );
  });

  it('names the 13 types as the Copywriting Contract does', () => {
    const names: [string, string][] = [
      ['shortText', 'Texto curto'],
      ['longText', 'Texto longo'],
      ['dropdown', 'Lista suspensa'],
      ['multiChoice', 'Múltipla escolha'],
      ['singleChoice', 'Escolha única'],
      ['yesNo', 'Sim ou não'],
      ['acceptance', 'Aceite'],
      ['number', 'Número'],
      ['rating', 'Avaliação'],
      ['date', 'Data'],
      ['phone', 'Telefone'],
      ['email', 'E-mail'],
      ['link', 'Link'],
    ];
    expect(names).toHaveLength(13);
    for (const [key, name] of names) expect(ty(`${key}.name`), key).toBe(name);
    expect(ty('rating.hint')).toBe('De 1 a 5 estrelas');
  });

  it('keeps the vocabulary rules: no "survey", "questionário", "deletar" or "template"', () => {
    const text = JSON.stringify(messages.profileForm);
    expect(text).not.toMatch(/\b(survey|questionário|deletar|template)\b/i);
  });
});

/**
 * 12-16 — the question editor's catalog (UI-D-569..UI-D-573): `profileForm.admin.editor` and
 * `profileForm.admin.actions.add`, pinned string by string against the approved Copywriting Contract
 * ("Admin: the editor sheet"). The `types` branch stays 12-15's; this plan declares no leaf twice.
 */
describe('profileForm.admin.editor (12-16)', () => {
  const e = createTranslator({
    locale: 'pt-BR',
    messages,
    namespace: 'profileForm.admin.editor',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it('adds the "Adicionar pergunta" action to the builder actions', () => {
    expect(a('actions.add')).toBe('Adicionar pergunta');
  });

  it('pins the sheet titles, the type picker, the fields and the switches verbatim', () => {
    const plain: [string, string][] = [
      ['createTitle', 'Nova pergunta'],
      ['editTitle', 'Editar pergunta'],
      ['replaceTitle', 'Substituir pergunta'],
      ['type.legend', 'Tipo de resposta'],
      ['type.change', 'Trocar tipo'],
      ['type.dropOptions', 'As opções serão removidas ao trocar para este tipo.'],
      ['fields.title', 'Pergunta'],
      ['fields.acceptanceTitle', 'Texto do aceite'],
      ['fields.titlePlaceholder', 'Ex.: Qual é o seu cargo?'],
      ['fields.acceptancePlaceholder', 'Ex.: Li e aceito o regulamento do grupo'],
      ['fields.help', 'Texto de apoio (opcional)'],
      ['fields.helpPlaceholder', 'Explique como responder, se precisar.'],
      ['required.label', 'Obrigatória'],
      ['required.helper', 'Quem ainda não respondeu precisa responder antes de usar a comunidade.'],
      ['public.label', 'Mostrar no perfil do membro'],
      [
        'public.helper',
        'Os outros membros veem esta resposta no perfil de quem respondeu. O membro é avisado no formulário.',
      ],
      ['save', 'Salvar pergunta'],
      ['saving', 'Salvando…'],
      ['discard.title', 'Descartar as alterações?'],
      ['discard.body', 'As mudanças desta pergunta ainda não foram salvas.'],
      ['discard.confirm', 'Descartar'],
      ['discard.cancel', 'Continuar editando'],
      ['toasts.added', 'Pergunta adicionada.'],
      ['errors.titleRequired', 'Escreva a pergunta.'],
      [
        'errors.saveFailed',
        'Não foi possível salvar a pergunta agora. Suas alterações continuam aqui. Tente de novo.',
      ],
      [
        'errors.conflict',
        'Esta pergunta foi alterada enquanto você editava. Feche e abra de novo para ver a versão atual.',
      ],
    ];
    for (const [key, text] of plain) expect(e(key), key).toBe(text);
  });

  it('interpolates the tenant, the type, the title and the length caps', () => {
    expect(e('lgpd', { tenant: 'Ana Mentoria' })).toBe(
      'Peça só o que precisa. Ana Mentoria responde pelos dados que coletar, conforme a LGPD.',
    );
    expect(e('type.current', { type: 'Escolha única' })).toBe('Tipo: Escolha única');
    expect(e('replaceBanner', { title: 'Cargo' })).toBe(
      '“Cargo” será arquivada quando você salvar esta. As respostas dela continuam guardadas.',
    );
    expect(e('errors.tooLong', { max: 120 })).toBe('Use até 120 caracteres.');
  });
});

describe('profileForm.admin.editor: options, limits, notes and the impact extras (12-16 Task 2)', () => {
  const e = createTranslator({
    locale: 'pt-BR',
    messages,
    namespace: 'profileForm.admin.editor',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it('pins the options, "Outro", limits and type notes verbatim', () => {
    const plain: [string, string][] = [
      ['options.legend', 'Opções'],
      ['options.placeholder', 'Nome da opção'],
      ['options.add', 'Adicionar opção'],
      ['options.err.min', 'Inclua pelo menos 2 opções.'],
      ['options.err.empty', 'Preencha ou remova as opções vazias.'],
      ['options.err.duplicate', 'Já existe uma opção com este nome.'],
      ['other.label', 'Incluir a opção “Outro”'],
      ['other.helper', 'O membro escreve a própria resposta.'],
      ['limits.minNumber', 'Valor mínimo (opcional)'],
      ['limits.maxNumber', 'Valor máximo (opcional)'],
      ['limits.minDate', 'Data mínima (opcional)'],
      ['limits.maxDate', 'Data máxima (opcional)'],
      ['limits.errNumber', 'O mínimo não pode ser maior que o máximo.'],
      ['limits.errDate', 'A data mínima não pode ser depois da máxima.'],
      ['notes.rating', 'O membro escolhe de 1 a 5 estrelas.'],
      ['notes.yesNo', 'O membro responde Sim ou Não.'],
      [
        'notes.acceptance',
        'O membro marca uma caixa. Se a pergunta for obrigatória, só conta como respondida quando a caixa está marcada.',
      ],
      ['notes.phone', 'O telefone é validado com DDD.'],
      ['notes.email', 'O endereço de e-mail é validado.'],
      ['notes.link', 'O link precisa começar com http:// ou https://.'],
      ['errors.numberInvalid', 'Informe um número.'],
    ];
    for (const [key, text] of plain) expect(e(key), key).toBe(text);
  });

  it('interpolates the option position and the option limit', () => {
    expect(e('options.label', { n: 1 })).toBe('Opção 1');
    expect(e('options.up', { n: 2 })).toBe('Subir opção 2');
    expect(e('options.down', { n: 2 })).toBe('Descer opção 2');
    expect(e('options.remove', { n: 3 })).toBe('Remover opção 3');
    expect(e('options.err.max', { max: 20 })).toBe('Máximo de 20 opções.');
  });

  it('pluralises the pending sentence of a reopening save and drops it at zero', () => {
    expect(a('impact.added', { n: 0 }).trim()).toBe('Pergunta adicionada.');
    expect(a('impact.added', { n: 1 })).toBe(
      'Pergunta adicionada. 1 membro vai precisar responder.',
    );
    expect(a('impact.added', { n: 9 })).toBe(
      'Pergunta adicionada. 9 membros vão precisar responder.',
    );
    expect(a('impact.pending', { n: 4 })).toBe('4 membros vão precisar responder.');
    expect(a('impact.replaceBody', { title: 'Cargo' })).toBe(
      '“Cargo” será arquivada, com as respostas guardadas, e a nova entra no formulário.',
    );
  });
});

describe('profileForm.admin: the locked states, archive and delete (12-16 Task 3)', () => {
  const e = createTranslator({
    locale: 'pt-BR',
    messages,
    namespace: 'profileForm.admin.editor',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it('pins the locked-state and visibility-ratchet sentences verbatim', () => {
    const plain: [string, string][] = [
      ['locked.replace', 'Criar nova pergunta e arquivar esta'],
      [
        'locked.options',
        'As opções que já têm respostas não podem ser removidas nem renomeadas. Você pode adicionar novas e mudar a ordem.',
      ],
      ['locked.option', 'Opção bloqueada: já tem respostas'],
      ['locked.other', 'Já existem respostas “Outro”. Não dá para desligar.'],
      ['locked.limits', 'Como já há respostas, só dá para ampliar o intervalo.'],
      [
        'locked.limitsRefused',
        'Esse intervalo deixaria respostas fora do limite. Só é possível ampliar.',
      ],
      [
        'public.frozen',
        'Esta pergunta já tem respostas privadas, então não pode passar a ser pública. Para mostrar no perfil, crie uma nova pergunta e arquive esta.',
      ],
      ['public.ratchet', 'Se você desligar, não poderá ligar de novo enquanto houver respostas.'],
      ['archive', 'Arquivar pergunta'],
      ['delete', 'Excluir pergunta'],
      ['toasts.updated', 'Pergunta atualizada.'],
      ['toasts.replaced', 'Pergunta substituída.'],
    ];
    for (const [key, text] of plain) expect(e(key), key).toBe(text);
  });

  it('pluralises the locked type explanation and the option answer caption', () => {
    expect(e('locked.type', { n: 1 })).toBe(
      'Esta pergunta já tem 1 resposta, então o tipo não pode mudar. Para usar outro tipo, crie uma nova pergunta e arquive esta.',
    );
    expect(e('locked.type', { n: 12 })).toBe(
      'Esta pergunta já tem 12 respostas, então o tipo não pode mudar. Para usar outro tipo, crie uma nova pergunta e arquive esta.',
    );
    expect(e('locked.optionAnswers', { n: 1 })).toBe('1 resposta');
    expect(e('locked.optionAnswers', { n: 8 })).toBe('8 respostas');
  });

  it('pins the archive and delete dialogs verbatim, with the plural kept-answers sentence', () => {
    const plain: [string, string][] = [
      ['archive.title', 'Arquivar esta pergunta?'],
      ['archive.requiredNote', 'Quem ainda não respondeu deixa de precisar.'],
      ['archive.confirm', 'Arquivar'],
      ['archive.cancel', 'Cancelar'],
      ['archive.done', 'Pergunta arquivada.'],
      ['delete.title', 'Excluir esta pergunta?'],
      ['delete.body', 'Ninguém respondeu esta pergunta ainda. A exclusão não pode ser desfeita.'],
      ['delete.confirm', 'Excluir'],
      ['delete.cancel', 'Cancelar'],
      ['delete.done', 'Pergunta excluída.'],
      ['delete.hasAnswers', 'Esta pergunta recebeu respostas. Arquive em vez de excluir.'],
    ];
    for (const [key, text] of plain) expect(a(key), key).toBe(text);
    expect(a('archive.body', { n: 1 })).toBe(
      'Ela deixa de ser feita aos membros. A 1 resposta continua guardada e entra na exportação. Você pode reativar depois.',
    );
    expect(a('archive.body', { n: 12 })).toBe(
      'Ela deixa de ser feita aos membros. As 12 respostas continuam guardadas e entram na exportação. Você pode reativar depois.',
    );
  });

  it('keeps the vocabulary rules in the editor too', () => {
    const text = JSON.stringify((messages.profileForm as Record<string, unknown>).admin);
    expect(text).not.toMatch(/\b(survey|questionário|deletar|template)\b/i);
  });
});
