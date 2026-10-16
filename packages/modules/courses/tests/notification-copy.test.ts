import { describe, expect, it } from 'vitest';
import {
  COURSES_PUSH_BODY_MAX,
  coursesPushCopy,
  liveTime,
  liveWhen,
} from '../server/notification-copy';

/**
 * 08.6-05 (UI-D-461, D-451): the courses push bodies, rendered SERVER-SIDE in the TENANT's clock
 * (`tenants.timezone`), never the Cloud Run instance's UTC clock (T-07-28).
 */

/** 19:00 in São Paulo (UTC−3), 18:00 in Manaus (UTC−4), on Monday 12 October 2026. */
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const graphemes = (text: string) => [...new Intl.Segmenter('pt-BR').segment(text)].length;

describe('coursesPushCopy.liveReminder (UI-D-461)', () => {
  it('reads "Em 15 minutos: {title} começa às {time}" in the tenant clock', () => {
    expect(coursesPushCopy.liveReminder('Tira-dúvidas', STARTS_AT, 'America/Sao_Paulo')).toBe(
      'Em 15 minutos: Tira-dúvidas começa às 19:00',
    );
  });

  it('another tenant timezone reads its own wall clock, never UTC', () => {
    expect(coursesPushCopy.liveReminder('Tira-dúvidas', STARTS_AT, 'America/Manaus')).toBe(
      'Em 15 minutos: Tira-dúvidas começa às 18:00',
    );
  });

  it('a 200-character title cuts on a word to 100 graphemes with an ellipsis', () => {
    const title = Array.from({ length: 40 }, () => 'aula').join(' ');
    expect(title.length).toBeGreaterThanOrEqual(199);
    const body = coursesPushCopy.liveReminder(title, STARTS_AT, 'America/Sao_Paulo');
    expect(body.startsWith('Em 15 minutos: aula aula')).toBe(true);
    expect(body.endsWith('…')).toBe(true);
    expect(graphemes(body)).toBeLessThanOrEqual(COURSES_PUSH_BODY_MAX);
    expect(body).not.toMatch(/ a…$|aul…$/);
  });

  it('a short body is never cut and carries no ellipsis', () => {
    expect(coursesPushCopy.liveReminder('Live', STARTS_AT, 'America/Sao_Paulo')).not.toContain('…');
  });
});

describe('coursesPushCopy.liveCancelled (UI-D-461, D-447)', () => {
  const ON_DAY = Date.parse('2026-10-12T12:00:00.000Z');

  it('reads "Live cancelada: {title} · {when}" with when in the tenant clock', () => {
    expect(
      coursesPushCopy.liveCancelled('Tira-dúvidas', STARTS_AT, 'America/Sao_Paulo', ON_DAY),
    ).toBe('Live cancelada: Tira-dúvidas · seg., 12 de out. · 19:00');
  });

  it('another tenant timezone reads its own wall clock, never UTC', () => {
    expect(
      coursesPushCopy.liveCancelled('Tira-dúvidas', STARTS_AT, 'America/Manaus', ON_DAY),
    ).toBe('Live cancelada: Tira-dúvidas · seg., 12 de out. · 18:00');
  });

  it('a 200-character title cuts on a word to 100 graphemes with an ellipsis', () => {
    const title = Array.from({ length: 40 }, () => 'aula').join(' ');
    const body = coursesPushCopy.liveCancelled(title, STARTS_AT, 'America/Sao_Paulo', ON_DAY);
    expect(body.startsWith('Live cancelada: aula aula')).toBe(true);
    expect(body.endsWith('…')).toBe(true);
    expect(graphemes(body)).toBeLessThanOrEqual(COURSES_PUSH_BODY_MAX);
  });
});

describe('liveTime and liveWhen (the tenant clock, h23)', () => {
  it('liveTime is 24-hour, two digits: midnight-thirty reads 00:30', () => {
    expect(liveTime('2026-10-13T03:30:00.000000Z', 'America/Sao_Paulo')).toBe('00:30');
    expect(liveTime(STARTS_AT, 'America/Sao_Paulo')).toBe('19:00');
  });

  it('liveWhen reads "seg., 12 de out. · 19:00" in the same year', () => {
    expect(liveWhen(STARTS_AT, 'America/Sao_Paulo', NOW)).toBe('seg., 12 de out. · 19:00');
  });

  it('liveWhen appends the year only when the tenant-local year differs from now', () => {
    expect(liveWhen('2027-01-04T22:00:00.000000Z', 'America/Sao_Paulo', NOW)).toContain('2027');
    expect(liveWhen(STARTS_AT, 'America/Sao_Paulo', NOW)).not.toContain('2026');
  });
});
