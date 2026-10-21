import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * 09.1-13 — the whole Pagamentos catalog (UI-D-531, PWA-03): `messages/pt-BR/payments.json`, one root
 * key `payments`, written complete for every surface of the phase so the later plans only consume
 * keys. This file pins what a copy edit must not break: the merge, every ICU plural, every
 * placeholder of the approved Copywriting Contract, and the vocabulary rules of UI-D-531.
 *
 * Real merged catalog, real next-intl formatter: a plural that stops parsing fails here, not in a
 * member's phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const payments = messages.payments as MessageTree;

/** Every leaf of the namespace as `dotted.path -> string`. */
function leaves(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const all = leaves(payments);

/** The names a message interpolates: `{name}` and `{name, plural, …}`, not the text inside a form. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1] as string).sort();
}

/** The approved Copywriting Contract's placeholders, key by key (no key may drop or rename one). */
const EXPECTED: Record<string, string[]> = {
  'setup.urlHelper': ['gateway'],
  'setup.tokenPlaceholder': ['gateway'],
  'setup.lastEvent': ['when'],
  'products.helper': ['tenant'],
  'products.idMeta': ['externalId'],
  'products.empty.body': ['gateway'],
  'products.sheet.idLabel': ['gateway'],
  'products.sheet.idHelper': ['gateway'],
  'products.removeDialog.title': ['name'],
  'gate.dialog.title': ['tenant'],
  'gate.dialog.body': ['n'],
  'gate.dialog.releaseLabel': ['n'],
  'gate.dialog.cutNote': ['cut'],
  'access.validUntil': ['date'],
  'access.sheet.updated': ['when'],
  'access.sheet.gatewayNote': ['gateway'],
  'access.blockDialog.title': ['email'],
  'access.blockDialog.body': ['tenant'],
  'access.removeDialog.title': ['email'],
  'access.removeDialog.body': ['tenant'],
  'events.showing': ['count'],
  'events.received': ['when'],
  'events.idMeta': ['externalId'],
  'events.empty.body': ['gateway', 'gateway'],
  'events.grantDialog.title': ['email', 'product'],
  'pending.bodyNoLink': ['tenant'],
  'errors.idTaken': ['gateway'],
  'errors.noMembership': ['tenant'],
  'toasts.gateOnReleased': ['released'],
  'toasts.gateOnCut': ['cut'],
  'toasts.gateOnReleasedCut': ['cut', 'released'],
  'toasts.released': ['email'],
  'toasts.releasedStaysCut': ['email'],
  'toasts.blocked': ['email'],
  'toasts.unblocked': ['email'],
  'toasts.releaseRemoved': ['email'],
  'toasts.granted': ['email', 'product'],
};

/** The ICU plural keys and the variable each counts on. */
const PLURALS: Record<string, string> = {
  'gate.dialog.body': 'n',
  'gate.dialog.releaseLabel': 'n',
  'gate.dialog.cutNote': 'cut',
  'events.showing': 'count',
  'toasts.gateOnReleased': 'released',
  'toasts.gateOnCut': 'cut',
  'toasts.gateOnReleasedCut': 'released',
};

describe('payments.json (UI-D-531)', () => {
  it('merges into the catalog under the single root key `payments`', () => {
    expect(Object.keys(payments).length).toBeGreaterThan(0);
    expect(Object.keys(messages)).toContain('payments');
    expect(payments.title).toBe('Pagamentos');
  });

  it('names every placeholder of the approved contract, in every key that has one', () => {
    for (const [key, names] of Object.entries(EXPECTED)) {
      expect(all[key], `missing key payments.${key}`).toBeTypeOf('string');
      expect(placeholders(all[key] as string), `placeholders of payments.${key}`).toEqual(
        [...names].sort(),
      );
    }
  });

  it('no other key interpolates a name the contract does not list', () => {
    for (const [key, text] of Object.entries(all)) {
      if (key in EXPECTED) continue;
      expect(placeholders(text), `payments.${key} must not interpolate`).toEqual([]);
    }
  });

  it('every plural key carries `one` and `other` and formats both counts', () => {
    const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'payments' as never });
    for (const [key, variable] of Object.entries(PLURALS)) {
      const text = all[key] as string;
      expect(text, `payments.${key} needs a one form`).toMatch(/plural,\s*one\s*\{/);
      expect(text, `payments.${key} needs an other form`).toMatch(/other\s*\{/);
      const values = { n: 0, count: 0, released: 0, cut: 0, tenant: 'X', [variable]: 1 };
      const one = (t as unknown as (k: string, v: object) => string)(key, values);
      const many = (t as unknown as (k: string, v: object) => string)(key, {
        ...values,
        [variable]: 3,
      });
      // The `one` form may spell the count out ("do membro atual"); the `other` form always counts.
      expect(many).toContain('3');
      expect(one).not.toBe(many);
    }
  });

  it('formats the gate dialog with the figures the screen passes', () => {
    const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'payments' as never });
    const fmt = t as unknown as (key: string, values: object) => string;
    expect(fmt('gate.dialog.body', { n: 1 })).toBe(
      '1 membro está sem acesso registrado. Quem ficar sem acesso passará a ver “Assinatura pendente”. A equipe não é afetada.',
    );
    expect(fmt('gate.dialog.releaseLabel', { n: 12 })).toBe(
      'Liberar o acesso dos 12 membros atuais',
    );
    expect(fmt('gate.dialog.releaseLabel', { n: 1 })).toBe('Liberar o acesso do membro atual');
    expect(fmt('toasts.gateOnReleased', { released: 2 })).toBe(
      'Assinatura exigida. Acesso liberado para 2 membros.',
    );
    expect(fmt('toasts.gateOnCut', { cut: 3 })).toBe(
      'Assinatura exigida. 3 membros com assinatura pendente continuam sem acesso.',
    );
    expect(fmt('toasts.gateOnReleasedCut', { released: 2, cut: 1 })).toBe(
      'Assinatura exigida. Acesso liberado para 2 membros. 1 membro com assinatura pendente continua sem acesso.',
    );
    expect(fmt('toasts.gateOnCut', { cut: 1 })).toBe(
      'Assinatura exigida. 1 membro com assinatura pendente continua sem acesso.',
    );
    expect(fmt('gate.dialog.cutNote', { cut: 1 })).toBe(
      '1 membro está com a assinatura pendente e continua sem acesso. Liberar manualmente não reabre esse acesso: ele volta sozinho quando o pagamento é confirmado.',
    );
    expect(fmt('gate.dialog.cutNote', { cut: 3 })).toBe(
      '3 membros estão com a assinatura pendente e continuam sem acesso. Liberar manualmente não reabre esse acesso: ele volta sozinho quando o pagamento é confirmado.',
    );
    expect(fmt('toasts.releasedStaysCut', { email: 'pessoa9@exemplo.com.br' })).toBe(
      'Liberação registrada para pessoa9@exemplo.com.br, mas a assinatura está pendente: a pessoa continua sem acesso até o pagamento ser confirmado.',
    );
  });

  it('keeps the member-facing keys free of the gateway vocabulary (UI-D-531)', () => {
    const memberFacing = Object.entries(all).filter(
      ([key]) => key.startsWith('pending.') || key.startsWith('states.'),
    );
    expect(memberFacing.length).toBeGreaterThan(0);
    for (const [key, text] of memberFacing) {
      expect(text, `payments.${key}`).not.toMatch(/webhook|gateway|token|membership/i);
    }
  });

  it('says "membership" to nobody, and names the provider only through {gateway}', () => {
    for (const [key, text] of Object.entries(all)) {
      expect(text, `payments.${key}`).not.toMatch(/membership/i);
      expect(text, `payments.${key}`).not.toMatch(/kiwify/i);
    }
  });

  it('pins the A-P10 delta: the block note says the block only counts while the gate is on', () => {
    expect(all['access.sheet.blockOffNote']).toBe(
      'O bloqueio só vale enquanto “Exigir assinatura para entrar” está ligado.',
    );
  });

  it('gives the neutral type `other` a word, a delta not drawn in sketch 013', () => {
    expect(all['events.types.other']).toBe('Outro evento');
  });

  it('writes the typographic quotes of the contract, not straight ones', () => {
    expect(all['errors.lastProduct']).toBe(
      'Desative “Exigir assinatura para entrar” antes de remover o último produto de acesso.',
    );
    expect(all['products.sheet.linkHelper']).toBe('Usado nos botões “Assinar” e “Regularizar”.');
    for (const [key, text] of Object.entries(all)) {
      expect(text, `payments.${key}`).not.toContain('"');
    }
  });
});

/**
 * 09.1-15 (UI-D-522, UI-D-531, UI-D-532) — the no-access notice and the cut screen's fallback word.
 * Only `signup.notAllowed` and `login.notAllowed` are reworded among existing keys; the rest are new.
 * The shipped sign-up labels (F-5) must not have moved.
 */
describe('09.1-15: the no-access notice catalog', () => {
  const NOTICE = 'Seu acesso ainda não foi liberado. Use o mesmo e-mail da compra.';
  const signup = leaves(messages.signup as MessageTree);
  const login = leaves(messages.login as MessageTree);
  const join = leaves(messages.join as MessageTree);

  it('rewords the two refusal lines to the one sentence of the contract', () => {
    expect(signup.notAllowed).toBe(NOTICE);
    expect(login.notAllowed).toBe(NOTICE);
  });

  it('adds the Assinar label, its new-tab suffix and the join retry link', () => {
    expect(signup.accessSubscribe).toBe('Assinar');
    expect(signup.accessNewTab).toBe('(abre a página de pagamento em uma nova aba)');
    expect(join['accessRequired.retry']).toBe('Verificar de novo');
  });

  it('gives the cut screen a fallback word for the tenant name', () => {
    expect(all['pending.tenantFallback']).toBe('sua comunidade');
  });

  it('keeps every shipped sign-up, login and join label where it was (F-5)', () => {
    expect(signup.name).toBe('Nome completo');
    expect(signup.email).toBe('Email');
    expect(signup.password).toBe('Senha');
    expect(signup.submit).toBe('Cadastrar');
    expect(signup['existing.submit']).toBe('Participar');
    expect(login.submit).toBe('Entrar');
    expect(join.decline).toBe('Não participar');
    expect(join.submit).toBe('Participar');
    expect(join.title).toBe('Participar de {tenant}');
  });

  it('keeps the member-facing notice keys free of the gateway vocabulary and of any community name', () => {
    const keys = [
      signup.notAllowed,
      login.notAllowed,
      signup.accessSubscribe,
      signup.accessNewTab,
      join['accessRequired.retry'],
    ];
    for (const text of keys) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/gateway|webhook|token|membership|kiwify/i);
      expect(text).not.toMatch(/\{/);
    }
  });
});
