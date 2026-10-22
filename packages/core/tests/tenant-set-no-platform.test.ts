import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMigrationDir } from '../server/migrations/sets';

/**
 * Phase 09.2-02 (D-547, T-09.2-07): the TENANT set is applied to every project, including the ones that
 * never get the registry. So no file of `supabase/migrations` may reference schema `platform` or the central
 * ledger, and none may carry a transaction-control statement or `concurrently` (the runner puts each file in
 * ONE transaction together with its ledger row, exactly like the Supabase CLI).
 */
const dir = defaultMigrationDir('tenant');
const files = readdirSync(dir).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name));

/** The file without `--` line comments and without `/* ... *\/` blocks. */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

describe('the tenant migration set', () => {
  it('has files to read (the guard below is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('never references schema platform or the central ledger', () => {
    const offenders = files.filter((name) => {
      const text = code(readFileSync(join(dir, name), 'utf8'));
      return (
        /\bplatform\s*\./i.test(text) ||
        /"platform"/i.test(text) ||
        /central_migrations/i.test(text)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('carries no begin/commit/rollback statement and no concurrently (one transaction per file)', () => {
    const offenders = files.filter((name) => {
      const text = code(readFileSync(join(dir, name), 'utf8'));
      return (
        /^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(text) ||
        /\bconcurrently\b/i.test(text)
      );
    });
    expect(offenders).toEqual([]);
  });
});
