import { fileURLToPath } from 'node:url';
import type { Attendee, EventDetail, EventSummary } from '@rede-social/module-events/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import { composeEventDescription } from './event-extras';
import {
  ATTENDANCE_LIST_PARAMS,
  attendanceListFromParam,
  attendeeView,
  checkedInLine,
  EVENT_LOW_SPOTS,
  eventActionState,
  eventCardBadge,
  eventCardNote,
  eventCardView,
  eventDateBadge,
  eventDetailView,
  eventHours,
  eventMapView,
  eventPhase,
  eventSectionsView,
  eventTicketView,
  eventWhenLine,
  exampleTicketCode,
  formatEventDate,
  formatEventTime,
  mapsHref,
  participantsHref,
  spelledCode,
  splitEventSections,
  spotsLeft,
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
}) as unknown as Parameters<typeof eventCardView>[1]['t'];

const SP = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';
const at = (iso: string) => Date.parse(iso);

function event(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Encontro anual',
    format: 'in_person',
    category: null,
    capacity: null,
    venueName: 'Auditório da sede',
    address: null,
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

describe('eventCardBadge — the gallery pill (2026-10-03, the REINE poster)', () => {
  const before = at('2026-10-01T12:00:00Z');
  const live = at('2026-10-12T23:00:00Z');
  const after = at('2026-10-20T12:00:00Z');
  const going = event({ viewerStatus: 'going' });
  const present = event({
    viewerStatus: 'checked_in',
    viewerCheckedInAt: '2026-10-12T21:30:00.000000Z',
  });

  it('5. an event to come shows its date, "12 OUT", on the tenant calendar', () => {
    expect(eventCardBadge(event(), SP, before, t)).toEqual({ kind: 'date', label: '12 OUT' });
    // 23:30 to 23:59 local on the 12th is the 13th in UTC: the TENANT's day is printed.
    const late = event({
      startsAt: '2026-10-13T02:30:00.000000Z',
      endsAt: '2026-10-13T02:59:00.000000Z',
    });
    expect(eventCardBadge(late, SP, before, t).label).toBe('12 OUT');
    expect(eventCardBadge(late, 'UTC', before, t).label).toBe('13 OUT');
    // Past local midnight it spans two days of the month.
    const overnight = { ...late, endsAt: '2026-10-13T04:00:00.000000Z' };
    expect(eventCardBadge(overnight, SP, before, t).label).toBe('12-13 OUT');
  });

  it('6. days of one month read "12-14 OUT", across two months the start alone, every month in capitals', () => {
    const sameMonth = event({
      startsAt: '2026-10-12T22:00:00.000000Z',
      endsAt: '2026-10-14T21:00:00.000000Z',
    });
    expect(eventDateBadge(sameMonth, SP, t)).toBe('12-14 OUT');
    const crossMonth = event({
      startsAt: '2026-10-30T22:00:00.000000Z',
      endsAt: '2026-11-02T21:00:00.000000Z',
    });
    expect(eventDateBadge(crossMonth, SP, t)).toBe('30 OUT');
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const day = event({
        startsAt: `2026-${month}-15T15:00:00.000000Z`,
        endsAt: `2026-${month}-15T17:00:00.000000Z`,
      });
      return eventDateBadge(day, SP, t);
    });
    expect(months).toEqual([
      '15 JAN',
      '15 FEV',
      '15 MAR',
      '15 ABR',
      '15 MAI',
      '15 JUN',
      '15 JUL',
      '15 AGO',
      '15 SET',
      '15 OUT',
      '15 NOV',
      '15 DEZ',
    ]);
  });

  it('7. priority: Cancelado → Participou or Encerrado → Inscrito → Agora → the date', () => {
    expect(eventCardBadge(going, SP, before, t)).toEqual({ kind: 'registered', label: 'Inscrito' });
    expect(eventCardBadge(going, SP, live, t).kind).toBe('registered');
    expect(eventCardBadge(present, SP, live, t).kind).toBe('registered');
    // Once ended: a check-in (a walk-in too) took part, a Vou alone did not.
    expect(eventCardBadge(present, SP, after, t)).toEqual({
      kind: 'participated',
      label: 'Participou',
    });
    expect(eventCardBadge({ ...present, viewerStatus: 'walk_in' }, SP, after, t).kind).toBe(
      'participated',
    );
    expect(eventCardBadge(going, SP, after, t)).toEqual({ kind: 'ended', label: 'Encerrado' });
    // Not the viewer's: "Agora" while it runs, the date before; Não vou is not the viewer's.
    expect(eventCardBadge(event(), SP, live, t)).toEqual({ kind: 'live', label: 'Agora' });
    expect(eventCardBadge(event({ viewerStatus: 'not_going' }), SP, before, t).kind).toBe('date');
    // Cancelled wins over everything, before, during and after.
    for (const now of [before, live, after]) {
      expect(eventCardBadge({ ...present, status: 'cancelled' }, SP, now, t)).toEqual({
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

describe('eventCardNote — the countdown on the viewer’s own events', () => {
  it('11. "É hoje!", "Falta 1 dia", "Faltam N dias" in tenant days, "Acontecendo agora" while it runs', () => {
    // 20:30 on 12 Oct in São Paulo, already 13 Oct in UTC.
    const evening = at('2026-10-12T23:30:00Z');
    // 23:30 local on the 12th: the 13th in UTC, and still TODAY for the tenant.
    const tonight = event({
      viewerStatus: 'going',
      startsAt: '2026-10-13T02:30:00.000000Z',
      endsAt: '2026-10-13T04:00:00.000000Z',
    });
    expect(eventCardNote(tonight, SP, evening, t)).toBe('É hoje!');
    const tomorrow = {
      ...tonight,
      startsAt: '2026-10-13T12:00:00.000000Z',
      endsAt: '2026-10-13T14:00:00.000000Z',
    };
    expect(eventCardNote(tomorrow, SP, evening, t)).toBe('Falta 1 dia');
    const inFour = {
      ...tonight,
      startsAt: '2026-10-16T12:00:00.000000Z',
      endsAt: '2026-10-16T14:00:00.000000Z',
    };
    expect(eventCardNote(inFour, SP, evening, t)).toBe('Faltam 4 dias');
    const going = event({ viewerStatus: 'going' });
    expect(eventCardNote(going, SP, at('2026-10-12T23:00:00Z'), t)).toBe('Acontecendo agora');

    // None once ended, on a cancelled event, or on an event that is not the viewer's.
    const before = at('2026-10-01T12:00:00Z');
    expect(eventCardNote(going, SP, at('2026-10-20T12:00:00Z'), t)).toBeUndefined();
    expect(eventCardNote({ ...going, status: 'cancelled' }, SP, before, t)).toBeUndefined();
    expect(eventCardNote(event(), SP, before, t)).toBeUndefined();
    expect(eventCardNote(event({ viewerStatus: 'not_going' }), SP, before, t)).toBeUndefined();
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

describe('the two galleries — "Meus eventos" and "Outros eventos"', () => {
  const before = at('2026-10-01T12:00:00Z');
  const checkedIn = '2026-09-20T21:30:00.000000Z';

  it('12. mine: the viewer’s events to come, then the ended ones they checked in to; others: the rest, in the API order', () => {
    const going = event({ id: 'going', viewerStatus: 'going' });
    const open = event({ id: 'open' });
    const here = event({ id: 'here', viewerStatus: 'checked_in', viewerCheckedInAt: checkedIn });
    const declined = event({ id: 'declined', viewerStatus: 'not_going' });
    // A cancelled event the viewer was going to stays theirs: its pill says it was cancelled.
    const called = event({ id: 'called-off', viewerStatus: 'going', status: 'cancelled' });
    const attended = event({
      id: 'attended',
      startsAt: '2026-09-20T21:00:00.000000Z',
      endsAt: '2026-09-20T23:00:00.000000Z',
      viewerStatus: 'walk_in',
      viewerCheckedInAt: checkedIn,
    });
    const missed = event({ id: 'missed', viewerStatus: 'going' });
    const pastOpen = event({ id: 'past-open' });

    const { mine, others } = splitEventSections(
      [going, open, here, declined, called],
      [attended, missed, pastOpen],
    );
    expect(mine.map((item) => item.id)).toEqual(['going', 'here', 'called-off', 'attended']);
    expect(others.map((item) => item.id)).toEqual(['open', 'declined', 'missed', 'past-open']);

    const views = eventSectionsView(
      { upcoming: [going, open], past: [attended] },
      { tz: SP, nowMs: before, t },
    );
    expect(views.mine.map((card) => card.badge.kind)).toEqual(['registered', 'participated']);
    expect(views.others.map((card) => card.badge)).toEqual([{ kind: 'date', label: '12 OUT' }]);
  });

  it('13. a card composes href, name, alt, category, place, pill, note and grayscale from one instant', () => {
    const view = eventCardView(event(), { tz: SP, nowMs: before, t });
    expect(view.href).toBe('/eventos/11111111-1111-4111-8111-111111111111');
    expect(view.category).toBe('Evento presencial');
    expect(view.place).toBe('Auditório da sede');
    expect(view.placeKind).toBe('venue');
    expect(view.badge).toEqual({ kind: 'date', label: '12 OUT' });
    expect('note' in view).toBe(false);
    // The card prints no full date: its name carries it, and a date pill is not repeated.
    expect(view.ariaLabel).toBe('Encontro anual, seg., 12 de out. · 19:00');
    expect(view.coverAlt).toBe('Capa do evento Encontro anual');
    expect(view.grayscale).toBe(false);

    const mine = eventCardView(event({ viewerStatus: 'going' }), { tz: SP, nowMs: before, t });
    expect(mine.badge.label).toBe('Inscrito');
    expect(mine.note).toBe('Faltam 11 dias');
    expect(mine.ariaLabel).toBe(
      'Encontro anual, seg., 12 de out. · 19:00, Inscrito, Faltam 11 dias',
    );

    // In progress the when-line already says it: neither "Agora" nor the note is repeated.
    const live = at('2026-10-12T23:00:00Z');
    expect(eventCardView(event(), { tz: SP, nowMs: live, t }).ariaLabel).toBe(
      'Encontro anual, Acontecendo agora · até 21:00',
    );
    expect(
      eventCardView(event({ viewerStatus: 'going' }), { tz: SP, nowMs: live, t }).ariaLabel,
    ).toBe('Encontro anual, Acontecendo agora · até 21:00, Inscrito');

    const online = eventCardView(
      event({ format: 'online', venueName: null, status: 'cancelled' }),
      { tz: SP, nowMs: before, t },
    );
    expect(online.category).toBe('Evento online');
    expect(online.place).toBe('Online');
    expect(online.placeKind).toBe('online');
    expect(online.grayscale).toBe(true);
    expect(online.badge).toEqual({ kind: 'cancelled', label: 'Cancelado' });
    expect(online.ariaLabel).toBe('Encontro anual, seg., 12 de out. · 19:00, Cancelado');
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
      tone: 'success',
      label: 'Inscrito',
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

  it('37. PDF item #10: a composed address searches its canonical form alone, without the venue', () => {
    const stored =
      'Avenida Paulista, 1578\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200';
    const href = mapsHref('Auditório da sede', stored);
    const query = href.slice(href.indexOf('query=') + 'query='.length);
    expect(decodeURIComponent(query)).toBe(
      'Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200',
    );

    // The detail prints the block as stored; only the link searches the canonical line.
    const view = eventDetailView(detail({ address: stored }), {
      tz: SP,
      nowMs: at('2026-10-01T12:00:00Z'),
      t,
    });
    expect(view.location?.address).toBe(stored);
    expect(view.location?.href).toBe(href);
  });

  it('38. a near miss of the format is legacy text, searched with the venue in front as before', () => {
    const nearMiss = 'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\n01310-200';
    const href = mapsHref('Auditório da sede', nearMiss);
    expect(href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Auditório da sede, ${nearMiss}`)}`,
    );
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
      // 2026-10-03: no limit, so never full.
      full: false,
      answer: 'going',
      checkedIn: false,
      checkinOpensAt: '2026-10-12T21:00:00.000Z',
      startsAt: '2026-10-12T22:00:00.000000Z',
      endsAt: '2026-10-13T00:00:00.000000Z',
      // 06-06: the start in the TENANT's zone (22:00Z is 19:00 in São Paulo), for the online P0 hint.
      startTime: '19:00',
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

describe('06-05 — eventTicketView (UI-D-208, the check-in boarding pass)', () => {
  const ticket = (nowIso: string, overrides: Partial<EventDetail> = {}, tz = SP) =>
    eventTicketView(detail(overrides), { tz, nowMs: at(nowIso), t });

  it('22. the not-open-yet {when}: "às 18:00" on the same tenant-local day, "em {date}, às 18:00" on another', () => {
    // The event starts 19:00 in São Paulo (22:00Z), so the window opens at 18:00 there.
    expect(ticket('2026-10-12T15:00:00Z').section).toEqual({
      kind: 'notOpenYet',
      sentence: 'O check-in abre 1 hora antes do início, às 18:00.',
    });
    expect(ticket('2026-10-10T12:00:00Z').section).toEqual({
      kind: 'notOpenYet',
      sentence: 'O check-in abre 1 hora antes do início, em seg., 12 de out., às 18:00.',
    });
    // Tenant-local days, not UTC ones: 23:30 in São Paulo on the 11th is already the 12th in UTC,
    // and it is still "another day" for the tenant.
    expect(ticket('2026-10-12T02:30:00Z').section).toMatchObject({
      sentence: 'O check-in abre 1 hora antes do início, em seg., 12 de out., às 18:00.',
    });
    // A Manaus tenant reads its own wall clock (one hour earlier).
    expect(ticket('2026-10-12T15:00:00Z', {}, MANAUS).section).toMatchObject({
      sentence: 'O check-in abre 1 hora antes do início, às 17:00.',
    });
  });

  it('23. the section precedence: done, cancelled, closed from ends_at, open inside the window', () => {
    expect(ticket('2026-10-12T21:00:00Z').section).toEqual({ kind: 'open' });
    expect(ticket('2026-10-12T23:59:59Z').section).toEqual({ kind: 'open' });
    expect(ticket('2026-10-13T00:00:00Z').section).toEqual({
      kind: 'closed',
      sentence: 'O check-in deste evento foi encerrado.',
    });
    expect(ticket('2026-10-12T21:30:00Z', { status: 'cancelled' }).section).toEqual({
      kind: 'cancelled',
      sentence: 'Este evento foi cancelado.',
    });
    // Present beats every other state, a walk-in included, even if the event was cancelled later.
    expect(
      ticket('2026-10-12T22:30:00Z', {
        status: 'cancelled',
        viewerStatus: 'walk_in',
        viewerCheckedInAt: '2026-10-12T21:42:00.000000Z',
      }).section,
    ).toEqual({ kind: 'done', doneLine: 'Realizado às 18:42' });
  });

  it('24. the cover overline carries the weekday; the Data cell drops it so it fits a third of the ticket', () => {
    const view = ticket('2026-10-12T21:30:00Z');
    expect(view.overline).toBe('seg., 12 de out.');
    expect(view.place).toBe('Auditório da sede');
    expect(view.cells).toEqual([
      { icon: 'date', label: 'Data', value: '12 de out.' },
      { icon: 'time', label: 'Horário', value: '19:00' },
      { icon: 'place', label: 'Local', value: 'Auditório da sede' },
    ]);
    // A multi-day event prints its range in the Data cell.
    const multi = ticket('2026-10-12T21:30:00Z', { endsAt: '2026-10-14T21:00:00.000000Z' });
    expect(multi.cells[0]?.value).toBe('12 a 14 de out.');
    expect(view.coverAlt).toBe('Capa do evento Encontro anual');
  });

  it('25. checkedInLine: "Realizado às" today, "Realizado em {date}, às" on another tenant-local day', () => {
    expect(checkedInLine('2026-10-12T21:42:00.000000Z', SP, at('2026-10-12T23:00:00Z'), t)).toBe(
      'Realizado às 18:42',
    );
    expect(checkedInLine('2026-10-12T21:42:00.000000Z', SP, at('2026-10-14T12:00:00Z'), t)).toBe(
      'Realizado em seg., 12 de out., às 18:42',
    );
  });
});

describe('06-07 — Participantes (UI-D-213): the chip param, the row meta and the spelled code', () => {
  const EVENT_ID = '11111111-1111-4111-8111-111111111111';
  const AVATAR = 'a1111111-1111-4111-8111-111111111111';
  const attendee = (overrides: Partial<Attendee> = {}): Attendee => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    displayName: 'Iris Muñoz',
    avatarAssetId: null,
    avatarVariantWidths: [],
    removed: false,
    status: 'going',
    respondedAt: '2026-10-02T15:00:00.000000Z',
    checkedInAt: null,
    walkIn: false,
    ...overrides,
  });
  const NOW = at('2026-10-12T23:00:00Z');

  it('26. ?lista= selects a chip only on the EXACT pt-BR value; anything else is Confirmados (D-93)', () => {
    expect(ATTENDANCE_LIST_PARAMS).toEqual({
      confirmed: 'confirmados',
      present: 'presentes',
      not_going: 'nao-vao',
    });
    expect(attendanceListFromParam(undefined)).toBe('confirmed');
    expect(attendanceListFromParam('confirmados')).toBe('confirmed');
    expect(attendanceListFromParam('presentes')).toBe('present');
    expect(attendanceListFromParam('nao-vao')).toBe('not_going');
    for (const bad of ['PRESENTES', 'present', 'not_going', 'nao_vao', '', ['presentes']]) {
      expect(attendanceListFromParam(bad), String(bad)).toBe('confirmed');
    }
    expect(participantsHref(EVENT_ID, 'confirmed')).toBe(`/eventos/${EVENT_ID}/participantes`);
    expect(participantsHref(EVENT_ID, 'present')).toBe(
      `/eventos/${EVENT_ID}/participantes?lista=presentes`,
    );
    expect(participantsHref(EVENT_ID, 'not_going')).toBe(
      `/eventos/${EVENT_ID}/participantes?lista=nao-vao`,
    );
  });

  it('27. the meta by chip: Confirmou em / Check-in às (today) / Check-in em …, às (another day) / Respondeu em', () => {
    const tz = { tz: SP, nowMs: NOW, t };
    expect(attendeeView(attendee(), 'confirmed', tz).meta).toBe('Confirmou em sex., 2 de out.');
    expect(
      attendeeView(
        attendee({ status: 'checked_in', checkedInAt: '2026-10-12T21:42:00.000000Z' }),
        'present',
        tz,
      ).meta,
    ).toBe('Check-in às 18:42');
    expect(
      attendeeView(
        attendee({ status: 'walk_in', respondedAt: null, checkedInAt: '2026-10-12T02:58:00Z' }),
        'present',
        tz,
      ).meta,
    ).toBe('Check-in em dom., 11 de out., às 23:58');
    expect(attendeeView(attendee({ status: 'not_going' }), 'not_going', tz).meta).toBe(
      'Respondeu em sex., 2 de out.',
    );
    // Manaus is an hour behind: the same instant is another wall clock, never the device's.
    expect(
      attendeeView(
        attendee({ status: 'checked_in', checkedInAt: '2026-10-12T21:42:00.000000Z' }),
        'present',
        { tz: MANAUS, nowMs: NOW, t },
      ).meta,
    ).toBe('Check-in às 17:42');
  });

  it('28. a removed member is "Membro removido" with no photo; walkIn and the avatar path map through', () => {
    const tz = { tz: SP, nowMs: NOW, t };
    const removed = attendeeView(
      attendee({ removed: true, displayName: null, avatarAssetId: null, walkIn: true }),
      'present',
      tz,
    );
    expect(removed).toMatchObject({ name: 'Membro removido', removed: true, avatarUrl: null });
    expect(removed.walkIn).toBe(true);
    const named = attendeeView(attendee({ avatarAssetId: AVATAR }), 'confirmed', tz);
    expect(named).toMatchObject({ name: 'Iris Muñoz', removed: false, walkIn: false });
    expect(named.avatarUrl).toBe(`/v1/media/${AVATAR}/w128`);
  });

  it('29. spelledCode spells the code character by character', () => {
    expect(spelledCode('K7QM')).toBe('K, 7, Q, M');
    expect(t('participants.code.aria', { spelled: spelledCode('K7QM') })).toBe('Código K, 7, Q, M');
  });
});

describe('06-08 — the calendar pair (UI-D-210)', () => {
  it('30. shows in P0-P2 whatever the answer, and never when cancelled or ended', () => {
    const calendar = (nowIso: string, overrides: Partial<EventDetail> = {}) =>
      eventDetailView(detail(overrides), { tz: SP, nowMs: at(nowIso), t }).calendar;
    expect(calendar('2026-10-01T12:00:00Z')).toBe(true);
    expect(calendar('2026-10-01T12:00:00Z', { viewerStatus: 'not_going' })).toBe(true);
    expect(calendar('2026-10-12T21:30:00Z', { viewerStatus: 'going' })).toBe(true);
    expect(
      calendar('2026-10-12T23:00:00Z', {
        viewerStatus: 'checked_in',
        viewerCheckedInAt: '2026-10-12T21:40:00.000000Z',
      }),
    ).toBe(true);
    expect(calendar('2026-10-12T23:00:00Z', { format: 'online', venueName: null })).toBe(true);
    expect(calendar('2026-10-20T12:00:00Z')).toBe(false);
    expect(calendar('2026-10-01T12:00:00Z', { status: 'cancelled' })).toBe(false);
    expect(calendar('2026-10-12T23:00:00Z', { status: 'cancelled' })).toBe(false);
  });
});

describe('2026-10-03 — the category, the city and "Últimas N vagas" on the card', () => {
  const before = at('2026-10-01T12:00:00Z');
  /** Inside the check-in window (P1): answers are still open until the start. */
  const checkinWindow = at('2026-10-12T21:30:00Z');
  const live = at('2026-10-12T23:00:00Z');
  const after = at('2026-10-20T12:00:00Z');
  const composed =
    'Avenida Paulista, 1578\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200';
  const card = (overrides: Partial<EventSummary>, nowMs = before) =>
    eventCardView(event(overrides), { tz: SP, nowMs, t });

  it('39. the category line is the event’s own category, else the format’s words', () => {
    expect(card({ category: 'Workshop' }).category).toBe('Workshop');
    expect(card({ category: 'Live', format: 'online', venueName: null }).category).toBe('Live');
    expect(card({}).category).toBe('Evento presencial');
    expect(card({ format: 'online', venueName: null }).category).toBe('Evento online');
  });

  it('40. the place line: "Cidade, UF" for a composed address, the venue for a legacy one, Online online', () => {
    expect(card({ address: composed }).place).toBe('São Paulo, SP');
    expect(card({ address: composed }).placeKind).toBe('venue');
    // A legacy free text (the seed's) does not parse: the venue name, as before.
    expect(card({ address: 'Rua das Flores, 100 - Centro, Sao Paulo - SP' }).place).toBe(
      'Auditório da sede',
    );
    expect(card({ address: null }).place).toBe('Auditório da sede');
    expect(card({ format: 'online', venueName: null, address: null }).place).toBe('Online');
  });

  it('41. spotsLeft is the limit minus the confirmed count, never below zero, null without a limit', () => {
    expect(spotsLeft({ capacity: 50, confirmedCount: 38 })).toBe(12);
    expect(spotsLeft({ capacity: 50, confirmedCount: 50 })).toBe(0);
    // A limit lowered under the confirmations reads as full, never as a negative number.
    expect(spotsLeft({ capacity: 10, confirmedCount: 14 })).toBe(0);
    expect(spotsLeft({ capacity: null, confirmedCount: 14 })).toBeNull();
    expect(EVENT_LOW_SPOTS).toBe(10);
  });

  it('42. not the viewer’s, before the start: "Últimas N vagas" from 10 down to 2, "Última vaga", "Vagas esgotadas"', () => {
    const note = (confirmedCount: number, capacity: number | null = 50, nowMs = before) =>
      card({ capacity, confirmedCount }, nowMs).note;
    expect(note(39)).toBeUndefined(); // 11 left: above the threshold
    expect(note(40)).toBe('Últimas 10 vagas');
    expect(note(45)).toBe('Últimas 5 vagas');
    expect(note(48)).toBe('Últimas 2 vagas');
    expect(note(49)).toBe('Última vaga');
    expect(note(50)).toBe('Vagas esgotadas');
    expect(note(57)).toBe('Vagas esgotadas');
    expect(note(0, null)).toBeUndefined(); // no limit
    // Inside the check-in window, answers are still open: the line stays.
    expect(note(47, 50, checkinWindow)).toBe('Últimas 3 vagas');
    // From the start (in progress, ended) nobody can confirm: no scarcity line.
    expect(note(47, 50, live)).toBeUndefined();
    expect(note(47, 50, after)).toBeUndefined();
    // A cancelled event says nothing about spots.
    expect(card({ capacity: 50, confirmedCount: 47, status: 'cancelled' }).note).toBeUndefined();
    // Não vou is not the viewer's: the line shows.
    expect(card({ capacity: 50, confirmedCount: 47, viewerStatus: 'not_going' }).note).toBe(
      'Últimas 3 vagas',
    );
  });

  it('43. the viewer’s own event keeps its countdown, and the scarcity line rides the card’s name', () => {
    const mine = card({ capacity: 50, confirmedCount: 49, viewerStatus: 'going' });
    expect(mine.note).toBe('Faltam 11 dias');
    const theirs = card({ capacity: 50, confirmedCount: 47 });
    expect(theirs.ariaLabel).toBe('Encontro anual, seg., 12 de out. · 19:00, Últimas 3 vagas');
  });
});

describe('2026-10-03 — the detail: the hero category, the "Vagas" cell and the full flag', () => {
  const detailAt = (overrides: Partial<EventDetail>, nowIso = '2026-10-01T12:00:00Z') =>
    eventDetailView(detail(overrides), { tz: SP, nowMs: at(nowIso), t });

  it('44. the hero carries the category (null for none)', () => {
    expect(detailAt({ category: 'Imersão presencial' }).hero.category).toBe('Imersão presencial');
    expect(detailAt({}).hero.category).toBeNull();
  });

  it('45. a limit adds a fifth cell after the count: spots left while answers are open, the limit after', () => {
    const cell = (overrides: Partial<EventDetail>, nowIso?: string) => {
      const view = detailAt(overrides, nowIso);
      expect(view.countIndex).toBe(3);
      return view.info[4];
    };
    expect(cell({ capacity: 50, confirmedCount: 38 })).toEqual({
      icon: 'spots',
      label: 'Vagas',
      value: 'Restam 12 de 50',
    });
    expect(cell({ capacity: 50, confirmedCount: 49 })?.value).toBe('Resta 1 de 50');
    expect(cell({ capacity: 50, confirmedCount: 50 })?.value).toBe('Esgotadas (50 vagas)');
    expect(cell({ capacity: 1, confirmedCount: 3 })?.value).toBe('Esgotada (1 vaga)');
    expect(cell({ capacity: 100_000, confirmedCount: 0 })?.value).toBe('Restam 100.000 de 100.000');
    // From the start (and when cancelled) nobody can confirm: the limit alone.
    expect(cell({ capacity: 50, confirmedCount: 12 }, '2026-10-12T23:00:00Z')?.value).toBe(
      '50 vagas',
    );
    expect(cell({ capacity: 50, confirmedCount: 50, status: 'cancelled' })?.value).toBe('50 vagas');
    // No limit: the four cells of before.
    expect(detailAt({}).info).toHaveLength(4);
  });

  it('46. full is "no spot left for a new confirmation", and reaches the action zone', () => {
    expect(detailAt({ capacity: 50, confirmedCount: 50 }).full).toBe(true);
    expect(detailAt({ capacity: 50, confirmedCount: 49 }).full).toBe(false);
    expect(detailAt({ capacity: null, confirmedCount: 999 }).full).toBe(false);
    const d = detail({ capacity: 2, confirmedCount: 2 });
    const view = eventDetailView(d, { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t });
    expect(eventActionState(d, view).full).toBe(true);
  });
});

describe('2026-10-06 — the REINE detail pieces', () => {
  const now = { tz: SP, nowMs: at('2026-10-01T12:00:00Z'), t };
  const extras = {
    dressCode: 'Casual + scrub',
    included: ['Coffee break'],
    bring: ['Documento com foto'],
    certificate: { hours: 16 },
    schedule: [],
  };

  it('splits the "Informações úteis" off the description; the dress code is the fourth cell', () => {
    const view = eventDetailView(
      detail({ description: composeEventDescription('Dois dias de imersão.', extras) }),
      now,
    );
    expect(view.description).toBe('Dois dias de imersão.');
    expect(view.extras).toEqual(extras);
    expect(view.info[3]).toEqual({ icon: 'dress', label: 'Traje', value: 'Casual + scrub' });
    expect(view.countIndex).toBe(-1);
    // Without a dress code the count keeps the cell (and the polite live region).
    expect(eventDetailView(detail(), now).info[3]?.icon).toBe('people');
  });

  it('a going viewer gets the registration (an example ticket code) and the example programme', () => {
    const view = eventDetailView(detail({ viewerStatus: 'going' }), {
      ...now,
      viewerId: 'u1',
      tenantName: 'Rede Demo',
    });
    expect(view.registration?.ticketCode).toMatch(/^RD-\d{4}$/);
    expect(view.registration?.ticketCode).toBe(exampleTicketCode(detail().id, 'u1', 'Rede Demo'));
    expect(view.schedule?.example).toBe(true);
    expect(view.schedule?.days[0]?.items.map((item) => item.time)).toEqual([
      '19:00',
      '19:30',
      '20:00',
      '21:00',
    ]);
    expect(view.engaged).toBe(true);
    // Not going: neither.
    const out = eventDetailView(detail(), now);
    expect(out.registration).toBeNull();
    expect(out.schedule).toBeNull();
    expect(out.engaged).toBe(false);
  });

  it('the organiser’s programme ("Cronograma") replaces the example, for every viewer, by day', () => {
    const programme = composeEventDescription('Imersão.', {
      ...extras,
      schedule: [
        { day: 1, time: '08:00', title: 'Credenciamento' },
        { day: 1, time: '12:00', title: 'Almoço' },
        { day: 2, time: '09:00', title: 'Abertura do segundo dia' },
      ],
    });
    const twoDays = {
      startsAt: '2026-10-20T11:00:00.000Z',
      endsAt: '2026-10-21T21:00:00.000Z',
      description: programme,
    };
    // A member who did not register sees it too, and nothing in it is an example.
    const view = eventDetailView(detail(twoDays), now);
    expect(view.engaged).toBe(false);
    expect(view.description).toBe('Imersão.');
    expect(view.schedule?.example).toBe(false);
    expect(view.schedule?.days.map((day) => day.label)).toEqual(['Dia 1', 'Dia 2']);
    expect(view.schedule?.days[0]?.items).toEqual([
      { time: '08:00', title: 'Credenciamento' },
      { time: '12:00', title: 'Almoço' },
    ]);
    expect(view.schedule?.days[1]?.items).toEqual([
      { time: '09:00', title: 'Abertura do segundo dia' },
    ]);
    // Day 2 is dated the day after the start, in the tenant's zone.
    expect(view.schedule?.days[1]?.date).not.toBe(view.schedule?.days[0]?.date);
    // A going viewer gets the same programme, never the example over it.
    const going = eventDetailView(detail({ ...twoDays, viewerStatus: 'going' }), now);
    expect(going.schedule?.example).toBe(false);
    expect(going.schedule?.days).toEqual(view.schedule?.days);
  });

  it('after a check-in that is over: "Participou" and the participation line', () => {
    const view = eventDetailView(
      detail({
        viewerStatus: 'checked_in',
        viewerCheckedInAt: '2026-10-12T21:40:00.000000Z',
        description: composeEventDescription('', { ...extras, dressCode: null }),
      }),
      { tz: SP, nowMs: at('2026-10-20T12:00:00Z'), t },
    );
    expect(view.headerPill).toEqual({ tone: 'brand', label: 'Participou' });
    expect(view.participation?.line).toBe('Certificado de 16 horas');
    expect(view.registration).toBeNull();
  });

  it('several days by day: "Dias" and the daily window; with a dress code, four cells exactly', () => {
    const view = eventDetailView(
      detail({
        startsAt: '2026-10-20T11:00:00.000Z',
        endsAt: '2026-10-21T21:00:00.000Z',
        capacity: 120,
        description: composeEventDescription('', { ...extras, certificate: null }),
      }),
      now,
    );
    expect(view.info.map((cell) => cell.label)).toEqual(['Dias', 'Horário', 'Local', 'Traje']);
    expect(view.info[1]?.value).toBe('08:00 às 18:00');
  });

  it('eventHours counts the daily window, never the nights', () => {
    expect(eventHours(event(), SP)).toBe(2);
    expect(
      eventHours(
        event({ startsAt: '2026-10-14T11:00:00.000Z', endsAt: '2026-10-15T21:00:00.000Z' }),
        SP,
      ),
    ).toBe(20);
  });

  it('eventMapView: the address in Google’s order, the line and the neighbourhood for stays', () => {
    const composed = 'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\nCEP 01310-200';
    expect(eventMapView('MASP', composed)).toEqual({
      query: 'Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200',
      venue: 'MASP',
      addressLine: 'Avenida Paulista, 1578, Bela Vista, São Paulo/SP',
      areaQuery: 'Bela Vista, São Paulo/SP',
      areaLabel: 'Bela Vista',
    });
    // A legacy free-text address: searched as written.
    // The complement stays on the visible line (never in the search: Google ignores rooms).
    const withRoom = 'Avenida Paulista, 1578\nSala 12\nBela Vista, São Paulo - SP\nCEP 01310-200';
    expect(eventMapView('MASP', withRoom)?.addressLine).toBe(
      'Avenida Paulista, 1578, Sala 12, Bela Vista, São Paulo/SP',
    );
    expect(eventMapView('MASP', withRoom)?.query).toBe(
      'Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200',
    );
    expect(eventMapView('Sede', 'Rua das Flores, 100')?.query).toBe('Sede, Rua das Flores, 100');
    expect(eventMapView('', '')).toBeNull();
  });
});
