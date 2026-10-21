import { join } from 'node:path';
import type { PaymentsOverview } from '@rede-social/contracts/payments';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  type AccessProductView,
  accessProductView,
  overviewView,
  type PaymentsTranslator,
  withFeedsMark,
} from './payments-view';

/**
 * 09.1-13 — the view helpers of the Pagamentos screen (UI-D-514): finished strings and flags, built
 * from the overview and the server's own clock, through the REAL merged catalog.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as PaymentsTranslator;

const CTX = { tenantName: 'Rede Demo' };
const NOW = '2026-10-21T12:00:00.000Z';
const THREE_MINUTES_AGO = '2026-10-21T11:57:00.000Z';

function overview(patch: Partial<PaymentsOverview['integration']> = {}): PaymentsOverview {
  return {
    integration: {
      provider: 'kiwify',
      gatewayName: 'Kiwify',
      connected: true,
      webhookUrl: 'https://api.example.test/v1/webhooks/kiwify/abc123',
      lastEventAt: THREE_MINUTES_AGO,
      ...patch,
    },
    accessProducts: [],
    gate: { required: false, canEnable: false },
    serverNow: NOW,
  };
}

describe('overviewView: the Integração card (UI-D-514)', () => {
  it('turns an event three minutes before serverNow into the last-event line, with the link', () => {
    const view = overviewView(overview(), t, CTX).integration;
    expect(view.lastEvent).toBe('Último evento recebido há 3 min.');
    expect(view.showEventsLink).toBe(true);
    expect(view.eventsHref).toBe('/configuracoes/pagamentos?aba=eventos');
  });

  it('turns a null lastEventAt into "Nenhum evento recebido ainda." with no link', () => {
    const view = overviewView(overview({ lastEventAt: null }), t, CTX).integration;
    expect(view.lastEvent).toBe('Nenhum evento recebido ainda.');
    expect(view.showEventsLink).toBe(false);
  });

  it('never doubles the full stop the relative formatter ends with, or reads the browser clock', () => {
    const view = overviewView(overview({ lastEventAt: NOW }), t, CTX).integration;
    expect(view.lastEvent).toBe('Último evento recebido agora.');
    expect(view.lastEvent).not.toContain('..');
  });

  it('carries the connection flag, the adapter name and the webhook URL as given', () => {
    const view = overviewView(
      overview({ connected: false, gatewayName: 'Outro', lastEventAt: null }),
      t,
      CTX,
    ).integration;
    expect(view.connected).toBe(false);
    expect(view.gatewayName).toBe('Outro');
    expect(view.webhookUrl).toBe('https://api.example.test/v1/webhooks/kiwify/abc123');
  });
});

const PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Assinatura mensal',
  externalProductId: 'a1b2c3',
  checkoutUrl: 'https://pay.example.test/mensal',
  feedsSubscribeButton: true,
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('overviewView: the setup view (UI-D-515, UI-D-516)', () => {
  it('carries the tenant name, the gate flags as the server sent them and the finished product rows', () => {
    const view = overviewView(
      {
        ...overview(),
        accessProducts: [PRODUCT],
        gate: { required: true, canEnable: true },
      },
      t,
      CTX,
    );
    expect(view.tenantName).toBe('Rede Demo');
    expect(view.gate).toEqual({ required: true, canEnable: true });
    expect(view.products).toHaveLength(1);
    expect(view.products[0]?.idMeta).toBe('ID a1b2c3');
  });
});

describe('accessProductView (UI-D-515)', () => {
  it('finishes the ID line and flags a missing link and the Assinar mark', () => {
    expect(accessProductView(PRODUCT, t)).toEqual({
      id: PRODUCT.id,
      name: 'Assinatura mensal',
      externalProductId: 'a1b2c3',
      checkoutUrl: 'https://pay.example.test/mensal',
      idMeta: 'ID a1b2c3',
      hasLink: true,
      feedsButton: true,
    });
    const bare = accessProductView(
      { ...PRODUCT, checkoutUrl: null, feedsSubscribeButton: false },
      t,
    );
    expect(bare.hasLink).toBe(false);
    expect(bare.checkoutUrl).toBeNull();
    expect(bare.feedsButton).toBe(false);
  });
});

describe('withFeedsMark (A-UI-7: the oldest product with a link feeds the button)', () => {
  const row = (id: string, link: string | null) =>
    accessProductView(
      {
        ...PRODUCT,
        id,
        name: id,
        externalProductId: id,
        checkoutUrl: link,
        feedsSubscribeButton: false,
      },
      t,
    );

  it('marks exactly one row: the first with a link, in the order given', () => {
    const marked = withFeedsMark([
      row('a', null),
      row('b', 'https://x.test/b'),
      row('c', 'https://x.test/c'),
    ]);
    expect(marked.map((p) => p.feedsButton)).toEqual([false, true, false]);
  });

  it('marks nothing when no product has a link, and nothing for an empty list', () => {
    expect(withFeedsMark([row('a', null), row('b', null)]).some((p) => p.feedsButton)).toBe(false);
    expect(withFeedsMark([])).toEqual([]);
  });

  it('moves the mark when the marked row loses its link, and never mutates its input', () => {
    const before: [AccessProductView, AccessProductView] = [
      row('a', 'https://x.test/a'),
      row('b', 'https://x.test/b'),
    ];
    const after = withFeedsMark([{ ...before[0], checkoutUrl: null, hasLink: false }, before[1]]);
    expect(after.map((p) => p.feedsButton)).toEqual([false, true]);
    expect(before.map((p) => p.feedsButton)).toEqual([false, false]);
  });
});
