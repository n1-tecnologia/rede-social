import { describe, expect, it } from 'vitest';
import {
  activityDelta,
  formatCount,
  formatWeekdayShort,
  MIN_STREAK_WEEKS,
  rankCommunityRows,
} from './member-activity-view';

/**
 * 08.7-03 — the member report's pure helpers (planning decision 3, EP-05, EP-08, UI-D-475,
 * UI-D-483): the change of a count against the 7 days before, the streak threshold, the ranked
 * "Onde você mais participa" rows and the pt-BR formatters moved from the retired sample file.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('activityDelta (a count difference, never a grade)', () => {
  it('3 against 1 → 2 up', () => {
    expect(activityDelta(3, 1)).toEqual({ amount: 2, direction: 'up' });
  });
  it('1 against 3 → 2 down', () => {
    expect(activityDelta(1, 3)).toEqual({ amount: 2, direction: 'down' });
  });
  it('0 against 0 → 0 flat (UI-D-481: a real zero keeps its chip)', () => {
    expect(activityDelta(0, 0)).toEqual({ amount: 0, direction: 'flat' });
  });
  it('equal non-zero counts → 0 flat', () => {
    expect(activityDelta(5, 5)).toEqual({ amount: 0, direction: 'flat' });
  });
});

describe('MIN_STREAK_WEEKS', () => {
  it('is 2: a one-week streak says nothing (UI-D-483)', () => {
    expect(MIN_STREAK_WEEKS).toBe(2);
  });
});

describe('rankCommunityRows (EP-05, EP-08, UI-D-475)', () => {
  it('most interactions first; the tenant feed reads the given label and is ranked, never pinned', () => {
    const rows = rankCommunityRows(
      [
        { communityId: A, name: 'Geral', interactions: 5 },
        { communityId: null, name: null, interactions: 2 },
        { communityId: B, name: 'Avisos', interactions: 9 },
      ],
      'Início',
    );
    expect(rows.map((row) => [row.label, row.interactions])).toEqual([
      ['Avisos', 9],
      ['Geral', 5],
      ['Início', 2],
    ]);
    expect(rows[2]?.id).toBe('tenant-feed');
  });

  it('equal interactions are ordered by name in pt-BR, then by id', () => {
    const rows = rankCommunityRows(
      [
        { communityId: C, name: 'Óculos', interactions: 3 },
        { communityId: B, name: 'Eventos', interactions: 3 },
        { communityId: null, name: null, interactions: 3 },
        { communityId: A, name: 'Eventos', interactions: 3 },
      ],
      'Início',
    );
    expect(rows.map((row) => row.id)).toEqual([A, B, 'tenant-feed', C]);
  });

  it('is stable: the same rows in any input order give the same ranking (EP-08)', () => {
    const input = [
      { communityId: A, name: 'Geral', interactions: 4 },
      { communityId: B, name: 'Avisos', interactions: 4 },
      { communityId: null, name: null, interactions: 1 },
    ];
    expect(rankCommunityRows([...input].reverse(), 'Início')).toEqual(
      rankCommunityRows(input, 'Início'),
    );
  });

  it('drops rows at 0 and keeps the stored name exactly (EP-07)', () => {
    const name = 'Grupo <b>"Ação"</b> & cia';
    const rows = rankCommunityRows(
      [
        { communityId: A, name, interactions: 1 },
        { communityId: B, name: 'Vazio', interactions: 0 },
      ],
      'Início',
    );
    expect(rows).toEqual([{ id: A, label: name, interactions: 1 }]);
  });
});

describe('formatters', () => {
  it('formatCount in pt-BR', () => {
    expect(formatCount(1234)).toBe('1.234');
  });
  it('formatWeekdayShort with no trailing dot', () => {
    expect(formatWeekdayShort('2026-10-05')).toBe('seg');
  });
});
