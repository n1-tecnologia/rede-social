import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages, type MessageTree } from './messages';

/**
 * Phase 10.1-11 (UI-D-740, UI-D-765) — the paid event's `events.json` copy. This file pins what a copy
 * edit must not break: the merge under the single root `events`, every key of the event form's
 * Ingresso section (`form.ticket.*`), every ICU plural and every placeholder, and the neutrality rule
 * (the provider is only ever the `{gateway}` slot). Later UI plans of the phase extend the lists below
 * with their own keys (`ticket.*`, `card.paid*`, `participants.origin.*`, ...).
 *
 * Real merged catalog, real next-intl formatter: a plural that stops parsing fails here, not on a
 * member's phone.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const events = messages.events as MessageTree;

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

const all = leaves(events);

/** The names a message interpolates: `{name}` and `{name, plural, …}`, not the text inside a form. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1] as string).sort();
}

const translate = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'events' as never,
}) as unknown as (key: string, values?: Record<string, unknown>) => string;

/** The copy of plan 10.1-11, key by key: the sentence and the placeholders it interpolates. */
const FORM_TICKET: Record<string, { text: string; names: string[] }> = {
  'form.ticket.title': { text: 'Ingresso', names: [] },
  'form.ticket.helper': {
    text: 'Opcional. Venda este evento pelo {gateway}: a presença é confirmada quando o pagamento for aprovado.',
    names: ['gateway'],
  },
  'form.ticket.switch': { text: 'Cobrar ingresso', names: [] },
  'form.ticket.idLabel': { text: 'ID do produto no {gateway}', names: ['gateway'] },
  'form.ticket.idHelper': {
    text: 'Copie o ID no painel do {gateway}. É por ele que reconhecemos a compra.',
    names: ['gateway'],
  },
  'form.ticket.linkLabel': { text: 'Link de compra', names: [] },
  'form.ticket.linkPlaceholder': { text: 'https://', names: [] },
  'form.ticket.linkHelper': { text: 'O botão Comprar ingresso abre este link.', names: [] },
  'form.ticket.priceLabel': { text: 'Preço de referência (R$)', names: [] },
  'form.ticket.pricePlaceholder': { text: 'Ex.: 80,00', names: [] },
  'form.ticket.priceHelper': {
    text: 'Opcional. Aparece no cartão e no botão. O valor cobrado é o do {gateway}.',
    names: ['gateway'],
  },
  'form.ticket.existingNote': {
    text: 'Quem já confirmou presença continua inscrito, sem pagar. Só quem responder depois paga.',
    names: [],
  },
  'form.ticket.offEffect': {
    text: 'Sem ingresso, o evento volta a confirmar presença na hora, com Vou e Não vou.',
    names: [],
  },
  'form.ticket.soldLocked': {
    text: '{count, plural, one {# ingresso vendido} other {# ingressos vendidos}}. O produto não pode mudar nem sair enquanto houver ingressos pagos.',
    names: ['count'],
  },
  'form.ticket.moduleOff': {
    text: 'O módulo Pagamentos está desligado. Fale com a plataforma para ligá-lo e vender ingressos.',
    names: [],
  },
  'form.ticket.notConnected': {
    text: 'Conecte a integração em Pagamentos para vender ingressos.',
    names: [],
  },
  'form.ticket.openPayments': { text: 'Abrir Pagamentos', names: [] },
  'form.ticket.linkedUnavailable': {
    text: 'Pagamentos está desligado ou desconectado. Os membros veem “Venda indisponível” até voltar.',
    names: [],
  },
  'form.ticket.recurring': {
    text: 'Este produto parece ser uma assinatura. Renovações não mudam a presença: só a primeira compra confirma.',
    names: [],
  },
  'form.ticket.gatewayFallback': { text: 'gateway de pagamento', names: [] },
  'form.ticket.errors.idRequired': { text: 'Informe o ID do produto.', names: [] },
  'form.ticket.errors.linkRequired': { text: 'Informe o link de compra.', names: [] },
  'form.ticket.errors.linkInvalid': { text: 'Use um link que comece com https://.', names: [] },
  'form.ticket.errors.taken': {
    text: 'Este ID já está em uso. Confira o ID no {gateway}.',
    names: ['gateway'],
  },
  'form.ticket.errors.priceInvalid': {
    text: 'Informe um valor em reais, como 80,00.',
    names: [],
  },
  'form.ticket.errors.locked': {
    text: 'Já há ingressos vendidos. O produto não pode mudar.',
    names: [],
  },
  'form.ticket.errors.save': {
    text: 'Evento salvo, mas não foi possível salvar o ingresso. Tente novamente.',
    names: [],
  },
};

/**
 * The member page's copy of plan 10.1-12 (UI-D-744 to UI-D-750, UI-D-753): the card, the zone and its
 * disabled states, the Presença confirmada block in its three variants, the cancelled and refunded
 * lines, the give-up dialog and the two stale-tab toasts.
 */
const MEMBER_TICKET: Record<string, { text: string; names: string[] }> = {
  'ticket.badge': { text: 'Pago', names: [] },
  'card.paid': { text: ', evento pago', names: [] },
  'card.paidPrice': { text: ', evento pago, {price}', names: ['price'] },
  'card.priceNote': { text: '{price} · {note}', names: ['note', 'price'] },
  'ticket.cta.buy': { text: 'Comprar ingresso', names: [] },
  'ticket.cta.buyPrice': { text: 'Comprar ingresso · {price}', names: ['price'] },
  'ticket.cta.newTab': { text: '(abre a página de pagamento em uma nova aba)', names: [] },
  'ticket.cta.soldOut': { text: 'Esgotado', names: [] },
  'ticket.cta.salesClosed': { text: 'Vendas encerradas', names: [] },
  'ticket.cta.unavailable': { text: 'Venda indisponível', names: [] },
  'ticket.hint.afterPay': {
    text: 'Depois de pagar, sua presença aparece aqui sozinha.',
    names: [],
  },
  'ticket.hint.salesClosed': {
    text: 'A venda pelo app terminou quando o evento começou.',
    names: [],
  },
  'ticket.hint.unavailable': { text: 'Os ingressos não estão à venda no momento.', names: [] },
  'ticket.hint.onlineLink': {
    text: 'O link da transmissão é só para quem tem ingresso.',
    names: [],
  },
  'ticket.confirmed.title': { text: 'Presença confirmada', names: [] },
  'ticket.confirmed.paid': {
    text: 'Ingresso pago. Para desistir, peça o reembolso na página de pagamento: sua presença sai daqui sozinha.',
    names: [],
  },
  'ticket.confirmed.courtesy': {
    text: 'Cortesia da organização. Para desistir, fale com a equipe de {tenant}.',
    names: ['tenant'],
  },
  'ticket.confirmed.beforeTicket': {
    text: 'Sua inscrição é anterior ao ingresso, por isso não há cobrança.',
    names: [],
  },
  'ticket.cancelled.body': {
    text: 'A organização cancelou este evento. A venda e o check-in estão desativados.',
    names: [],
  },
  'ticket.cancelled.refund': {
    text: 'Fale com a equipe de {tenant} sobre o reembolso do ingresso.',
    names: ['tenant'],
  },
  'ticket.refunded.note': {
    text: 'Seu ingresso foi reembolsado e a presença saiu da lista.',
    names: [],
  },
  'ticket.refunded.afterCheckin': {
    text: 'Seu ingresso foi reembolsado, mas o check-in continua registrado.',
    names: [],
  },
  'ticket.giveUp.title': { text: 'Cancelar inscrição?', names: [] },
  'ticket.giveUp.body': {
    text: 'Para voltar a este evento, você vai precisar comprar o ingresso.',
    names: [],
  },
  'ticket.giveUp.confirm': { text: 'Cancelar inscrição', names: [] },
  'ticket.giveUp.dismiss': { text: 'Manter inscrição', names: [] },
  'rsvp.errors.paid': {
    text: 'Este evento passou a ter ingresso pago. A página foi atualizada.',
    names: [],
  },
  'rsvp.errors.ticketLocked': {
    text: 'Sua presença já está confirmada pelo ingresso. A página foi atualizada.',
    names: [],
  },
};

/** The ICU plural keys and the variable each counts on. */
const PLURALS: Record<string, string> = {
  'form.ticket.soldLocked': 'count',
};

describe('events.json: the member page of a paid event (UI-D-744 to UI-D-749, UI-D-753)', () => {
  it('carries every key with the approved sentence', () => {
    for (const [key, { text }] of Object.entries(MEMBER_TICKET)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
    }
  });

  it('names every placeholder of the contract, key by key', () => {
    for (const [key, { names }] of Object.entries(MEMBER_TICKET)) {
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(
        [...names].sort(),
      );
    }
  });

  it('holds no key under ticket.* that the contract does not list', () => {
    const present = Object.keys(all).filter((key) => key.startsWith('ticket.'));
    const listed = Object.keys(MEMBER_TICKET).filter((key) => key.startsWith('ticket.'));
    expect(present.sort()).toEqual(listed.sort());
  });

  it('fills {tenant} as a plain value, markup and all, never interpreting it', () => {
    expect(translate('ticket.confirmed.courtesy', { tenant: 'Rede <b>Demo</b>' })).toBe(
      'Cortesia da organização. Para desistir, fale com a equipe de Rede <b>Demo</b>.',
    );
    expect(translate('ticket.cancelled.refund', { tenant: 'Rede Demo' })).toBe(
      'Fale com a equipe de Rede Demo sobre o reembolso do ingresso.',
    );
  });

  it('promises no automatic refund (A-UI-14)', () => {
    for (const key of [
      'ticket.confirmed.paid',
      'ticket.cancelled.refund',
      'ticket.refunded.note',
    ]) {
      expect(all[key], `events.${key}`).not.toMatch(
        /reembolsado automaticamente|devolvemos|estorno automático/i,
      );
    }
  });

  it('fills the card suffix, the price note and the button label', () => {
    expect(translate('card.paidPrice', { price: 'R$ 80,00' })).toBe(', evento pago, R$ 80,00');
    expect(translate('card.priceNote', { price: 'R$ 80,00', note: 'Últimas 3 vagas' })).toBe(
      'R$ 80,00 · Últimas 3 vagas',
    );
    expect(translate('ticket.cta.buyPrice', { price: 'R$ 80,00' })).toBe(
      'Comprar ingresso · R$ 80,00',
    );
  });

  it('never names the gateway on a member surface and says nothing of a processing state', () => {
    for (const key of Object.keys(MEMBER_TICKET)) {
      expect(all[key], `events.${key}`).not.toMatch(/gateway|webhook|token|pedido|processando/i);
    }
  });
});

describe('events.json: the Ingresso section of the event form (UI-D-741 to UI-D-743)', () => {
  it('merges into the catalog under the single root key `events`', () => {
    expect(Object.keys(messages)).toContain('events');
    expect(Object.keys(events)).toContain('form');
  });

  it('carries every key of the section with the approved sentence', () => {
    for (const [key, { text }] of Object.entries(FORM_TICKET)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
    }
  });

  it('holds no key under form.ticket that the contract does not list', () => {
    const present = Object.keys(all).filter((key) => key.startsWith('form.ticket.'));
    expect(present.sort()).toEqual(Object.keys(FORM_TICKET).sort());
  });

  it('names every placeholder of the contract, key by key', () => {
    for (const [key, { names }] of Object.entries(FORM_TICKET)) {
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(
        [...names].sort(),
      );
    }
  });

  it('every plural carries `one` and `other` and formats both counts', () => {
    for (const [key, variable] of Object.entries(PLURALS)) {
      const text = all[key] as string;
      expect(text, `events.${key} needs a one form`).toMatch(/plural,\s*one\s*\{/);
      expect(text, `events.${key} needs an other form`).toMatch(/other\s*\{/);
      const one = translate(key, { [variable]: 1 });
      const many = translate(key, { [variable]: 3 });
      expect(one).toBe(
        '1 ingresso vendido. O produto não pode mudar nem sair enquanto houver ingressos pagos.',
      );
      expect(many).toBe(
        '3 ingressos vendidos. O produto não pode mudar nem sair enquanto houver ingressos pagos.',
      );
    }
  });

  it('fills {gateway} with the display name the server passes, and with the neutral fallback', () => {
    expect(translate('form.ticket.idLabel', { gateway: 'Gateway Exemplo' })).toBe(
      'ID do produto no Gateway Exemplo',
    );
    const fallback = all['form.ticket.gatewayFallback'] as string;
    expect(translate('form.ticket.errors.taken', { gateway: fallback })).toBe(
      'Este ID já está em uso. Confira o ID no gateway de pagamento.',
    );
  });

  it('names the provider nowhere: only the {gateway} slot (UI-D-740, TICK-20)', () => {
    for (const [key, text] of Object.entries(all)) {
      expect(text, `events.${key}`).not.toMatch(/kiwify/i);
    }
    for (const key of Object.keys(all)) {
      expect(key, `events.${key}`).not.toMatch(/kiwify/i);
    }
  });

  it('writes the typographic quotes of the contract, not straight ones', () => {
    for (const key of Object.keys(FORM_TICKET)) {
      expect(all[key], `events.${key}`).not.toContain('"');
    }
    expect(all['form.ticket.linkedUnavailable']).toContain('“Venda indisponível”');
  });
});

/**
 * Phase 10.1-13 (UI-D-751, UI-D-752): the copy of the two closed doors. Member surfaces, so the gateway
 * is never named and no placeholder exists.
 */
const DOORS: Record<string, { text: string; names: string[] }> = {
  'enter.ticketRequired.title': { text: 'Este evento tem ingresso', names: [] },
  'enter.ticketRequired.body': {
    text: 'O link da transmissão é só para quem tem ingresso. Compre o seu na página do evento.',
    names: [],
  },
  'checkin.paid': { text: 'O check-in é só para quem tem ingresso.', names: [] },
};

describe('events.json: the closed doors of a paid event (UI-D-751, UI-D-752)', () => {
  it('carries every key with the approved sentence and no placeholder', () => {
    for (const [key, { text, names }] of Object.entries(DOORS)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(names);
    }
  });

  it('never names the gateway on a member surface and never hints at the link or the code', () => {
    for (const key of Object.keys(DOORS)) {
      expect(all[key], `events.${key}`).not.toMatch(/gateway|webhook|token|pedido|kiwify/i);
      expect(all[key], `events.${key}`).not.toMatch(/https?:|código do evento/i);
    }
  });

  it('keeps the three old refusal reasons and the shared "Ver evento"', () => {
    expect(all['enter.ended.title']).toBe('Este evento já terminou');
    expect(all['enter.cancelled.title']).toBe('Este evento foi cancelado');
    expect(all['enter.confirmFirst.title']).toBe('Confirme sua presença');
    expect(all['enter.cta']).toBe('Ver evento');
  });
});

/**
 * Phase 10.1-14 (UI-D-754, UI-D-756): the origin marks and the courtesy removal of Participantes, the
 * admin's screen. The provider never appears here either: a presence is "Pago", not "Pago pelo ...".
 */
const PARTICIPANTS_MARKS: Record<string, { text: string; names: string[] }> = {
  'participants.origin.paid': { text: 'Pago', names: [] },
  'participants.origin.courtesy': { text: 'Cortesia', names: [] },
  'participants.origin.beforeTicket': { text: 'Anterior ao ingresso', names: [] },
  'participants.origin.refunded': { text: 'Reembolsado', names: [] },
  'participants.origin.overLimit': { text: 'Acima do limite', names: [] },
  'participants.courtesy.action': { text: 'Remover cortesia', names: [] },
  'participants.courtesy.actionAria': { text: 'Remover cortesia de {name}', names: ['name'] },
  'participants.courtesy.confirm.title': {
    text: 'Remover a cortesia de {name}?',
    names: ['name'],
  },
  'participants.courtesy.confirm.body': {
    text: 'A pessoa deixa de estar inscrita neste evento. Ninguém é avisado.',
    names: [],
  },
  'participants.courtesy.confirm.confirm': { text: 'Remover cortesia', names: [] },
  'participants.courtesy.confirm.cancel': { text: 'Manter cortesia', names: [] },
  'participants.courtesy.toasts.removed': {
    text: 'Cortesia de {name} removida.',
    names: ['name'],
  },
  'participants.courtesy.errors.locked': {
    text: 'Esta pessoa já fez check-in e a inscrição não pode ser removida.',
    names: [],
  },
  'participants.courtesy.errors.notCourtesy': {
    text: 'Esta presença não é uma cortesia. A lista foi atualizada.',
    names: [],
  },
  'participants.courtesy.errors.gone': {
    text: 'Esta cortesia já tinha sido removida. A lista foi atualizada.',
    names: [],
  },
  'participants.courtesy.errors.generic': { text: 'Algo deu errado. Tente novamente.', names: [] },
};

describe('events.json: the origin marks and the courtesy removal (UI-D-754, UI-D-756)', () => {
  it('carries every key with the approved sentence and its placeholders', () => {
    for (const [key, { text, names }] of Object.entries(PARTICIPANTS_MARKS)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(names);
    }
  });

  it('fills {name} as a plain value, markup and all, never interpreting it', () => {
    expect(translate('participants.courtesy.confirm.title', { name: '<b>Ana</b>' })).toBe(
      'Remover a cortesia de <b>Ana</b>?',
    );
    expect(translate('participants.courtesy.toasts.removed', { name: 'Ana' })).toBe(
      'Cortesia de Ana removida.',
    );
  });

  it('names the provider nowhere (TICK-20)', () => {
    for (const key of Object.keys(PARTICIPANTS_MARKS)) {
      expect(all[key], `events.${key}`).not.toMatch(/kiwify|gateway|webhook/i);
    }
  });
});

/**
 * Phase 10.1-14 (UI-D-755, A-UI-5, A-UI-6): "Liberar presença", the admin's two doors and their one confirm.
 * The cancelled refusal is the SHIPPED `errors.cancelled`, not a new key.
 */
const RELEASE: Record<string, { text: string; names: string[] }> = {
  'participants.release.door': { text: 'Liberar presença', names: [] },
  'participants.release.title': { text: 'Liberar presença', names: [] },
  'participants.release.search': { text: 'Buscar membro', names: [] },
  'participants.release.clear': { text: 'Limpar busca', names: [] },
  'participants.release.prompt': { text: 'Digite o nome ou o e-mail do membro.', names: [] },
  'participants.release.alreadyIn': { text: 'Já inscrito', names: [] },
  'participants.release.row': { text: 'Liberar', names: [] },
  'participants.release.rowAria': { text: 'Liberar presença de {name}', names: ['name'] },
  'participants.release.empty.title': { text: 'Nenhum membro encontrado', names: [] },
  'participants.release.empty.body': { text: 'Tente outro nome ou e-mail.', names: [] },
  'participants.release.error': { text: 'Não foi possível buscar membros.', names: [] },
  'participants.release.confirm.title': { text: 'Liberar presença de {name}?', names: ['name'] },
  'participants.release.confirm.body': {
    text: 'A presença é confirmada agora, sem cobrança. Ela aparece como Cortesia.',
    names: [],
  },
  'participants.release.confirm.confirm': { text: 'Liberar presença', names: [] },
  'participants.release.confirm.cancel': { text: 'Não liberar', names: [] },
  'participants.release.toasts.granted': { text: 'Presença de {name} liberada.', names: ['name'] },
  'participants.release.toasts.ended': { text: 'Este evento já terminou.', names: [] },
  'participants.release.toasts.alreadyIn': {
    text: '{name} já está inscrito neste evento.',
    names: ['name'],
  },
  'participants.release.toasts.generic': { text: 'Algo deu errado. Tente novamente.', names: [] },
};

describe('events.json: Liberar presença (UI-D-755, A-UI-5, A-UI-6)', () => {
  it('carries every key with the approved sentence and its placeholders', () => {
    for (const [key, { text, names }] of Object.entries(RELEASE)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(names);
    }
  });

  it('holds no key under participants.release that the contract does not list', () => {
    const present = Object.keys(all).filter((key) => key.startsWith('participants.release.'));
    expect(present.sort()).toEqual(Object.keys(RELEASE).sort());
  });

  it('fills {name} as a plain value, markup and all, never interpreting it', () => {
    expect(translate('participants.release.confirm.title', { name: '<b>Ana</b>' })).toBe(
      'Liberar presença de <b>Ana</b>?',
    );
    expect(translate('participants.release.toasts.alreadyIn', { name: 'Ana' })).toBe(
      'Ana já está inscrito neste evento.',
    );
  });

  it('answers a cancelled event with the shipped sentence', () => {
    expect(all['errors.cancelled']).toBe('Este evento foi cancelado.');
  });

  it('names the provider nowhere (TICK-20)', () => {
    for (const key of Object.keys(RELEASE)) {
      expect(all[key], `events.${key}`).not.toMatch(/kiwify|gateway|webhook|R\$|pedido/i);
    }
  });
});

/**
 * Phase 10.1-14 (UI-D-757, D-758): the over-limit notice, the manage-card pill and the paid event's
 * Confirmados empty body. The sentence carries TWO ICU plurals, pinned on both branches.
 */
const OVER_LIMIT: Record<string, { text: string; names: string[] }> = {
  'participants.overLimitNote': {
    text: '{confirmed, plural, one {# confirmado} other {# confirmados}} para {capacity, plural, one {# vaga} other {# vagas}}. Pagamentos aprovados depois de lotar confirmam mesmo assim.',
    names: ['capacity', 'confirmed'],
  },
  'manage.overLimit': { text: 'Acima do limite', names: [] },
  'participants.empty.confirmed.bodyPaid': {
    text: 'Quem pagar o ingresso ou receber uma cortesia aparece aqui até fazer check-in.',
    names: [],
  },
};

describe('events.json: Acima do limite and the paid empty body (UI-D-757, D-758)', () => {
  it('carries every key with the approved sentence and its placeholders', () => {
    for (const [key, { text, names }] of Object.entries(OVER_LIMIT)) {
      expect(all[key], `missing key events.${key}`).toBe(text);
      expect(placeholders(all[key] as string), `placeholders of events.${key}`).toEqual(names);
    }
  });

  it.each([
    [1, 1, '1 confirmado para 1 vaga.'],
    [2, 1, '2 confirmados para 1 vaga.'],
    [1, 2, '1 confirmado para 2 vagas.'],
    [51, 50, '51 confirmados para 50 vagas.'],
    [1204, 1200, '1.204 confirmados para 1.200 vagas.'],
  ])(
    'formats %i confirmed for %i spots with the right plural branches',
    (confirmed, capacity, start) => {
      const text = translate('participants.overLimitNote', { confirmed, capacity });
      expect(text.startsWith(start)).toBe(true);
      expect(text.endsWith('Pagamentos aprovados depois de lotar confirmam mesmo assim.')).toBe(
        true,
      );
    },
  );

  it('keeps the shipped Confirmados empty body beside the paid one', () => {
    expect(all['participants.empty.confirmed.body']).toBe(
      'Quem responder Vou aparece aqui até fazer check-in.',
    );
  });

  it('names the provider nowhere (TICK-20)', () => {
    for (const key of Object.keys(OVER_LIMIT)) {
      expect(all[key], `events.${key}`).not.toMatch(/kiwify|gateway|webhook/i);
    }
  });
});

/**
 * Phase 10.1-13 (UI-D-760): the bell row of the paid event, in the `notifications` namespace. Rich text:
 * the lead is a `<b>` tag the renderer fills, the title a plain value.
 */
describe('notifications.json: the Presença confirmada bell row (UI-D-760, D-756)', () => {
  const notifications = messages.notifications as MessageTree;
  const kinds = (notifications.kinds ?? {}) as MessageTree;

  it('carries kinds.ticketConfirmed with the approved sentence and the {event} placeholder', () => {
    expect(kinds.ticketConfirmed).toBe('<b>Presença confirmada</b> em “{event}”.');
    expect(placeholders(kinds.ticketConfirmed as string)).toEqual(['event']);
  });

  it('fills {event} as a plain value, markup and all, never interpreting it', () => {
    const rich = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'notifications' as never,
    }) as unknown as {
      rich: (key: string, values: Record<string, unknown>) => unknown;
    };
    const out = rich.rich('kinds.ticketConfirmed', {
      event: '<script>x</script>',
      b: (chunks: unknown) => ['[', chunks, ']'],
    });
    expect(JSON.stringify(out)).toContain('<script>x</script>');
    expect(JSON.stringify(out)).toContain('Presença confirmada');
  });

  it('never carries an amount, an order reference, an e-mail or the gateway (PR-3, TICK-20)', () => {
    expect(kinds.ticketConfirmed as string).not.toMatch(
      /R\$|pedido|e-mail|gateway|webhook|kiwify|\{(amount|price|order|email)/i,
    );
  });
});

/**
 * Phase 10.1-13 (UI-D-758, UI-D-759): the Pagamentos copy of a ticket delivery, in the `payments`
 * namespace. Admin surface: the provider is reachable only through the `{gateway}` slot.
 */
describe('payments.json: the ticket deliveries and the manual release (UI-D-758, UI-D-759)', () => {
  const payments = messages.payments as MessageTree;
  const flat = leaves(payments);
  const COPY: Record<string, { text: string; names: string[] }> = {
    'events.ticketProduct': { text: 'Ingresso · {event}', names: ['event'] },
    'events.ticketProductGone': { text: 'Ingresso · evento removido', names: [] },
    'states.eventEnded': { text: 'Evento encerrado', names: [] },
    'states.eventCancelled': { text: 'Evento cancelado', names: [] },
    'events.effects.attendanceConfirmed': { text: 'Presença confirmada', names: [] },
    'events.effects.attendanceOverLimit': {
      text: 'Presença confirmada acima do limite',
      names: [],
    },
    'events.effects.attendanceRemoved': { text: 'Presença removida', names: [] },
    'events.effects.attendanceKept': {
      text: 'Presença mantida: o check-in já foi feito',
      names: [],
    },
    'events.effects.ticketNoEffect': { text: 'Sem efeito na presença', names: [] },
    'events.effects.ticketEnded': {
      text: 'Presença não confirmada: o evento já tinha terminado. Reembolse no {gateway} se for o caso.',
      names: ['gateway'],
    },
    'events.effects.ticketCancelled': {
      text: 'Presença não confirmada: o evento foi cancelado. Reembolse no {gateway} se for o caso.',
      names: ['gateway'],
    },
    'events.grantTicketDialog.title': {
      text: 'Confirmar presença de {email} em {event}?',
      names: ['email', 'event'],
    },
    'events.grantTicketDialog.body': {
      text: 'A presença é confirmada agora, como se o pagamento tivesse chegado.',
      names: [],
    },
    'events.grantTicketDialog.confirm': { text: 'Confirmar presença', names: [] },
    'events.grantTicketDialog.cancel': { text: 'Voltar', names: [] },
    'toasts.ticketGranted': {
      text: 'Presença de {email} confirmada em {event}.',
      names: ['email', 'event'],
    },
    'errors.eventEnded': { text: 'Este evento já terminou. Nada foi confirmado.', names: [] },
    'errors.eventCancelled': { text: 'Este evento foi cancelado. Nada foi confirmado.', names: [] },
  };

  it('carries every key with the approved sentence and its placeholders', () => {
    for (const [key, { text, names }] of Object.entries(COPY)) {
      expect(flat[key], `missing key payments.${key}`).toBe(text);
      expect(placeholders(flat[key] as string), `placeholders of payments.${key}`).toEqual(
        [...names].sort(),
      );
    }
  });

  it('fills {gateway}, {email} and {event} as plain values, markup and all', () => {
    const tr = createTranslator({
      locale: 'pt-BR',
      messages,
      namespace: 'payments' as never,
    }) as unknown as (key: string, values?: Record<string, unknown>) => string;
    expect(tr('events.effects.ticketEnded', { gateway: 'Gateway Exemplo' })).toBe(
      'Presença não confirmada: o evento já tinha terminado. Reembolse no Gateway Exemplo se for o caso.',
    );
    expect(
      tr('events.grantTicketDialog.title', { email: 'a@b.test', event: '<b>Encontro</b>' }),
    ).toBe('Confirmar presença de a@b.test em <b>Encontro</b>?');
    expect(tr('toasts.ticketGranted', { email: 'a@b.test', event: 'Encontro' })).toBe(
      'Presença de a@b.test confirmada em Encontro.',
    );
  });

  it('names the provider nowhere: only the {gateway} slot (UI-D-740, TICK-20)', () => {
    for (const [key, text] of Object.entries(flat)) {
      expect(text, `payments.${key}`).not.toMatch(/kiwify/i);
      expect(key, `payments.${key}`).not.toMatch(/kiwify/i);
    }
  });

  it('the grant dialog confirms nothing the toast then contradicts: no amount, order or webhook word', () => {
    for (const key of Object.keys(COPY).filter((k) => k.includes('grantTicketDialog'))) {
      expect(flat[key], `payments.${key}`).not.toMatch(/R\$|pedido|webhook|reembols/i);
    }
  });
});
