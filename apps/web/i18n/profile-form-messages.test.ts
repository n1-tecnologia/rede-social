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

  it('keeps the vocabulary rules: no "form", "survey" or "questionário" on a screen', () => {
    const text = JSON.stringify((messages.profileForm as Record<string, unknown>).member);
    expect(text).not.toMatch(/\b(survey|questionário|deletar|template)\b/i);
  });
});
