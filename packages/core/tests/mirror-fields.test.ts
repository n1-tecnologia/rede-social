import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { tenantModules, tenants } from '../db/schema';
import {
  CENTRAL_FIELD_COLUMN,
  CENTRAL_OWNED,
  LOCAL_COLUMNS,
  type OwnedColumn,
  TENANT_OWNED,
} from '../server/tenancy/mirror';

/**
 * 09.2-07 (D-537, T-09.2-30): the ownership table is DATA with a guard. Every column of `public.tenants` and
 * `public.tenant_modules` is owned by exactly one side (the control plane or the tenant's own project) or is
 * marked local (identifiers and timestamps), so a column a later phase adds fails here until somebody decides
 * who edits it and which way it is copied.
 */

const columnsOf = (table: Parameters<typeof getTableConfig>[0]): string[] =>
  getTableConfig(table).columns.map((c) => c.name);

const key = (c: OwnedColumn) => `${c.table}.${c.column}`;

describe('the central/tenant ownership table (D-537)', () => {
  it('every column of tenants and tenant_modules is owned by exactly one side, or is local', () => {
    const actual = [
      ...columnsOf(tenants).map((column) => `tenants.${column}`),
      ...columnsOf(tenantModules).map((column) => `tenant_modules.${column}`),
    ].sort();

    const listed = [...CENTRAL_OWNED, ...TENANT_OWNED, ...LOCAL_COLUMNS].map(key).sort();

    // No column is listed twice (two owners), none is missing (no owner), none is invented.
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(actual);
  });

  it('the owner of each contested column is the one D-537 names', () => {
    expect(CENTRAL_OWNED.map(key).sort()).toEqual(
      [
        'tenants.slug',
        'tenants.status',
        'tenants.display_name',
        'tenants.timezone',
        'tenants.plan',
        'tenant_modules.enabled',
      ].sort(),
    );
    expect(TENANT_OWNED.map(key).sort()).toEqual(
      [
        'tenants.branding',
        'tenants.rules_text',
        'tenants.rules_version',
        'tenant_modules.settings',
      ].sort(),
    );
  });

  it('every central-owned column can be named by a push, and a push field covers one column', () => {
    expect(Object.values(CENTRAL_FIELD_COLUMN).map(key).sort()).toEqual(
      CENTRAL_OWNED.map(key).sort(),
    );
    // `tenant_domains` is not in the table at all: it exists only centrally.
    for (const c of [...CENTRAL_OWNED, ...TENANT_OWNED, ...LOCAL_COLUMNS]) {
      expect(['tenants', 'tenant_modules']).toContain(c.table);
    }
  });

  it('the guard bites: a column nobody owns is reported as missing', () => {
    const actual = new Set([
      ...columnsOf(tenants).map((column) => `tenants.${column}`),
      'tenants.invented',
    ]);
    const listed = new Set([...CENTRAL_OWNED, ...TENANT_OWNED, ...LOCAL_COLUMNS].map(key));
    const unowned = [...actual].filter((column) => !listed.has(column));
    expect(unowned).toEqual(['tenants.invented']);
  });
});
