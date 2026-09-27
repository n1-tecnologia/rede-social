import { fileURLToPath } from 'node:url';
import type { EventSummary } from '@tria/module-events/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  eventPhase,
  eventPill,
  eventPosterView,
  eventWhenLine,
  formatEventDate,
  formatEventTime,
  tenantDayKey,
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
