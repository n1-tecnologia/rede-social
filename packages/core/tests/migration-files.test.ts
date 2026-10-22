import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationError } from '../server/migrations/runner';
import { MIGRATION_SETS, readMigrationDir } from '../server/migrations/sets';

/**
 * Phase 09.2-02 (DBT-32, D-547): how a migration directory is read. No database: temp directories only.
 * The runner applies exactly what this returns, so the naming rule, the order, the hash and the two
 * empty-set behaviours are pinned here.
 */
let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rede-migration-files-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readMigrationDir', () => {
  it('ignores meta/, a non-matching name and a directory; sorts by version', async () => {
    await mkdir(join(dir, 'meta'));
    await mkdir(join(dir, '20260101000000_looks_like_a_file.sql')); // a directory with a valid name
    await writeFile(join(dir, 'meta', '_journal.json'), '{}');
    await writeFile(join(dir, 'README.md'), 'not a migration');
    await writeFile(join(dir, 'notes.sql'), 'select 1');
    await writeFile(join(dir, '2026010100000_short.sql'), 'select 1'); // 13 digits
    await writeFile(join(dir, '20260101000000_Upper.sql'), 'select 1'); // capital letter
    await writeFile(join(dir, '20260301000000_third.sql'), 'select 3');
    await writeFile(join(dir, '20260101000001_first.sql'), 'select 1');
    await writeFile(join(dir, '20260201000000_second.sql'), 'select 2');

    const files = await readMigrationDir(dir, 'tenant');

    expect(files.map((f) => f.version)).toEqual([
      '20260101000001',
      '20260201000000',
      '20260301000000',
    ]);
    expect(files.map((f) => f.name)).toEqual(['first', 'second', 'third']);
    expect(files.every((f) => f.set === 'tenant')).toBe(true);
  });

  it('hashes the exact bytes: a byte-order mark changes the hash', async () => {
    await writeFile(join(dir, '20260101000000_plain.sql'), 'select 1;\n');
    await writeFile(join(dir, '20260101000001_bom.sql'), Buffer.from('﻿select 1;\n', 'utf8'));

    const [plain, bom] = await readMigrationDir(dir, 'tenant');

    expect(plain?.sha256).toBe(createHash('sha256').update('select 1;\n').digest('hex'));
    expect(bom?.sha256).not.toBe(plain?.sha256);
  });

  it('returns [] for an empty central directory and for a missing one', async () => {
    await expect(readMigrationDir(dir, 'central')).resolves.toEqual([]);
    await expect(readMigrationDir(join(dir, 'missing'), 'central')).resolves.toEqual([]);
  });

  it('refuses an empty or missing tenant directory with empty_set', async () => {
    await expect(readMigrationDir(dir, 'tenant')).rejects.toMatchObject({ code: 'empty_set' });
    await expect(readMigrationDir(join(dir, 'missing'), 'tenant')).rejects.toBeInstanceOf(
      MigrationError,
    );
  });

  it('P65: the same version in two sets is returned for each set on its own', async () => {
    const tenantDir = join(dir, 'tenant');
    const centralDir = join(dir, 'central');
    await mkdir(tenantDir);
    await mkdir(centralDir);
    await writeFile(join(tenantDir, '20260101000000_both.sql'), 'select 1');
    await writeFile(join(centralDir, '20260101000000_both.sql'), 'select 2');

    const [tenant] = await readMigrationDir(tenantDir, 'tenant');
    const [central] = await readMigrationDir(centralDir, 'central');

    expect(tenant?.version).toBe(central?.version);
    expect(tenant?.set).toBe('tenant');
    expect(central?.set).toBe('central');
    expect(tenant?.sha256).not.toBe(central?.sha256);
  });
});

describe('MIGRATION_SETS', () => {
  it('keeps two directories and two ledgers (D-547)', () => {
    expect(MIGRATION_SETS.tenant.relativeDir).toBe('supabase/migrations');
    expect(MIGRATION_SETS.central.relativeDir).toBe('supabase/central/migrations');
    expect(MIGRATION_SETS.tenant.ledger).toBe('supabase_migrations.schema_migrations');
    expect(MIGRATION_SETS.central.ledger).toBe('supabase_migrations.central_migrations');
  });

  it('a MigrationError message carries the code and the version only', () => {
    const error = new MigrationError('file_failed', '20260101000000');
    expect(error.message).toBe('file_failed:20260101000000');
    expect(new MigrationError('wrong_role').message).toBe('wrong_role');
  });
});
