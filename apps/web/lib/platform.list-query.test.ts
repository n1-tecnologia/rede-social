import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const { buildTenantsQuery, parseTenantListQuery, toTenantRow, PANEL_PAGE_SIZE } = await import(
  './platform'
);

/**
 * 09.2-20 Task 1 (UI-D-540, DBT-52) - the list page's query. `status` and `banco` are one single-select
 * chip row and the API answers 400 for both, so a hand-typed URL keeps `banco` and the request never
 * carries both. Each parameter is parsed on its own and a bad value is dropped, never a 500.
 */
describe('parseTenantListQuery', () => {
  it('parses banco=problema and forwards nothing else by default', () => {
    expect(parseTenantListQuery({ banco: 'problema' })).toEqual({
      q: undefined,
      status: undefined,
      banco: 'problema',
      limit: PANEL_PAGE_SIZE,
      explicitLimit: false,
    });
  });

  it('keeps banco and drops status when the URL carries both', () => {
    const query = parseTenantListQuery({ status: 'active', banco: 'problema' });
    expect(query.banco).toBe('problema');
    expect(query.status).toBeUndefined();
  });

  it('drops an invalid banco and keeps a valid status', () => {
    const query = parseTenantListQuery({ status: 'suspended', banco: 'tudo' });
    expect(query.banco).toBeUndefined();
    expect(query.status).toBe('suspended');
  });

  it('takes the first value of a repeated parameter and keeps q and limit', () => {
    const query = parseTenantListQuery({ banco: ['problema', 'x'], q: ' ana ', limit: '10' });
    expect(query).toMatchObject({ banco: 'problema', q: 'ana', limit: 10, explicitLimit: true });
  });
});

describe('buildTenantsQuery', () => {
  it('sends banco to the API', () => {
    expect(buildTenantsQuery({ banco: 'problema', limit: 25 })).toBe('banco=problema&limit=25');
  });

  it('never sends status and banco together (the API would answer 400)', () => {
    const qs = buildTenantsQuery({ status: 'active', banco: 'problema', limit: 25 });
    expect(qs).toBe('banco=problema&limit=25');
    expect(qs).not.toContain('status');
  });

  it('keeps status alone as before and drops the cursor only when absent', () => {
    expect(
      buildTenantsQuery({ q: 'ana', status: 'suspended', cursor: 'ana-souza', limit: 5 }),
    ).toBe('q=ana&status=suspended&cursor=ana-souza&limit=5');
  });
});

describe('toTenantRow', () => {
  it('carries the database fact of the list answer onto the row untouched', () => {
    const row = toTenantRow(
      {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'ana',
        displayName: 'Ana',
        status: 'active',
        createdAt: '2026-10-12T12:00:00Z',
        enabledModules: [],
        primaryHost: null,
        database: { state: 'behind', schema: { applied: 144, required: 147 } },
      },
      (count) => `${count}`,
    );
    expect(row.database).toEqual({ state: 'behind', schema: { applied: 144, required: 147 } });
  });
});
