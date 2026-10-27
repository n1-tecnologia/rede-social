import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * 09.4-14 Task 3 (CTK-08, CTK-29, CTK-40; UI-SPEC "Copywriting Contract") - every string of the
 * customer-token UI in the real merged pt-BR catalog, verbatim from the approved contract, plus the
 * ICU plural and the placeholders. Real catalog, real next-intl formatter: a plural that stops
 * parsing fails here, not on the operator's screen.
 *
 * Two groups with two different lives:
 *
 *  - "catalog shape": GREEN. Every key exists as a non-empty string with the contract's sentence,
 *    the vocabulary rules hold, and the one existing key whose value changed
 *    (`new.errors.projectNotFound`) is the only one.
 *  - The placeholder guard (the last test of the file): RED, on purpose, until hosted proof P1 is run
 *    by Igor and plan 09.4-17 writes the permission list into step 3 of the how-to. It is a plain
 *    `it`, not skipped, not `todo`, not weakened (T-09.4-51): while the marker is in the catalog it
 *    must fail, so the placeholder cannot ship by accident.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function lookup(dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((node, key) => (node as MessageTree | undefined)?.[key], messages);
}

/** Every leaf of a namespace as `dotted.path -> string`. */
function leaves(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const CONTRACT: ReadonlyArray<readonly [string, string]> = [
  // platform.database - overview, notice, reasons
  ['platform.database.overview.owner', 'Dono'],
  ['platform.database.overview.ownerPlatform', 'Plataforma'],
  ['platform.database.overview.ownerCustomer', 'Cliente'],
  ['platform.database.overview.organization', 'Organização'],
  [
    'platform.database.notices.planNotPro',
    'O plano deste projeto não é Pro. O projeto do cliente deve estar no plano Pro.',
  ],
  [
    'platform.database.reasons.tokenInvalid',
    'O Supabase não aceitou o token de acesso. Substitua o token e tente de novo.',
  ],
  [
    'platform.database.reasons.tokenForbidden',
    'O token de acesso não tem permissão para esta etapa. Substitua por um token com as permissões certas.',
  ],
  [
    'platform.database.reasons.orgMismatch',
    'O projeto está em outra organização do Supabase. Nada foi alterado.',
  ],
  // platform.database.token - card
  ['platform.database.token.title', 'Token de acesso'],
  [
    'platform.database.token.body',
    'O sistema usa este token para falar com o projeto no Supabase. Ele vale só para este projeto, fica guardado com segurança e não é mostrado de novo.',
  ],
  ['platform.database.token.save', 'Salvar token'],
  ['platform.database.token.saving', 'Salvando…'],
  ['platform.database.token.replace', 'Substituir token'],
  ['platform.database.token.saved', 'Token atualizado.'],
  ['platform.database.token.sheetTitle', 'Substituir token'],
  [
    'platform.database.token.intro',
    'Use quando o token venceu, foi revogado ou está perto de vencer. O token antigo deixa de ser usado.',
  ],
  ['platform.database.token.expiresOn', 'Vence em {date}.'],
  [
    'platform.database.token.expiresIn',
    'Vence em {days, plural, one {# dia} other {# dias}}, em {date}.',
  ],
  ['platform.database.token.expiredOn', 'Venceu em {date}.'],
  ['platform.database.token.noExpiry', 'Sem data de vencimento informada.'],
  ['platform.database.token.verifiedAt', 'Verificado {when}.'],
  ['platform.database.token.neverChecked', 'Ainda não verificado.'],
  ['platform.database.token.checking', 'Verificando…'],
  [
    'platform.database.token.notices.expiring',
    'O token vence em breve. Crie outro no Supabase e use Substituir token antes da data. Sem ele, o sistema deixa de conferir o projeto e de atualizar os endereços de login. A comunidade continua no ar.',
  ],
  [
    'platform.database.token.notices.expired',
    'O token venceu. A comunidade continua no ar, mas o sistema não consegue conferir nem atualizar o projeto. Crie outro token e substitua.',
  ],
  [
    'platform.database.token.notices.invalid',
    'O Supabase não aceita mais este token. Ele foi apagado ou revogado, ou quem o criou perdeu o acesso à conta do cliente. Crie outro e substitua. A comunidade continua no ar.',
  ],
  [
    'platform.database.token.notices.noPermission',
    'Este token não tem as permissões que o sistema precisa. Crie outro seguindo os passos abaixo e substitua.',
  ],
  [
    'platform.database.token.notices.orgMismatch',
    'O projeto agora está em outra organização do Supabase, diferente da registrada. Por segurança, o sistema parou de usá-lo. Confira se o projeto foi transferido.',
  ],
  [
    'platform.database.token.errors.orgChanged',
    'O projeto está em outra organização do Supabase, diferente da registrada. Nada foi alterado.',
  ],
  [
    'platform.database.token.errors.notSaved',
    'Não foi possível salvar o token agora. Nada foi alterado. Tente de novo.',
  ],
  // platform.wizard - Dados and Resumo
  ['platform.wizard.project.owner.label', 'Onde fica o projeto?'],
  ['platform.wizard.project.owner.platform', 'Projeto da plataforma'],
  ['platform.wizard.project.owner.customer', 'Projeto do cliente'],
  [
    'platform.wizard.project.bodyCustomer',
    'O projeto fica na conta do Supabase do cliente: vazio e no plano Pro. Cole o código dele e o token de acesso criado só para ele.',
  ],
  ['platform.wizard.summary.fields.owner', 'Dono do projeto'],
  ['platform.wizard.summary.fields.ownerValues.platform', 'Plataforma'],
  ['platform.wizard.summary.fields.ownerValues.customer', 'Cliente'],
  ['platform.wizard.summary.fields.projectToken', 'Token informado, guardado com segurança'],
  ['platform.wizard.summary.fields.projectTokenExpires', 'Vence em {date}'],
  // platform - new tenant errors
  ['platform.new.errors.tokenRequired', 'Cole o token de acesso do projeto.'],
  [
    'platform.new.errors.tokenInvalid',
    'O Supabase não aceitou este token. Ele pode estar errado, vencido ou apagado. Crie outro e cole de novo.',
  ],
  [
    'platform.new.errors.tokenForbidden',
    'Este token não tem as permissões necessárias para este projeto. Confira se ele é deste projeto e se tem as permissões do passo a passo.',
  ],
  [
    'platform.new.errors.tokenOtherProject',
    'Este token é de outro projeto. Crie um token só para este projeto.',
  ],
  [
    'platform.new.errors.tokenAccountWide',
    'Este token vale para a conta inteira. Crie um token limitado a este projeto.',
  ],
  ['platform.new.errors.tokenExpiryInvalid', 'Informe uma data futura, em até 1 ano.'],
  [
    'platform.new.errors.projectNotFoundCustomer',
    'Não encontramos este projeto. Confira o código e se o token foi criado para ele.',
  ],
  [
    'platform.new.errors.projectNotPro',
    'Este projeto não está no plano Pro. Passe-o para o Pro no Supabase e tente de novo.',
  ],
  [
    'platform.new.errors.projectNotFound',
    'Não encontramos este projeto. Confira o código e se ele está na organização da plataforma. Se ele é do cliente, escolha “Projeto do cliente”.',
  ],
  // already shipped by the first two tasks of the plan, pinned with the rest
  ['platform.tenant.tokenPill', 'Token: {state}'],
  ['platform.database.token.states.valid', 'Válido'],
  ['platform.database.token.states.expiring', 'Vencendo'],
  ['platform.database.token.states.expired', 'Vencido'],
  ['platform.database.token.states.invalid', 'Inválido'],
  ['platform.database.token.states.noPermission', 'Sem permissão'],
  ['platform.database.token.states.orgMismatch', 'Organização diferente'],
  ['platform.database.token.states.unchecked', 'Não verificado'],
  ['platform.wizard.project.token.label', 'Token de acesso do projeto'],
  [
    'platform.wizard.project.token.helper',
    'Fica guardado com segurança e não pode ser lido depois.',
  ],
  ['platform.wizard.project.expiry.label', 'Vence em (opcional)'],
  [
    'platform.wizard.project.expiry.helper',
    'A data escolhida ao criar o token. Com ela, o painel avisa antes de vencer.',
  ],
  ['platform.database.token.howto.title', 'Como criar o token'],
  ['platform.database.token.howto.link', 'Abrir os tokens no Supabase'],
  ['platform.database.token.howto.newTab', ' (abre em uma nova aba)'],
];

/** The shapes the plan names that carry no sentence of their own to compare (step 3 holds the marker). */
const HOWTO_STEPS = ['step1', 'step2', 'step3', 'step4', 'note'] as const;

describe('token messages - catalog shape', () => {
  it.each(CONTRACT)('%s reads the UI-SPEC sentence', (key, expected) => {
    expect(lookup(key)).toBe(expected);
  });

  it('has every how-to step and the note as a non-empty string', () => {
    for (const key of HOWTO_STEPS) {
      const value = lookup(`platform.database.token.howto.${key}`);
      expect(typeof value, key).toBe('string');
      expect((value as string).length, key).toBeGreaterThan(0);
    }
  });

  it('formats the expiry plural for 1 day and for 12 days, with the date', () => {
    const t = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'platform.database.token' as never,
    });
    expect(t('expiresIn' as never, { days: 1, date: '8 de novembro de 2026' } as never)).toBe(
      'Vence em 1 dia, em 8 de novembro de 2026.',
    );
    expect(t('expiresIn' as never, { days: 12, date: '8 de novembro de 2026' } as never)).toBe(
      'Vence em 12 dias, em 8 de novembro de 2026.',
    );
    expect(t('expiresOn' as never, { date: '8 de novembro de 2026' } as never)).toBe(
      'Vence em 8 de novembro de 2026.',
    );
    expect(t('expiredOn' as never, { date: '1 de outubro de 2026' } as never)).toBe(
      'Venceu em 1 de outubro de 2026.',
    );
  });

  it('interpolates the verification time, the pill prefix and the summary date', () => {
    const database = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'platform.database.token' as never,
    });
    expect(database('verifiedAt' as never, { when: 'há 3 min' } as never)).toBe(
      'Verificado há 3 min.',
    );
    const tenant = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'platform.tenant' as never,
    });
    expect(tenant('tokenPill' as never, { state: 'Vencendo' } as never)).toBe('Token: Vencendo');
    const summary = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'platform.wizard.summary.fields' as never,
    });
    expect(
      summary('projectTokenExpires' as never, { date: '8 de novembro de 2026' } as never),
    ).toBe('Vence em 8 de novembro de 2026');
  });

  it('never uses env, variável, PAT, Management API or JWT on a token screen (UI-D-559)', () => {
    const all = {
      ...leaves(lookup('platform.database.token') as MessageTree, 'token'),
      ...leaves(lookup('platform.wizard.project') as MessageTree, 'project'),
      ...leaves(lookup('platform.wizard.summary.fields') as MessageTree, 'fields'),
    };
    const banned = [/\benv\b/i, /vari[aá]vel/i, /\bPAT\b/, /Management API/i, /\bJWT\b/i];
    for (const [key, text] of Object.entries(all)) {
      for (const pattern of banned) expect(text, `${key} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('keeps "organização da plataforma" on the platform wording and out of the customer wording', () => {
    expect(lookup('platform.new.errors.projectNotFound')).toMatch(/organização da plataforma/);
    expect(lookup('platform.new.errors.projectNotFound')).toMatch(
      /escolha “Projeto do cliente”\.$/,
    );
    expect(lookup('platform.wizard.project.body')).toMatch(/organização da plataforma/);
    for (const key of [
      'platform.new.errors.projectNotFoundCustomer',
      'platform.wizard.project.bodyCustomer',
      'platform.new.errors.projectNotPro',
    ]) {
      expect(lookup(key), key).not.toMatch(/organização da plataforma/);
    }
  });

  it('leaves the shipped platform helper of the project group untouched', () => {
    expect(lookup('platform.wizard.project.body')).toBe(
      'Crie um projeto vazio na organização da plataforma no Supabase e cole aqui só o código dele.',
    );
  });
});

// The placeholder guard of plan 09.4-14 (A-UI-8, T-09.4-51). RED until hosted proof P1 is run by Igor
// and plan 09.4-17 replaces the marker in step 3 with the permission list. Do not skip, weaken or
// delete this test.
describe('token messages - the how-to has no placeholder', () => {
  it('permission list written', () => {
    const step3 = lookup('platform.database.token.howto.step3');
    expect(typeof step3).toBe('string');
    expect(step3 as string).not.toContain('[PENDENTE-PERMISSÕES]');
  });
});
