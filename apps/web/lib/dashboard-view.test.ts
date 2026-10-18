import { describe, expect, it } from 'vitest';
import { freshnessText } from './dashboard-view';

/**
 * The freshness line's choice and format (08.7-01, UI-D-468, EP-54): `today` only when the snapshot
 * is of the tenant's yesterday AND was built on the tenant's today; any other case is the `past`
 * form with the real day and build date. Every time and date is in the TENANT's zone, `HH:mm` h23
 * and `dd/MM`, never the browser's or the server's.
 */

const SP = 'America/Sao_Paulo';
/** 2026-10-18 12:00 in São Paulo. */
const NOW = Date.parse('2026-10-18T15:00:00Z');

describe('freshnessText (UI-D-468, EP-54)', () => {
  it('yesterday built today reads the today form with the tenant-local HH:mm', () => {
    expect(freshnessText({ day: '2026-10-17', builtAt: '2026-10-18T09:47:00Z' }, SP, NOW)).toEqual({
      key: 'today',
      values: { time: '06:47' },
    });
  });

  it('a build at 03:30Z for America/Sao_Paulo reads 00:30 (h23, never 24:30)', () => {
    expect(freshnessText({ day: '2026-10-17', builtAt: '2026-10-18T03:30:00Z' }, SP, NOW)).toEqual({
      key: 'today',
      values: { time: '00:30' },
    });
  });

  it('a build on the tenant-local yesterday reads the past form, even at 02:30Z today', () => {
    // 02:30Z on the 18th is 23:30 on the 17th in São Paulo: not today there.
    expect(freshnessText({ day: '2026-10-16', builtAt: '2026-10-18T02:30:00Z' }, SP, NOW)).toEqual({
      key: 'past',
      values: { day: '16/10', date: '17/10', time: '23:30' },
    });
  });

  it('a snapshot two days old reads the past form with its real dd/MM day and build date', () => {
    expect(freshnessText({ day: '2026-10-14', builtAt: '2026-10-15T03:47:00Z' }, SP, NOW)).toEqual({
      key: 'past',
      values: { day: '14/10', date: '15/10', time: '00:47' },
    });
  });

  it('a snapshot of yesterday built on an earlier day is never relabelled as today', () => {
    expect(freshnessText({ day: '2026-10-17', builtAt: '2026-10-17T03:00:00Z' }, SP, NOW).key).toBe(
      'past',
    );
  });

  it('reads the tenant zone, not UTC: Tokyo is already the 19th at 15:30Z', () => {
    const tokyoNow = Date.parse('2026-10-18T15:30:00Z'); // 2026-10-19 00:30 in Tokyo
    expect(
      freshnessText({ day: '2026-10-18', builtAt: '2026-10-18T15:20:00Z' }, 'Asia/Tokyo', tokyoNow),
    ).toEqual({ key: 'today', values: { time: '00:20' } });
  });
});
