import { join } from 'node:path';
import type { PaymentsOverview } from '@rede-social/contracts/payments';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { overviewView, type PaymentsTranslator } from './payments-view';

/**
 * 09.1-13 — the view helpers of the Pagamentos screen (UI-D-514): finished strings and flags, built
 * from the overview and the server's own clock, through the REAL merged catalog.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as PaymentsTranslator;

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
    const view = overviewView(overview(), t).integration;
    expect(view.lastEvent).toBe('Último evento recebido há 3 min.');
    expect(view.showEventsLink).toBe(true);
    expect(view.eventsHref).toBe('/configuracoes/pagamentos?aba=eventos');
  });

  it('turns a null lastEventAt into "Nenhum evento recebido ainda." with no link', () => {
    const view = overviewView(overview({ lastEventAt: null }), t).integration;
    expect(view.lastEvent).toBe('Nenhum evento recebido ainda.');
    expect(view.showEventsLink).toBe(false);
  });

  it('never doubles the full stop the relative formatter ends with, or reads the browser clock', () => {
    const view = overviewView(overview({ lastEventAt: NOW }), t).integration;
    expect(view.lastEvent).toBe('Último evento recebido agora.');
    expect(view.lastEvent).not.toContain('..');
  });

  it('carries the connection flag, the adapter name and the webhook URL as given', () => {
    const view = overviewView(
      overview({ connected: false, gatewayName: 'Outro', lastEventAt: null }),
      t,
    ).integration;
    expect(view.connected).toBe(false);
    expect(view.gatewayName).toBe('Outro');
    expect(view.webhookUrl).toBe('https://api.example.test/v1/webhooks/kiwify/abc123');
  });
});
