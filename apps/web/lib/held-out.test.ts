import { HOST_TENANT_STATUSES } from '@rede-social/contracts';
import { Hourglass, RefreshCw, TriangleAlert } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { heldIcon, heldNamespace, heldOf, heldOfCode, heldPath } from './held-out';

/**
 * 09.2-21 (UI-D-542, A-UI-8; P104): the member-side table of held-out host states. Pure: the same input
 * always gives the same answer, and the closed status set of the contract is covered exhaustively.
 */
describe('heldOf', () => {
  it('maps the whole closed status set: only `active` is not held', () => {
    expect(Object.fromEntries(HOST_TENANT_STATUSES.map((s) => [s, heldOf(s)]))).toEqual({
      active: null,
      suspended: 'suspended',
      preparing: 'preparing',
      updating: 'updating',
      unavailable: 'unavailable',
    });
  });

  it('reads a missing, null or unknown status as not held, never as held', () => {
    expect(heldOf(undefined)).toBeNull();
    expect(heldOf(null)).toBeNull();
    expect(heldOf('')).toBeNull();
    expect(heldOf('migrating')).toBeNull();
  });

  it('is pure', () => {
    expect(heldOf('updating')).toBe(heldOf('updating'));
  });
});

describe('heldPath / heldNamespace / heldIcon', () => {
  it('sends each state to its screen; suspended and unreachable share the generic one (A-UI-8)', () => {
    expect(heldPath('updating')).toBe('/comunidade-em-atualizacao');
    expect(heldPath('preparing')).toBe('/comunidade-em-preparacao');
    expect(heldPath('suspended')).toBe('/comunidade-indisponivel');
    expect(heldPath('unavailable')).toBe('/comunidade-indisponivel');
  });

  it('never routes through the session-clearing /auth/suspended route', () => {
    for (const held of ['suspended', 'unavailable', 'updating', 'preparing'] as const) {
      expect(heldPath(held)).not.toMatch(/^\/auth\//);
    }
  });

  it('uses the generic copy for suspended and unreachable and the dedicated copy for the other two', () => {
    expect(heldNamespace('suspended')).toBe('unavailable');
    expect(heldNamespace('unavailable')).toBe('unavailable');
    expect(heldNamespace('updating')).toBe('updating');
    expect(heldNamespace('preparing')).toBe('preparing');
  });

  it('gives the dedicated glyphs and the shipped triangle for the generic card', () => {
    expect(heldIcon('updating')).toBe(RefreshCw);
    expect(heldIcon('preparing')).toBe(Hourglass);
    expect(heldIcon('suspended')).toBe(TriangleAlert);
    expect(heldIcon('unavailable')).toBe(TriangleAlert);
  });
});

describe('heldOfCode', () => {
  it('reads the three 503 codes and nothing else', () => {
    expect(heldOfCode('TENANT_UPDATING')).toBe('updating');
    expect(heldOfCode('TENANT_PREPARING')).toBe('preparing');
    expect(heldOfCode('TENANT_UNAVAILABLE')).toBe('unavailable');
    expect(heldOfCode('TENANT_SUSPENDED')).toBeNull();
    expect(heldOfCode('FORBIDDEN')).toBeNull();
    expect(heldOfCode(undefined)).toBeNull();
  });
});
