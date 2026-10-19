// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EngagementBandsAnswer,
  OwnerEventsReady,
  OwnerPastEventAnswer,
  OwnerUpcomingEventAnswer,
} from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerEvents, OwnerEventsView } from './OwnerEvents';
import { contentId, contentSnapshot } from './owner-content-test-data';

/**
 * The level-4 "Eventos" area on the API answer (08.7-08, D-455, D-460, D-461, UI-D-478, UI-D-481,
 * UI-D-489 c, INSIGHT-11) and the REAL pt-BR catalog: the next events as event cards (Inscritos,
 * Vagas, "Receita" as the "Em breve" pill), attendance per past event with its cover thumbnail,
 * in person against online, who comes by band, "Lista de espera" as an "Em breve" block with its
 * action disabled, and every event row opening its attendee list. No sample value anywhere.
 */

const loaders = vi.hoisted(() => ({
  events: { status: 'error' } as Record<string, unknown>,
  members: { status: 'error' } as Record<string, unknown>,
}));

vi.mock('@/lib/dashboard', () => ({
  getOwnerEvents: async () => loaders.events,
  getOwnerMembers: async () => loaders.members,
}));

const { messages } = await vi.hoisted(async () => {
  const { loadMessages: load } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  // Vitest runs from `apps/web` (the `ParticipantsList.test.tsx` precedent).
  return { messages: load(joinPath(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'dashboard' } as never),
  };
});

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir) as Record<string, unknown>,
  namespace: 'dashboard',
} as never) as unknown as DashboardT;

afterEach(cleanup);

const TZ = 'America/Sao_Paulo';
const NOW = Date.parse('2026-10-18T15:00:00Z');
const NM_TICKET = { measured: false, reason: 'needs_event_tickets' } as const;

function upcoming(
  n: number,
  patch: Partial<OwnerUpcomingEventAnswer> & Pick<OwnerUpcomingEventAnswer, 'title' | 'startsAt'>,
): OwnerUpcomingEventAnswer {
  return {
    id: contentId(n, '55555555-5555-4555-8555'),
    endsAt: patch.startsAt,
    format: 'in_person',
    capacity: null,
    confirmed: 0,
    durationMinutes: 120,
    coverAssetId: null,
    ticketCents: NM_TICKET,
    revenue: NM_TICKET,
    ...patch,
  };
}

function past(
  n: number,
  patch: Partial<OwnerPastEventAnswer> & Pick<OwnerPastEventAnswer, 'title' | 'startsAt'>,
): OwnerPastEventAnswer {
  return {
    id: contentId(n, '66666666-6666-4666-8666'),
    endsAt: patch.startsAt,
    format: 'in_person',
    capacity: null,
    confirmed: 0,
    checkIns: 0,
    walkIns: 0,
    durationMinutes: 120,
    coverAssetId: null,
    ticketCents: NM_TICKET,
    revenue: NM_TICKET,
    ...patch,
  };
}

const ZERO = { new: 0, superfan: 0, engaged: 0, occasional: 0, at_risk: 0, inactive: 0 };

// 19:00 on 24/10, 20:30 on 25/10 and 09:00 on 26/10 in São Paulo (UTC-3).
const U1 = upcoming(1, {
  title: 'Encontro mensal',
  startsAt: '2026-10-24T22:00:00.000000Z',
  capacity: 100,
  confirmed: 92,
});
const U2 = upcoming(2, {
  title: 'Live de dúvidas',
  startsAt: '2026-10-25T23:30:00.000000Z',
  format: 'online',
  capacity: null,
  confirmed: 64,
});
const U3 = upcoming(3, {
  title: 'Imersão presencial',
  startsAt: '2026-10-26T12:00:00.000000Z',
  capacity: 40,
  confirmed: 40,
});
// Encontro: 82 check-ins and 6 walk-ins of 100 confirmed (88 of 106 = 83%), full; Live: 86 of 148.
const P1 = past(1, {
  title: 'Encontro set.',
  startsAt: '2026-10-10T22:00:00.000000Z',
  capacity: 100,
  confirmed: 100,
  checkIns: 82,
  walkIns: 6,
});
const P2 = past(2, {
  title: 'Live de perguntas',
  startsAt: '2026-10-01T23:00:00.000000Z',
  format: 'online',
  confirmed: 148,
  checkIns: 86,
});

const READY: OwnerEventsReady = {
  state: 'ready',
  snapshot: contentSnapshot(NOW),
  upcoming: [U1, U2, U3],
  past: [P1, P2],
  attendanceTotals: {
    current: { confirmed: 248, present: 174, walkIns: 6 },
    previous: { confirmed: 0, present: 0, walkIns: 0 },
  },
  attendanceByBand: { new: 24, superfan: 70, engaged: 94, occasional: 40, at_risk: 6, inactive: 2 },
  waitlist: { measured: false, reason: 'needs_waitlist' },
};

const EMPTY: OwnerEventsReady = {
  ...READY,
  upcoming: [],
  past: [],
  attendanceTotals: {
    current: { confirmed: 0, present: 0, walkIns: 0 },
    previous: { confirmed: 0, present: 0, walkIns: 0 },
  },
  attendanceByBand: ZERO,
};

// 40 of 100 members are superfãs or engajados.
const ENGAGEMENT: EngagementBandsAnswer = {
  counts: { new: 10, superfan: 15, engaged: 25, occasional: 30, at_risk: 10, inactive: 10 },
  newActivated: 4,
};

function view(
  answer: OwnerEventsReady = READY,
  engagement: EngagementBandsAnswer | null = ENGAGEMENT,
) {
  return render(<OwnerEventsView t={t} answer={answer} engagement={engagement} timeZone={TZ} />)
    .container;
}

function exactly(root: Element, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.textContent?.trim() === text);
}

/** The section under the `h3` reading exactly `title`. */
function section(root: Element, title: string): Element {
  const heading = [...root.querySelectorAll('h3')].find((el) => el.textContent?.trim() === title);
  const found = heading?.closest('section');
  if (!found) throw new Error(`no section ${title}`);
  return found;
}

/** A collapsible's `<details>`, by its summary's exact bold title (closed details stay in the DOM). */
function details(root: Element, title: string): Element {
  const found = [...root.querySelectorAll('details')].find(
    (el) => el.querySelector('summary span.font-bold')?.textContent?.trim() === title,
  );
  if (!found) throw new Error(`no details ${title}`);
  return found;
}

/** The dd next to a card's dt `label`. */
function cell(root: Element, label: string): Element | undefined {
  const term = [...root.querySelectorAll('dt')].find((el) => el.textContent?.trim() === label);
  return term?.nextElementSibling ?? undefined;
}

const attendees = (id: string) => `/eventos/${id}/participantes`;

describe('Próximos eventos on the answer (INSIGHT-11, D-461)', () => {
  it('shows each next event as its card: title, format, local date and hour, Inscritos and Vagas', () => {
    const items = [...section(view(), 'Próximos eventos').querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.querySelector('.text-xl')?.textContent?.trim())).toEqual([
      'Encontro mensal',
      'Live de dúvidas',
      'Imersão presencial',
    ]);
    for (const [i, pill] of ['Presencial', 'Online', 'Presencial'].entries()) {
      expect(exactly(items[i] as Element, pill).length, String(i)).toBeGreaterThan(0);
    }
    for (const [i, when] of ['24/10, 19h', '25/10, 20h30', '26/10, 9h'].entries()) {
      expect(exactly(items[i] as Element, when).length, when).toBeGreaterThan(0);
    }
    const [u1, u2, u3] = items;
    if (!u1 || !u2 || !u3) throw new Error('missing cards');
    expect(cell(u1, 'Inscritos')?.textContent?.trim()).toBe('92');
    expect(cell(u1, 'Vagas')?.textContent?.trim()).toBe('8');
    expect(cell(u2, 'Inscritos')?.textContent?.trim()).toBe('64');
    // EP-34: no capacity, no seats-left figure.
    expect(cell(u2, 'Vagas')?.textContent?.trim()).toBe('Sem limite');
    // EP-33: confirmed = capacity is full.
    expect(cell(u3, 'Vagas')?.textContent?.trim()).toBe('Lotado');
  });

  it('reads "Receita" as the Em breve pill, with no price and no "Gratuito" (D-455)', () => {
    const upcomingSection = section(view(), 'Próximos eventos');
    for (const item of upcomingSection.querySelectorAll('li')) {
      expect(cell(item, 'Receita')?.querySelector('[data-coming-soon]')?.textContent).toBe(
        'Em breve',
      );
    }
    expect(upcomingSection.textContent).not.toMatch(/R\$|Gratuito|exemplo/);
  });

  it('opens each event on its attendee list (D-461)', () => {
    const links = [...section(view(), 'Próximos eventos').querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      attendees(U1.id),
      attendees(U2.id),
      attendees(U3.id),
    ]);
  });
});

describe('Lista de espera and its action (D-455, UI-D-478)', () => {
  it('is an Em breve block, and "Ver lista de espera" is disabled with the pill', () => {
    const waiting = section(view(), 'Lista de espera');
    expect(waiting.querySelectorAll('[data-coming-soon-block]')).toHaveLength(1);
    expect(waiting.querySelectorAll('[data-bar-fill]')).toHaveLength(0);
    expect(waiting.querySelectorAll('[data-kpi-card]')).toHaveLength(0);
    const action = waiting.querySelector('[data-disabled-action]');
    const button = action?.querySelector('button');
    expect(button?.textContent?.trim()).toBe('Ver lista de espera');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(action?.querySelector('[data-coming-soon]')?.textContent).toBe('Em breve');
    expect(waiting.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('the closed analyses of the past events (INSIGHT-11, EP-33, EP-36)', () => {
  it('Comparecimento por evento: one bar per past event with its thumbnail, presences of confirmed and walk-ins, opening its attendee list', () => {
    const block = details(view(), 'Comparecimento por evento');
    const items = [...block.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    expect(block.querySelectorAll('[data-event-thumb]')).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Encontro set.');
    expect(items[0]?.textContent).toContain('83%');
    expect(items[0]?.textContent).toContain('88 de 106');
    expect(items[1]?.textContent).toContain('58%');
    expect(items[1]?.textContent).toContain('86 de 148');
    expect([...block.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      attendees(P1.id),
      attendees(P2.id),
    ]);
    expect(block.querySelector('summary')?.textContent).toContain('comparecimento 69%');
  });

  it('Presencial × online: the shipped attendancePercent per format and how many were full', () => {
    const block = details(view(), 'Presencial × online');
    expect(block.querySelector('summary')?.textContent).toContain('presencial 83% · online 58%');
    expect(block.textContent).toContain('1 evento, 1 lotou');
    expect(block.textContent).toContain('1 evento, nenhum lotou');
    expect(block.querySelectorAll('a')).toHaveLength(0);
  });

  it('Quem vai aos eventos: the presences by band of the day before, and the share of the engaged', () => {
    const block = details(view(), 'Quem vai aos eventos');
    expect(block.querySelectorAll('li')).toHaveLength(6);
    expect(block.textContent).toContain('Superfãs');
    expect(block.textContent).toContain('94');
    expect(block.querySelector('summary')?.textContent).toContain(
      '69% das presenças vêm de 40% dos membros (superfãs e engajados).',
    );
  });

  it('drops the sentence, never the bars, when the members answer is not ready', () => {
    const block = details(view(READY, null), 'Quem vai aos eventos');
    expect(block.querySelectorAll('li')).toHaveLength(6);
    expect(block.querySelector('summary')?.textContent).not.toContain('das presenças');
  });
});

describe('UI-D-481: empty data is real data', () => {
  it('shows the four empty sentences in place of every card, bar and chart', () => {
    const container = view(EMPTY);
    for (const [block, sentence] of [
      ['upcoming', 'Nenhum evento agendado.'],
      ['attendance', 'Nenhum evento nos últimos 30 dias.'],
      ['formats', 'Nenhum evento nos últimos 30 dias.'],
      ['who', 'Nenhuma presença em eventos nos últimos 30 dias.'],
    ] as const) {
      expect(container.querySelector(`[data-owner-empty="${block}"]`)?.textContent, block).toBe(
        sentence,
      );
    }
    expect(container.querySelectorAll('[data-bar-fill]')).toHaveLength(0);
    expect(section(container, 'Próximos eventos').querySelectorAll('li')).toHaveLength(0);
    // The waiting list stays "Em breve" whatever the data.
    expect(
      section(container, 'Lista de espera').querySelector('[data-coming-soon-block]'),
    ).not.toBeNull();
  });
});

describe('OwnerEvents reads GET /v1/dashboard/owner/events (D-460, UI-D-469, UI-D-479)', () => {
  beforeEach(() => {
    loaders.members = { status: 'ok', answer: { state: 'ready', engagement: ENGAGEMENT } };
  });

  it('renders nothing when the events module is off (MODULE_DISABLED)', async () => {
    loaders.events = { status: 'disabled' };
    expect(await OwnerEvents({ timeZone: TZ })).toBeNull();
  });

  it('shows the area error card on a failed read, and the preparing card before the first build', async () => {
    loaders.events = { status: 'error' };
    const error = (await OwnerEvents({ timeZone: TZ })) as ReactElement<{ kind: string }>;
    expect(error.type).toBe(OwnerAreaState);
    expect(error.props.kind).toBe('error');
    loaders.events = { status: 'ok', answer: { state: 'preparing' } };
    const preparing = (await OwnerEvents({ timeZone: TZ })) as ReactElement<{ kind: string }>;
    expect(preparing.type).toBe(OwnerAreaState);
    expect(preparing.props.kind).toBe('preparing');
  });

  it('puts the freshness line first, then the area on the answer', async () => {
    loaders.events = { status: 'ok', answer: READY };
    const { container } = render((await OwnerEvents({ timeZone: TZ })) as ReactElement);
    expect(container.firstElementChild?.hasAttribute('data-snapshot-freshness')).toBe(true);
    expect(section(container, 'Próximos eventos').querySelectorAll('li')).toHaveLength(3);
  });
});
