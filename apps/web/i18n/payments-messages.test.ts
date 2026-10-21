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
  'toasts.released': ['email'],
  'toasts.blocked': ['email'],
  'toasts.unblocked': ['email'],
  'toasts.releaseRemoved': ['email'],
  'toasts.granted': ['email', 'product'],
};

/** The ICU plural keys and the variable each counts on. */
const PLURALS: Record<string, string> = {
  'gate.dialog.body': 'n',
  'gate.dialog.releaseLabel': 'n',
  'events.showing': 'count',
  'toasts.gateOnReleased': 'released',
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
      const values = { n: 0, count: 0, released: 0, tenant: 'X', [variable]: 1 };
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
