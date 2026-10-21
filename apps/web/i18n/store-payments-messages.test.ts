import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * 09.1-17 (UI-D-531) — the words the store side of the payment gateway adds, pinned against the REAL
 * merged catalog. A copy edit must not move them silently: the strings are the approved Copywriting
 * Contract rows "Product page, gateway", "Product form", "Notification" and "Manager pill". The
 * member-facing ones never say "gateway", "webhook" or a vendor's name. Kept in its own file so the
 * Pagamentos plans never edit one test file together.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR')) as MessageTree;

function at(path: string): unknown {
  let node: unknown = messages;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as MessageTree)[part];
  }
  return node;
}

describe('09.1-17 — product page, gateway mode (UI-D-525, UI-D-531)', () => {
  const ROWS: [string, string][] = [
    ['store.purchase.gateway.buy', 'Comprar'],
    ['store.purchase.gateway.newTab', '(abre a página de pagamento em uma nova aba)'],
    [
      'store.purchase.gateway.helper',
      'O valor final e a forma de pagamento aparecem na página de pagamento. Quando o pagamento for confirmado, o produto é liberado aqui.',
    ],
    ['store.purchase.gateway.unavailable', 'Indisponível'],
    ['store.purchase.gateway.unavailableNote', 'Este produto não está à venda no momento.'],
  ];

  it.each(ROWS)('%s reads exactly as the Copywriting Contract', (path, text) => {
    expect(at(path)).toBe(text);
  });

  it('keeps the shipped simulated purchase words unchanged', () => {
    expect(at('store.product.buy')).toBe('Comprar');
    expect(at('store.product.get')).toBe('Obter');
    expect(at('store.product.owned.title')).toBe('Comprado');
    expect(at('store.product.owned.body')).toBe('Você tem acesso a este produto.');
  });

  it('never names the machinery to a member', () => {
    for (const [path] of ROWS) {
      expect(String(at(path))).not.toMatch(/gateway|webhook|kiwify/i);
    }
  });
});

describe('09.1-17 — product form, Pagamento block (UI-D-524, UI-D-531)', () => {
  const ROWS: [string, string][] = [
    ['store.form.payment.label', 'Pagamento'],
    ['store.form.payment.idLabel', 'ID do produto no {gateway}'],
    [
      'store.form.payment.idHelper',
      'Copie o ID no painel do {gateway}. É por ele que reconhecemos a compra.',
    ],
    ['store.form.payment.linkLabel', 'Link de compra'],
    ['store.form.payment.linkHint', 'https://'],
    ['store.form.payment.linkHelper', 'O botão Comprar abre este link.'],
    [
      'store.form.payment.warningNoLink',
      'Sem link de pagamento. Os membros não conseguem comprar este produto.',
    ],
    [
      'store.form.payment.notConnected',
      'Conecte a integração em Pagamentos para receber as compras.',
    ],
    ['store.form.payment.openPayments', 'Abrir Pagamentos'],
    ['store.form.payment.errors.idRequired', 'Informe o ID do produto para usar o link de compra.'],
    ['store.form.payment.errors.idTaken', 'Este ID já está em uso. Confira o ID no {gateway}.'],
    ['store.form.payment.errors.linkInvalid', 'Informe um link que comece com https://.'],
  ];

  it.each(ROWS)('%s reads exactly as the Copywriting Contract', (path, text) => {
    expect(at(path)).toBe(text);
  });

  it('keeps the shipped save error line the form falls back to', () => {
    expect(at('store.form.errors.save')).toBe(
      'Não foi possível salvar. Revise os campos e tente novamente.',
    );
  });
});
