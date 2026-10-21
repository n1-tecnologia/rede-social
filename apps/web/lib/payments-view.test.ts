import { join } from 'node:path';
import type { AccessItem, PaymentsOverview } from '@rede-social/contracts/payments';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  type AccessProductView,
  accessFilterFromParam,
  accessListHref,
  accessProductView,
  accessQueryFromParam,
  accessRowView,
  accessSheetView,
  gateView,
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

describe('gateView (UI-D-516, A-UI-2)', () => {
  it("hands the server's flags through untouched: the web never decides who can enable the gate", () => {
    expect(gateView({ required: false, canEnable: false })).toEqual({
      required: false,
      canEnable: false,
    });
    expect(gateView({ required: true, canEnable: true })).toEqual({
      required: true,
      canEnable: true,
    });
  });
});

/* ── 09.1-14: the Acessos row and sheet views (UI-D-517, UI-D-518, UI-D-520) ───────────────────── */

const SAO_PAULO = 'America/Sao_Paulo';
const ACCESS_CTX = {
  gatewayName: 'Kiwify',
  timeZone: SAO_PAULO,
  serverNow: NOW,
  gateRequired: true,
};

function access(patch: Partial<AccessItem> = {}): AccessItem {
  return {
    id: 'ana@exemplo.com.br',
    email: 'ana@exemplo.com.br',
    source: 'kiwify',
    state: 'active',
    validUntil: '2026-11-12T15:00:00.000Z',
    hasAccount: true,
    updatedAt: THREE_MINUTES_AGO,
    ...patch,
  };
}

describe('accessRowView (UI-D-517): finished strings from the server row', () => {
  it('words the state, the gateway source and the validity in the tenant timezone', () => {
    expect(accessRowView(access(), t, ACCESS_CTX)).toEqual({
      id: 'ana@exemplo.com.br',
      email: 'ana@exemplo.com.br',
      state: 'active',
      stateLabel: 'Ativo',
      sourceLabel: 'Kiwify',
      hasAccount: true,
      noAccountLabel: 'Ainda sem conta',
      validityLabel: 'Válido até 12 de nov. de 2026',
    });
  });

  it('reads the date in the TENANT zone, never the device zone: 01:30Z on the 13th is still the 12th in São Paulo', () => {
    const row = accessRowView(access({ validUntil: '2026-11-13T01:30:00.000Z' }), t, ACCESS_CTX);
    expect(row.validityLabel).toBe('Válido até 12 de nov. de 2026');
    const tokyo = accessRowView(access({ validUntil: '2026-11-13T01:30:00.000Z' }), t, {
      ...ACCESS_CTX,
      timeZone: 'Asia/Tokyo',
    });
    expect(tokyo.validityLabel).toBe('Válido até 13 de nov. de 2026');
  });

  it('says "Sem data de validade" when the server sends no validity', () => {
    expect(accessRowView(access({ validUntil: null }), t, ACCESS_CTX).validityLabel).toBe(
      'Sem data de validade',
    );
  });

  it('words every state with the shared vocabulary and the manual source as "Manual"', () => {
    const pending = accessRowView(access({ state: 'subscription_pending' }), t, ACCESS_CTX);
    expect(pending.stateLabel).toBe('Assinatura pendente');
    const blocked = accessRowView(access({ state: 'blocked', source: 'manual' }), t, ACCESS_CTX);
    expect(blocked.stateLabel).toBe('Bloqueado');
    expect(blocked.sourceLabel).toBe('Manual');
  });

  it('passes hasAccount through exactly as sent: the web does not look it up', () => {
    expect(accessRowView(access({ hasAccount: false }), t, ACCESS_CTX).hasAccount).toBe(false);
  });
});

describe('accessSheetView (UI-D-518, D-489, D-504): actions and notes by case', () => {
  it('a gateway row offers only "Bloquear acesso" and says the gateway owns it', () => {
    const view = accessSheetView(access(), t, ACCESS_CTX);
    expect(view.actions).toEqual({ block: true, unblock: false, removeRelease: false });
    expect(view.notes).toEqual(['Este acesso vem do Kiwify e muda sozinho com a assinatura.']);
  });

  it('a gateway row that is late still offers only "Bloquear acesso"', () => {
    const view = accessSheetView(access({ state: 'subscription_pending' }), t, ACCESS_CTX);
    expect(view.actions).toEqual({ block: true, unblock: false, removeRelease: false });
  });

  it('a manual release offers "Bloquear acesso" and "Remover liberação", with no note', () => {
    const view = accessSheetView(
      access({ source: 'manual', validUntil: null, hasAccount: false }),
      t,
      ACCESS_CTX,
    );
    expect(view.actions).toEqual({ block: true, unblock: false, removeRelease: true });
    expect(view.notes).toEqual([]);
  });

  it('a blocked row offers only "Desbloquear acesso" and says a manual block wins', () => {
    const view = accessSheetView(access({ source: 'manual', state: 'blocked' }), t, ACCESS_CTX);
    expect(view.actions).toEqual({ block: false, unblock: true, removeRelease: false });
    expect(view.notes).toEqual(['Um bloqueio manual vale mais que a assinatura.']);
  });

  it('always draws the three rows Origem, Situação and Validade, never blank', () => {
    const view = accessSheetView(
      access({ source: 'manual', validUntil: null, state: 'blocked' }),
      t,
      ACCESS_CTX,
    );
    expect(view.rows).toEqual([
      { key: 'origin', label: 'Origem', value: 'Manual' },
      { key: 'situation', label: 'Situação', value: 'Bloqueado' },
      { key: 'validity', label: 'Validade', value: 'Sem data de validade' },
    ]);
    for (const row of view.rows) expect(row.value).not.toBe('');
  });

  it('words "Atualizado {when}" from the SERVER clock, not the browser', () => {
    expect(accessSheetView(access(), t, ACCESS_CTX).updated).toBe('Atualizado há 3 min');
  });

  it('keeps the e-mail and the pills data for the heading', () => {
    const view = accessSheetView(access({ hasAccount: false }), t, ACCESS_CTX);
    expect(view.email).toBe('ana@exemplo.com.br');
    expect(view.hasAccount).toBe(false);
    expect(view.stateLabel).toBe('Ativo');
    expect(view.sourceLabel).toBe('Kiwify');
  });
});

describe('the Acessos URL (UI-D-517): ?q= and ?status= are read defensively and written canonically', () => {
  it('reads an unknown, repeated, empty or absent ?status= as "all"', () => {
    expect(accessFilterFromParam(undefined)).toBe('all');
    expect(accessFilterFromParam('')).toBe('all');
    expect(accessFilterFromParam('nope')).toBe('all');
    expect(accessFilterFromParam(['blocked', 'active'])).toBe('all');
    expect(accessFilterFromParam('invited')).toBe('all');
  });

  it('keeps the three real filters', () => {
    expect(accessFilterFromParam('active')).toBe('active');
    expect(accessFilterFromParam('subscription_pending')).toBe('subscription_pending');
    expect(accessFilterFromParam('blocked')).toBe('blocked');
  });

  it('trims ?q= and caps it at the contract length so a megabyte of query never reaches the API', () => {
    expect(accessQueryFromParam(undefined)).toBe('');
    expect(accessQueryFromParam('   ')).toBe('');
    expect(accessQueryFromParam('  ana  ')).toBe('ana');
    expect(accessQueryFromParam(['ana', 'bia'])).toBe('');
    expect(accessQueryFromParam('x'.repeat(5000))).toHaveLength(200);
  });

  it('writes the canonical tab URL: bare for "all" and no search, q before status otherwise', () => {
    expect(accessListHref('', 'all')).toBe('/configuracoes/pagamentos?aba=acessos');
    expect(accessListHref('ana', 'all')).toBe('/configuracoes/pagamentos?aba=acessos&q=ana');
    expect(accessListHref('', 'blocked')).toBe(
      '/configuracoes/pagamentos?aba=acessos&status=blocked',
    );
    expect(accessListHref('a b', 'active')).toBe(
      '/configuracoes/pagamentos?aba=acessos&q=a+b&status=active',
    );
  });
});

describe('accessSheetView: the block note while the gate is off (assumption A-P10)', () => {
  it('adds the line after the blocked note only when the gate is off', () => {
    const blocked = access({ source: 'manual', state: 'blocked', validUntil: null });
    expect(accessSheetView(blocked, t, { ...ACCESS_CTX, gateRequired: false }).notes).toEqual([
      'Um bloqueio manual vale mais que a assinatura.',
      'O bloqueio só vale enquanto “Exigir assinatura para entrar” está ligado.',
    ]);
    expect(accessSheetView(blocked, t, { ...ACCESS_CTX, gateRequired: true }).notes).toEqual([
      'Um bloqueio manual vale mais que a assinatura.',
    ]);
  });

  it('never adds it to a row that is not blocked', () => {
    expect(accessSheetView(access(), t, { ...ACCESS_CTX, gateRequired: false }).notes).toEqual([
      'Este acesso vem do Kiwify e muda sozinho com a assinatura.',
    ]);
  });
});
