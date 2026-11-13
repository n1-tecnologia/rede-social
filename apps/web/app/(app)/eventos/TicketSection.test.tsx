// @vitest-environment happy-dom

import { join } from 'node:path';
import { PAYMENTS_MAX_LINK, PAYMENTS_MAX_PRODUCT_ID } from '@rede-social/module-payments/contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TicketFieldErrors, ticketSectionState } from '@/lib/event-ticket';

/**
 * Phase 10.1-11 (UI-D-741, UI-D-742, UI-D-743, sketch 021 `form-ingresso-*`) — the Ingresso section of
 * the event form against the REAL `events.json` catalog and the real ICU formatter, so a copy drift or a
 * broken plural fails here. The section is presentational: every case hands it a state the way the form
 * does, from `ticketSectionState`, and reads the DOM.
 *
 * One case per precedence branch of UI-D-742, named by its letter: (a) locked, (b) module off,
 * (c) not connected, (d) linked but off, (e) recurring, (f) free. The web workspace has no jest-dom:
 * plain DOM assertions only.
 */

vi.mock('next-intl', async (original) => {
  const actual = await original<typeof import('next-intl')>();
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { TicketSection } = await import('./TicketSection');

afterEach(cleanup);

const GATEWAY = 'Gateway Exemplo';

type Overrides = Partial<Parameters<typeof TicketSection>[0]>;
type StateInput = Parameters<typeof ticketSectionState>[0];

const FREE: StateInput = {
  linked: false,
  moduleOn: true,
  gatewayConnected: true,
  canManagePayments: true,
  soldCount: 0,
};

function section(state: Partial<StateInput> = {}, props: Overrides = {}) {
  const onToggle = vi.fn();
  const onProductId = vi.fn();
  const onLink = vi.fn();
  const onPriceText = vi.fn();
  const view = render(
    <TicketSection
      state={ticketSectionState({ ...FREE, ...state })}
      gateway={GATEWAY}
      on={false}
      onToggle={onToggle}
      productId=""
      onProductId={onProductId}
      link=""
      onLink={onLink}
      priceText=""
      onPriceText={onPriceText}
      errors={{}}
      existingNote={false}
      offNote={false}
      busy={false}
      {...props}
    />,
  );
  return { view, onToggle, onProductId, onLink, onPriceText };
}

const el = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const text = () => document.querySelector('[data-event-ticket]')?.textContent ?? '';
const q = (selector: string) => document.querySelector(selector);
const switchButton = () => document.querySelector('[role="switch"]') as HTMLButtonElement;

const SAVED: Overrides = {
  on: true,
  productId: 'PRD-48213',
  link: 'https://pagamento.exemplo.invalid/ingresso',
  priceText: '80,00',
};

describe('the tracer: the switch and the three fields (UI-D-741)', () => {
  it('while off it draws the title, the helper and the switch, and nothing else', () => {
    section();
    expect(q('h3')?.textContent).toBe('Ingresso');
    expect(text()).toContain(
      `Opcional. Venda este evento pelo ${GATEWAY}: a presença é confirmada quando o pagamento for aprovado.`,
    );
    expect(switchButton().getAttribute('aria-checked')).toBe('false');
    expect(switchButton().getAttribute('aria-label')).toBe('Cobrar ingresso');
    expect(switchButton().disabled).toBe(false);
    expect(q('[data-ticket-fields]')).toBeNull();
    expect(el('event-gateway-id')).toBeNull();
    expect(el('event-checkout-url')).toBeNull();
    expect(el('event-ticket-price')).toBeNull();
  });

  it('a click on the switch asks for the opposite value', () => {
    const { onToggle } = section();
    fireEvent.click(switchButton());
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('with the switch on it reveals the three fields with their attributes and helpers', () => {
    section({}, { on: true });
    const id = el('event-gateway-id') as HTMLInputElement;
    const link = el('event-checkout-url') as HTMLInputElement;
    const price = el('event-ticket-price') as HTMLInputElement;

    expect(document.querySelector(`label[for="event-gateway-id"]`)?.textContent).toBe(
      `ID do produto no ${GATEWAY}`,
    );
    expect(id.className).toContain('tabular-nums');
    expect(id.getAttribute('autocapitalize')).toBe('none');
    expect(id.getAttribute('autocomplete')).toBe('off');
    expect(id.getAttribute('spellcheck')).toBe('false');
    expect(id.maxLength).toBe(PAYMENTS_MAX_PRODUCT_ID);

    expect(link.type).toBe('url');
    expect(link.placeholder).toBe('https://');
    expect(link.maxLength).toBe(PAYMENTS_MAX_LINK);
    expect(document.querySelector(`label[for="event-checkout-url"]`)?.textContent).toBe(
      'Link de compra',
    );

    expect(price.getAttribute('inputmode')).toBe('decimal');
    expect(price.className).toContain('tabular-nums');
    expect(price.placeholder).toBe('Ex.: 80,00');
    expect(document.querySelector(`label[for="event-ticket-price"]`)?.textContent).toBe(
      'Preço de referência (R$)',
    );

    expect(text()).toContain(
      `Copie o ID no painel do ${GATEWAY}. É por ele que reconhecemos a compra.`,
    );
    expect(text()).toContain('O botão Comprar ingresso abre este link.');
    expect(text()).toContain(
      `Opcional. Aparece no cartão e no botão. O valor cobrado é o do ${GATEWAY}.`,
    );
  });

  it('typing in a field reports the new text', () => {
    const { onProductId, onLink, onPriceText } = section({}, { on: true });
    fireEvent.change(el('event-gateway-id') as HTMLInputElement, { target: { value: 'PRD-9' } });
    fireEvent.change(el('event-checkout-url') as HTMLInputElement, {
      target: { value: 'https://x.invalid/a' },
    });
    fireEvent.change(el('event-ticket-price') as HTMLInputElement, { target: { value: '12' } });
    expect(onProductId).toHaveBeenCalledWith('PRD-9');
    expect(onLink).toHaveBeenCalledWith('https://x.invalid/a');
    expect(onPriceText).toHaveBeenCalledWith('12');
  });

  it('echoes a price that parses as 80,00 on blur, and leaves a typo alone', () => {
    const first = section({}, { on: true, priceText: '80' });
    fireEvent.blur(el('event-ticket-price') as HTMLInputElement);
    expect(first.onPriceText).toHaveBeenCalledWith('80,00');
    cleanup();

    const second = section({}, { on: true, priceText: 'abc' });
    fireEvent.blur(el('event-ticket-price') as HTMLInputElement);
    expect(second.onPriceText).not.toHaveBeenCalled();
    cleanup();

    const third = section({}, { on: true, priceText: '' });
    fireEvent.blur(el('event-ticket-price') as HTMLInputElement);
    expect(third.onPriceText).not.toHaveBeenCalled();
  });

  it('never names the provider, whatever the display name', () => {
    section({}, { on: true });
    expect(text()).not.toMatch(/kiwify/i);
  });
});

describe('UI-D-742: the states, first match wins', () => {
  it('(a) locked: switch on and disabled, id and link disabled, the PRICE still editable', () => {
    section({ linked: true, soldCount: 3 }, { ...SAVED });
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('locked');
    expect(switchButton().getAttribute('aria-checked')).toBe('true');
    expect(switchButton().disabled).toBe(true);
    expect((el('event-gateway-id') as HTMLInputElement).disabled).toBe(true);
    expect((el('event-checkout-url') as HTMLInputElement).disabled).toBe(true);
    expect((el('event-ticket-price') as HTMLInputElement).disabled).toBe(false);
    const notice = q('[data-ticket-locked]') as HTMLElement;
    expect(notice.className).toContain('bg-bg-secondary');
    expect(notice.querySelector('svg')).not.toBeNull();
    expect(notice.textContent).toBe(
      '3 ingressos vendidos. O produto não pode mudar nem sair enquanto houver ingressos pagos.',
    );
  });

  it('(a) locked: one sale is the singular, many the plural', () => {
    section({ linked: true, soldCount: 1 }, { ...SAVED });
    expect(q('[data-ticket-locked]')?.textContent).toContain('1 ingresso vendido.');
    cleanup();
    section({ linked: true, soldCount: 12 }, { ...SAVED });
    expect(q('[data-ticket-locked]')?.textContent).toContain('12 ingressos vendidos.');
  });

  it('(a) locked beats every other state, a disconnected gateway included', () => {
    section({ linked: true, soldCount: 2, moduleOn: false, gatewayConnected: false }, { ...SAVED });
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('locked');
    expect(q('[data-ticket-linked-unavailable]')).toBeNull();
  });

  it('(b) module off with nothing linked: switch disabled and off, the warning row, no fields', () => {
    section({ moduleOn: false, gatewayConnected: false });
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('moduleOff');
    expect(switchButton().disabled).toBe(true);
    expect(switchButton().getAttribute('aria-checked')).toBe('false');
    const row = q('[data-ticket-module-off]') as HTMLElement;
    expect(row.className).toContain('bg-warning/10');
    expect(row.querySelector('svg')).not.toBeNull();
    expect(row.textContent).toBe(
      'O módulo Pagamentos está desligado. Fale com a plataforma para ligá-lo e vender ingressos.',
    );
    expect(q('[data-ticket-fields]')).toBeNull();
  });

  it('(c) not connected: switch disabled, the note and the Abrir Pagamentos link for payments.manage', () => {
    section({ gatewayConnected: false });
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('notConnected');
    expect(switchButton().disabled).toBe(true);
    expect(q('[data-ticket-not-connected]')?.textContent).toContain(
      'Conecte a integração em Pagamentos para vender ingressos.',
    );
    const link = q('[data-ticket-not-connected] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/configuracoes/pagamentos');
    expect(link.textContent).toBe('Abrir Pagamentos');
    expect(link.className).toContain('text-brand');
    expect(link.className).toContain('font-bold');
  });

  it('(c) not connected, a viewer without payments.manage: the same note and no link', () => {
    section({ gatewayConnected: false, canManagePayments: false });
    expect(q('[data-ticket-not-connected]')?.textContent).toBe(
      'Conecte a integração em Pagamentos para vender ingressos.',
    );
    expect(q('[data-ticket-not-connected] a')).toBeNull();
  });

  it('(d) linked but module off or gateway disconnected: on and disabled, stored values disabled, the warning', () => {
    for (const off of [{ moduleOn: false }, { gatewayConnected: false }]) {
      section({ linked: true, ...off }, { ...SAVED });
      expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('linkedUnavailable');
      expect(switchButton().getAttribute('aria-checked')).toBe('true');
      expect(switchButton().disabled).toBe(true);
      for (const id of ['event-gateway-id', 'event-checkout-url', 'event-ticket-price']) {
        expect((el(id) as HTMLInputElement).disabled, id).toBe(true);
      }
      expect((el('event-gateway-id') as HTMLInputElement).value).toBe('PRD-48213');
      const row = q('[data-ticket-linked-unavailable]') as HTMLElement;
      expect(row.className).toContain('bg-warning/10');
      expect(row.textContent).toBe(
        'Pagamentos está desligado ou desconectado. Os membros veem “Venda indisponível” até voltar.',
      );
      cleanup();
    }
  });

  it('(e) recurring: the non-blocking warning sits under the id field and nothing is disabled', () => {
    section({ linked: true, recurring: true }, { ...SAVED });
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('recurring');
    const row = q('[data-ticket-recurring]') as HTMLElement;
    expect(row.textContent).toBe(
      'Este produto parece ser uma assinatura. Renovações não mudam a presença: só a primeira compra confirma.',
    );
    expect(row.getAttribute('role')).toBe('status');
    expect(row.className).toContain('bg-warning/10');
    // Under the id field: it follows the id input in the same group, before the link field.
    const id = el('event-gateway-id') as HTMLElement;
    const link = el('event-checkout-url') as HTMLElement;
    expect(id.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(switchButton().disabled).toBe(false);
    expect((el('event-gateway-id') as HTMLInputElement).disabled).toBe(false);
  });

  it('(e) recurring: absent without the hint (no pre-check, A-UI-10)', () => {
    section({ linked: true }, { ...SAVED });
    expect(q('[data-ticket-recurring]')).toBeNull();
  });

  it('(f) free, module on and connected: the switch is off and enabled', () => {
    section();
    expect(q('[data-event-ticket]')?.getAttribute('data-ticket-state')).toBe('free');
    expect(switchButton().disabled).toBe(false);
    expect(switchButton().getAttribute('aria-checked')).toBe('false');
    expect(q('[data-ticket-module-off]')).toBeNull();
    expect(q('[data-ticket-not-connected]')).toBeNull();
    expect(q('[data-ticket-locked]')).toBeNull();
  });
});

describe('UI-D-741 and UI-D-743: notes and errors', () => {
  it('the existing-presences note sits under the price, only when the form says so (D-748)', () => {
    section({}, { on: true, existingNote: true });
    expect(q('[data-ticket-existing-note]')?.textContent).toBe(
      'Quem já confirmou presença continua inscrito, sem pagar. Só quem responder depois paga.',
    );
    cleanup();
    section({}, { on: true });
    expect(q('[data-ticket-existing-note]')).toBeNull();
  });

  it('switching off a saved product draws the effect line under the switch row (D-747)', () => {
    section({ linked: true }, { on: false, offNote: true });
    expect(q('[data-ticket-off-note]')?.textContent).toBe(
      'Sem ingresso, o evento volta a confirmar presença na hora, com Vou e Não vou.',
    );
    expect(q('[data-ticket-fields]')).toBeNull();
  });

  it('a field error takes the helper’s place and is the input’s own alert', () => {
    const errors: TicketFieldErrors = {
      id: 'idRequired',
      link: 'linkInvalid',
      price: 'priceInvalid',
    };
    section({}, { on: true, errors });
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
    expect(alerts).toEqual([
      'Informe o ID do produto.',
      'Use um link que comece com https://.',
      'Informe um valor em reais, como 80,00.',
    ]);
    expect(el('event-gateway-id')?.getAttribute('aria-invalid')).toBe('true');
    expect(el('event-gateway-id')?.getAttribute('aria-describedby')).toBe('event-gateway-id-error');
    expect(text()).not.toContain('Copie o ID no painel');
    expect(text()).not.toContain('O botão Comprar ingresso abre este link.');
    expect(text()).not.toContain('Opcional. Aparece no cartão');
  });

  it('the empty-link error and the taken-id error, the last one with the gateway name', () => {
    section({}, { on: true, errors: { id: 'idTaken', link: 'linkRequired' } });
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
    expect(alerts).toEqual([
      `Este ID já está em uso. Confira o ID no ${GATEWAY}.`,
      'Informe o link de compra.',
    ]);
  });

  it('the lock refusal is its own alert row at the top of the section, before the switch', () => {
    section({ linked: true, soldCount: 2 }, { ...SAVED, errors: { section: 'locked' } });
    const row = q('[data-ticket-section-error]') as HTMLElement;
    expect(row.getAttribute('role')).toBe('alert');
    expect(row.textContent).toBe('Já há ingressos vendidos. O produto não pode mudar.');
    expect(
      row.compareDocumentPosition(switchButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('every control is disabled while the submit runs (UI-D-743)', () => {
    section({}, { on: true, busy: true });
    expect(switchButton().disabled).toBe(true);
    for (const id of ['event-gateway-id', 'event-checkout-url', 'event-ticket-price']) {
      expect((el(id) as HTMLInputElement).disabled, id).toBe(true);
    }
  });

  it('keeps long values whole: the id and the link are never cut by the component', () => {
    const longLink = `https://pagamento.exemplo.invalid/${'a'.repeat(300)}`;
    section({}, { on: true, productId: 'P'.repeat(128), link: longLink });
    expect((el('event-gateway-id') as HTMLInputElement).value).toHaveLength(128);
    expect((el('event-checkout-url') as HTMLInputElement).value).toBe(longLink);
  });
});
