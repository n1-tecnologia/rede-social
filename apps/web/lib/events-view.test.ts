import { fileURLToPath } from 'node:url';
import type { EventDetail, EventSummary } from '@tria/module-events/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  eventActionState,
  eventCountLine,
  eventDetailView,
  eventPhase,
  eventPill,
  eventPosterView,
  eventWhenLine,
  formatEventDate,
  formatEventTime,
  mapsHref,
  tenantDayKey,
  tenantZoneLabel,
} from './events-view';

/**
 * UI-D-203 — the ONE events formatter, under a fixed clock and a fixed timezone. Every instant below
 * is a literal, and every `nowMs` is passed in: the module reads no clock, which is what makes these
 * assertions deterministic and what keeps client renders clock-free.
 *
 * The strings come from the REAL catalog through next-intl's own translator, so a copy change in
 * `messages/pt-BR/events.json` and a formatter change are both caught here.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
  namespace: 'events',
}) as unknown as Parameters<typeof eventPosterView>[1]['t'];

const SP = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';
const at = (iso: string) => Date.parse(iso);

function event(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Encontro anual',
    format: 'in_person',
    venueName: 'Auditório da sede',
    coverAssetId: null,
    coverVariantWidths: [],
    startsAt: '2026-10-12T22:00:00.000000Z',
    endsAt: '2026-10-13T00:00:00.000000Z',
    status: 'active',
    viewerStatus: null,
    viewerCheckedInAt: null,
    confirmedCount: 0,
    presentCount: 0,
    ...overrides,
  };
}

describe('formatEventDate / formatEventTime — pinned to the tenant zone', () => {
  it('1. 2026-10-12T22:00Z in São Paulo is "seg., 12 de out." at "19:00"', () => {
    // 2026-10-12 is a Monday: the weekday is Intl's, never a hand-kept table.
    expect(formatEventDate('2026-10-12T22:00:00.000000Z', SP, at('2026-09-27T12:00:00Z'))).toBe(
      'seg., 12 de out.',
    );
    expect(formatEventTime('2026-10-12T22:00:00.000000Z', SP)).toBe('19:00');
  });

  it('2. the year is appended only when it is not the tenant-local current year', () => {
    expect(formatEventDate('2027-10-12T22:00:00.000000Z', SP, at('2026-09-27T12:00:00Z'))).toBe(
      'ter., 12 de out. de 2027',
    );
    // 31 Dec 2026 23:30 in São Paulo is already 2027 in UTC: the TENANT's year decides.
    expect(formatEventDate('2027-01-01T02:30:00.000000Z', SP, at('2026-12-31T12:00:00Z'))).toBe(
      'qui., 31 de dez.',
    );
  });

  it('3. the same instant in Manaus renders one hour earlier', () => {
    expect(formatEventTime('2026-10-12T22:00:00.000000Z', MANAUS)).toBe('18:00');
    expect(tenantDayKey('2026-10-13T03:30:00.000000Z', SP)).toBe('2026-10-13');
    expect(tenantDayKey('2026-10-13T03:30:00.000000Z', MANAUS)).toBe('2026-10-12');
  });
});

describe('eventPhase — the D-209 boundaries, exactly', () => {
  const start = '2026-10-12T22:00:00.000000Z';
  const end = '2026-10-13T00:00:00.000000Z';

  it('4. P0 before starts_at − 60 min, P1 from it, P2 from starts_at, P3 from ends_at', () => {
    expect(eventPhase(start, end, at('2026-10-12T20:59:59.999Z'))).toBe('P0');
    expect(eventPhase(start, end, at('2026-10-12T21:00:00.000Z'))).toBe('P1');
    expect(eventPhase(start, end, at('2026-10-12T21:59:59.999Z'))).toBe('P1');
    expect(eventPhase(start, end, at('2026-10-12T22:00:00.000Z'))).toBe('P2');
    expect(eventPhase(start, end, at('2026-10-12T23:59:59.999Z'))).toBe('P2');
    expect(eventPhase(start, end, at('2026-10-13T00:00:00.000Z'))).toBe('P3');
  });
});

describe('eventPill — tenant-local calendar days, cancelled first', () => {
  it('5. "Hoje", "Amanhã" and "Em 2 dias" across a UTC-midnight boundary', () => {
    // 20:30 on 12 Oct in São Paulo, already 13 Oct in UTC.
    const now = at('2026-10-12T23:30:00Z');
    // 23:30 local on the 12th — the 13th in UTC, and still TODAY for the tenant.
    const tonight = event({
      startsAt: '2026-10-13T02:30:00.000000Z',
      endsAt: '2026-10-13T04:00:00.000000Z',
    });
    expect(eventPill(tonight, SP, now, t)).toEqual({ kind: 'relative', label: 'Hoje' });
    const tomorrow = event({
      startsAt: '2026-10-13T12:00:00.000000Z',
      endsAt: '2026-10-13T14:00:00.000000Z',
    });
    expect(eventPill(tomorrow, SP, now, t)).toEqual({ kind: 'relative', label: 'Amanhã' });
    const inTwo = event({
      startsAt: '2026-10-14T12:00:00.000000Z',
      endsAt: '2026-10-14T14:00:00.000000Z',
    });
    expect(eventPill(inTwo, SP, now, t)).toEqual({ kind: 'relative', label: 'Em 2 dias' });
  });

  it('6. in progress is "Agora", ended is "Encerrado"', () => {
    const now = at('2026-10-12T23:00:00Z');
    expect(eventPill(event(), SP, now, t)).toEqual({ kind: 'relative', label: 'Agora' });
    expect(eventPill(event(), SP, at('2026-10-13T00:00:00Z'), t)).toEqual({
      kind: 'relative',
      label: 'Encerrado',
    });
  });

  it('7. cancelled wins over every relative label, before, during and after', () => {
    const cancelled = event({ status: 'cancelled' });
    for (const now of ['2026-10-10T12:00:00Z', '2026-10-12T23:00:00Z', '2026-10-20T12:00:00Z']) {
      expect(eventPill(cancelled, SP, at(now), t)).toEqual({
        kind: 'cancelled',
        label: 'Cancelado',
      });
    }
  });
});

describe('eventWhenLine — single day, multi-day and live', () => {
  const now = at('2026-10-01T12:00:00Z');

  it('8. a single-day event reads "{date} · {time}"', () => {
    expect(eventWhenLine(event(), SP, now, t)).toEqual({
      text: 'seg., 12 de out. · 19:00',
      live: false,
    });
  });

  it('9. a multi-day event reads "12 a 14 de out.", and across months "30 de out. a 2 de nov."', () => {
    const sameMonth = event({
      startsAt: '2026-10-12T22:00:00.000000Z',
      endsAt: '2026-10-14T21:00:00.000000Z',
    });
    expect(eventWhenLine(sameMonth, SP, now, t).text).toBe('12 a 14 de out.');
    const crossMonth = event({
      startsAt: '2026-10-30T22:00:00.000000Z',
      endsAt: '2026-11-02T21:00:00.000000Z',
    });
    expect(eventWhenLine(crossMonth, SP, now, t).text).toBe('30 de out. a 2 de nov.');
  });

  it('10. in progress reads "Acontecendo agora · até {time}", but never for a cancelled event', () => {
    const live = at('2026-10-12T23:00:00Z');
    expect(eventWhenLine(event(), SP, live, t)).toEqual({
      text: 'Acontecendo agora · até 21:00',
      live: true,
    });
    expect(eventWhenLine(event({ status: 'cancelled' }), SP, live, t).live).toBe(false);
  });
});

describe('eventPosterView — the finished strings a poster renders', () => {
  it('11. composes href, aria-label, alt, place and grayscale from one request instant', () => {
    const view = eventPosterView(event(), { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t });
    expect(view.href).toBe('/eventos/11111111-1111-4111-8111-111111111111');
    expect(view.overline).toBe('seg., 12 de out. · 19:00');
    expect(view.ariaLabel).toBe('Encontro anual, seg., 12 de out. · 19:00');
    expect(view.coverAlt).toBe('Capa do evento Encontro anual');
    expect(view.place).toBe('Auditório da sede');
    expect(view.placeKind).toBe('venue');
    expect(view.grayscale).toBe(false);

    const online = eventPosterView(
      event({ format: 'online', venueName: null, status: 'cancelled' }),
      {
        tz: SP,
        nowMs: at('2026-10-01T12:00:00Z'),
        t,
      },
    );
    expect(online.place).toBe('Online');
    expect(online.placeKind).toBe('online');
    expect(online.grayscale).toBe(true);
    expect(online.pill).toEqual({ kind: 'cancelled', label: 'Cancelado' });
  });
});

/** A detail payload: the summary plus the three detail-only keys. */
function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    ...event(),
    description: 'Uma descrição.',
    address: 'Rua das Flores, 100',
    viewerRespondedAt: null,
    ...overrides,
  };
}

describe('06-03 — the viewer pills and the count line', () => {
  const before = at('2026-10-01T12:00:00Z');
  const after = at('2026-10-20T12:00:00Z');

  it('12. priority: Cancelado → Presente → Você vai → relative date', () => {
    const going = event({ viewerStatus: 'going' });
    expect(eventPill(going, SP, before, t)).toEqual({ kind: 'going', label: 'Você vai' });
    // A Vou on a PAST event is no longer "Você vai": the relative label takes over.
    expect(eventPill(going, SP, after, t)).toEqual({ kind: 'relative', label: 'Encerrado' });
    // A checked-in viewer on a past event is "Presente" (walk-ins too: the instant decides).
    const present = event({
      viewerStatus: 'checked_in',
      viewerCheckedInAt: '2026-10-12T21:30:00.000000Z',
    });
    expect(eventPill(present, SP, after, t)).toEqual({ kind: 'present', label: 'Presente' });
    const walkIn = event({
      viewerStatus: 'walk_in',
      viewerCheckedInAt: '2026-10-12T21:30:00.000000Z',
    });
    expect(eventPill(walkIn, SP, after, t).kind).toBe('present');
    // Cancelled wins over both.
    expect(eventPill({ ...present, status: 'cancelled' }, SP, after, t).kind).toBe('cancelled');
    expect(eventPill({ ...going, status: 'cancelled' }, SP, before, t).kind).toBe('cancelled');
    // Não vou is not a state pill.
    expect(eventPill(event({ viewerStatus: 'not_going' }), SP, before, t).kind).toBe('relative');
  });

  it('13. the count line: confirmados while upcoming, presentes once past, none when cancelled', () => {
    const counted = event({ confirmedCount: 1204, presentCount: 1 });
    expect(eventCountLine(counted, before, t)).toBe('1.204 confirmados');
    expect(eventCountLine(counted, after, t)).toBe('1 presente');
    expect(eventCountLine(event(), before, t)).toBe('Ninguém confirmou ainda');
    expect(eventCountLine(event(), after, t)).toBe('Ninguém fez check-in');
    expect(eventCountLine(event({ confirmedCount: 1 }), before, t)).toBe('1 confirmado');
    expect(eventCountLine(event({ status: 'cancelled', confirmedCount: 3 }), before, t)).toBe(
      undefined,
    );
    const poster = eventPosterView(event({ status: 'cancelled' }), { tz: SP, nowMs: before, t });
    expect('meta' in poster).toBe(false);
  });
});

describe('06-03 — eventDetailView (UI-D-204)', () => {
  it('14. the hero overline: countdown, Amanhã, É hoje!, live, Aconteceu em, cancelled', () => {
    const view = (nowIso: string, overrides: Partial<EventDetail> = {}) =>
      eventDetailView(detail(overrides), { tz: SP, nowMs: at(nowIso), t }).hero.overline;
    expect(view('2026-10-01T12:00:00Z')).toBe('Faltam 11 dias · seg., 12 de out.');
    expect(view('2026-10-10T12:00:00Z')).toBe('Faltam 2 dias · seg., 12 de out.');
    expect(view('2026-10-11T12:00:00Z')).toBe('Amanhã · 19:00');
    expect(view('2026-10-12T12:00:00Z')).toBe('É hoje! · 19:00');
    expect(view('2026-10-12T23:00:00Z')).toBe('Acontecendo agora');
    expect(view('2026-10-20T12:00:00Z')).toBe('Aconteceu em seg., 12 de out.');
    expect(view('2026-10-01T12:00:00Z', { status: 'cancelled' })).toBe('seg., 12 de out. · 19:00');
  });

  it('15. the header pill and the banners, by the same priority', () => {
    const now = { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t };
    expect(eventDetailView(detail({ viewerStatus: 'going' }), now).headerPill).toEqual({
      tone: 'brand',
      label: 'Você vai',
    });
    const cancelled = eventDetailView(detail({ status: 'cancelled', viewerStatus: 'going' }), now);
    expect(cancelled.headerPill).toEqual({ tone: 'danger', label: 'Cancelado' });
    expect(cancelled.banner).toEqual({
      kind: 'cancelled',
      title: 'Evento cancelado',
      body: 'A organização cancelou este evento. A confirmação e o check-in estão desativados.',
    });
    expect(eventDetailView(detail(), now).headerPill).toBeNull();
    expect(eventDetailView(detail(), now).banner).toBeNull();

    // Checked in, read later that evening (same tenant day) and a week later (another day).
    const checkedIn = detail({
      viewerStatus: 'checked_in',
      viewerCheckedInAt: '2026-10-12T21:40:00.000000Z',
    });
    const sameDay = eventDetailView(checkedIn, { tz: SP, nowMs: at('2026-10-12T23:00:00Z'), t });
    expect(sameDay.headerPill).toEqual({ tone: 'success', label: 'Presente' });
    expect(sameDay.banner).toEqual({
      kind: 'checkedIn',
      title: 'Check-in confirmado',
      body: 'Realizado às 18:40',
    });
    const later = eventDetailView(checkedIn, { tz: SP, nowMs: at('2026-10-20T12:00:00Z'), t });
    expect(later.banner?.body).toBe('Realizado em seg., 12 de out., às 18:40');
  });

  it('16. the info grid: same day, multi-day, online, and Presentes once past', () => {
    const upcoming = eventDetailView(detail({ confirmedCount: 3 }), {
      tz: SP,
      nowMs: at('2026-10-01T12:00:00Z'),
      t,
    });
    expect(upcoming.info).toEqual([
      { icon: 'date', label: 'Data', value: 'seg., 12 de out.' },
      { icon: 'time', label: 'Horário', value: '19:00 às 21:00' },
      { icon: 'place', label: 'Local', value: 'Auditório da sede' },
      { icon: 'people', label: 'Confirmados', value: '3 confirmados' },
    ]);
    expect(upcoming.countIndex).toBe(3);

    const multiDay = eventDetailView(
      detail({ startsAt: '2026-10-12T22:00:00.000000Z', endsAt: '2026-10-14T21:00:00.000000Z' }),
      { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t },
    );
    expect(multiDay.info[0]?.value).toBe('12 a 14 de out.');
    expect(multiDay.info[1]?.value).toBe('Começa 19:00 · termina 18:00');

    const past = eventDetailView(detail({ presentCount: 2, confirmedCount: 5 }), {
      tz: SP,
      nowMs: at('2026-10-20T12:00:00Z'),
      t,
    });
    expect(past.info[3]).toEqual({ icon: 'people', label: 'Presentes', value: '2 presentes' });
    expect(past.phase).toBe('P3');

    const online = eventDetailView(detail({ format: 'online', venueName: null, address: null }), {
      tz: SP,
      nowMs: at('2026-10-01T12:00:00Z'),
      t,
    });
    expect(online.info[2]).toEqual({ icon: 'online', label: 'Local', value: 'Online' });
    expect(online.location).toBeNull();
    expect(online.hero.placeKind).toBe('online');
  });

  it('17. the tenant wall clock: the same event read with a Manaus tenant zone is an hour earlier', () => {
    const view = eventDetailView(detail(), { tz: MANAUS, nowMs: at('2026-10-01T12:00:00Z'), t });
    expect(view.info[1]?.value).toBe('18:00 às 20:00');
  });

  it('18. the in-person location and the instants the client refreshes at', () => {
    const view = eventDetailView(detail(), { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t });
    expect(view.location).toEqual({
      venue: 'Auditório da sede',
      address: 'Rua das Flores, 100',
      href: mapsHref('Auditório da sede', 'Rua das Flores, 100'),
      label: 'Abrir no Maps',
      ariaLabel: 'Abrir Auditório da sede no aplicativo de mapas',
    });
    expect(view.checkinOpensAt).toBe('2026-10-12T21:00:00.000Z');
    expect(view.startsAt).toBe('2026-10-12T22:00:00.000000Z');
    expect(view.endsAt).toBe('2026-10-13T00:00:00.000000Z');
  });
});

describe('06-03 — mapsHref (D-203)', () => {
  it('19. the universal search URL, with accents, commas and line breaks encoded', () => {
    const href = mapsHref('Auditório da sede', 'Rua São João, 100\nCentro');
    expect(href.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true);
    const query = href.slice(href.indexOf('query=') + 'query='.length);
    expect(query).toBe(
      'Audit%C3%B3rio%20da%20sede%2C%20Rua%20S%C3%A3o%20Jo%C3%A3o%2C%20100%0ACentro',
    );
    expect(decodeURIComponent(query)).toBe('Auditório da sede, Rua São João, 100\nCentro');
  });
});

describe("06-03 — eventActionState (UI-D-207, the island's props)", () => {
  it('20. the recorded answer, the check-in flag, the server phase and the three boundaries', () => {
    const state = (nowIso: string, overrides: Partial<EventDetail> = {}) => {
      const d = detail(overrides);
      return eventActionState(d, eventDetailView(d, { tz: SP, nowMs: at(nowIso), t }));
    };
    expect(state('2026-10-01T12:00:00Z', { viewerStatus: 'going' })).toEqual({
      eventId: '11111111-1111-4111-8111-111111111111',
      phase: 'P0',
      format: 'in_person',
      cancelled: false,
      answer: 'going',
      checkedIn: false,
      checkinOpensAt: '2026-10-12T21:00:00.000Z',
      startsAt: '2026-10-12T22:00:00.000000Z',
      endsAt: '2026-10-13T00:00:00.000000Z',
    });
    expect(state('2026-10-12T21:30:00Z', { viewerStatus: 'not_going' })).toMatchObject({
      phase: 'P1',
      answer: 'not_going',
    });
    expect(state('2026-10-12T23:00:00Z')).toMatchObject({ phase: 'P2', answer: null });
    // A check-in is NOT an answer: the zone shows the banner instead of any RSVP row.
    expect(
      state('2026-10-12T23:00:00Z', {
        viewerStatus: 'checked_in',
        viewerCheckedInAt: '2026-10-12T21:40:00.000000Z',
      }),
    ).toMatchObject({ phase: 'P2', answer: null, checkedIn: true });
    expect(
      state('2026-10-20T12:00:00Z', {
        viewerStatus: 'walk_in',
        viewerCheckedInAt: '2026-10-12T22:10:00.000000Z',
      }),
    ).toMatchObject({ phase: 'P3', answer: null, checkedIn: true });
    expect(
      state('2026-10-01T12:00:00Z', { status: 'cancelled', viewerStatus: 'going' }),
    ).toMatchObject({ cancelled: true, answer: 'going' });
    expect(state('2026-10-01T12:00:00Z', { format: 'online', venueName: null })).toMatchObject({
      format: 'online',
    });
  });
});

describe('tenantZoneLabel — the form helper names the TENANT zone (06-04, UI-D-212)', () => {
  it('21. São Paulo reads "Horário Padrão de Brasília", Manaus its own zone, and a bad id falls back', () => {
    expect(tenantZoneLabel('America/Sao_Paulo')).toBe('Horário Padrão de Brasília');
    expect(tenantZoneLabel('America/Manaus')).toBe('Horário Padrão do Amazonas');
    expect(tenantZoneLabel('Not/AZone')).toBe('Not/AZone');
  });
});
