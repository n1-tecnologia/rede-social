import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRequiredTenantSchema,
  setRequiredTenantSchemaForTests,
} from '../server/migrations/required';

/**
 * Phase 09.2-15 (DBT-44, D-545; P85): where the required tenant schema comes from, with no database. The
 * resolution order is the test override, the image manifest, the repository outside production, and a named
 * error in production.
 */

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const sha = 'a'.repeat(64);

let work = '';
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'rede-required-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRequiredTenantSchemaForTests(undefined);
  rmSync(work, { recursive: true, force: true });
});

/** A manifest directory listing the given tenant versions (shuffled on purpose). */
function manifestDir(name: string, versions: string[]): string {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      tenant: versions.map((version) => ({ version, name: 'x', sha256: sha })),
      central: [],
      roles: { sha256: sha },
    }),
  );
  return dir;
}

const repoTenantVersions = () =>
  readdirSync(join(REPO, 'supabase', 'migrations'))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort();

describe('getRequiredTenantSchema: the resolution order', () => {
  it('the test override wins over the manifest and the repository, null included', () => {
    vi.stubEnv('MIGRATIONS_DIR', manifestDir('m', ['20260101000000']));
    setRequiredTenantSchemaForTests({ count: 7, head: '20270101000000' });
    expect(getRequiredTenantSchema()).toEqual({ count: 7, head: '20270101000000' });
    setRequiredTenantSchemaForTests(null);
    expect(getRequiredTenantSchema()).toBeNull();
    setRequiredTenantSchemaForTests(undefined);
    expect(getRequiredTenantSchema()).toEqual({ count: 1, head: '20260101000000' });
  });

  it('the image manifest answers { count, head } with the greatest version, whatever the list order', () => {
    vi.stubEnv(
      'MIGRATIONS_DIR',
      manifestDir('m', ['20260301000000', '20260101000000', '20260201000000']),
    );
    expect(getRequiredTenantSchema()).toEqual({ count: 3, head: '20260301000000' });
  });

  it('the manifest wins over the repository even outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MIGRATIONS_DIR', manifestDir('m', ['20260101000000']));
    expect(getRequiredTenantSchema()).toEqual({ count: 1, head: '20260101000000' });
  });

  it('outside production with no MIGRATIONS_DIR the requirement is derived from the repository files', () => {
    vi.stubEnv('MIGRATIONS_DIR', '');
    const versions = repoTenantVersions();
    expect(getRequiredTenantSchema()).toEqual({ count: versions.length, head: versions.at(-1) });
    expect(versions.length).toBeGreaterThan(100);
  });

  it('outside production and outside any repository the gate is off (null), never { count: 0 }', () => {
    vi.stubEnv('MIGRATIONS_DIR', '');
    vi.spyOn(process, 'cwd').mockReturnValue(work);
    expect(getRequiredTenantSchema()).toBeNull();
  });

  it('in production without a manifest it throws "migrations manifest empty" instead of returning null', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MIGRATIONS_DIR', '');
    expect(() => getRequiredTenantSchema()).toThrow('migrations manifest empty');
  });

  it('a manifest with no tenant file throws in every environment (P85: never { count: 0 })', () => {
    const dir = manifestDir('empty', []);
    vi.stubEnv('MIGRATIONS_DIR', dir);
    expect(() => getRequiredTenantSchema()).toThrow('migrations manifest empty');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getRequiredTenantSchema()).toThrow('migrations manifest empty');
  });

  it('a missing manifest file behind MIGRATIONS_DIR throws a named error', () => {
    vi.stubEnv('MIGRATIONS_DIR', join(work, 'nowhere'));
    expect(() => getRequiredTenantSchema()).toThrow('migrations manifest empty');
  });
});

describe('the test seam', () => {
  it('refuses to run outside NODE_ENV=test', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => setRequiredTenantSchemaForTests({ count: 1, head: '1' })).toThrow('test seam');
  });
});
