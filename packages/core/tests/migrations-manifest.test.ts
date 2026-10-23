import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertManifestPresent,
  loadManifest,
  ManifestError,
  migrationDirs,
  summarize,
} from '../server/migrations/manifest';

/**
 * Phase 09.2-15 (DBT-44, D-547; P85, P86, P87): the manifest the image carries and the boot assertion. No
 * database: fixture repositories in temp directories and the real build script as a child process.
 */

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(REPO, 'scripts', 'build-migrations-manifest.mjs');

let work = '';
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'rede-manifest-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(work, { recursive: true, force: true });
});

/** A fixture repository: `tenant` and `central` file maps (name -> text), written in the order given. */
function repository(
  tenant: Record<string, string>,
  central: Record<string, string> = {},
  roles: string | null = 'create role x;\n',
): string {
  const root = join(work, 'repo');
  mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase', 'central', 'migrations'), { recursive: true });
  for (const [name, text] of Object.entries(tenant)) {
    writeFileSync(join(root, 'supabase', 'migrations', name), text);
  }
  for (const [name, text] of Object.entries(central)) {
    writeFileSync(join(root, 'supabase', 'central', 'migrations', name), text);
  }
  if (roles !== null) writeFileSync(join(root, 'supabase', 'roles.sql'), roles);
  return root;
}

const build = (root: string, out: string) =>
  spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out], { encoding: 'utf8' });

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** Every file under `dir`, relative path -> bytes. */
function snapshot(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshot(join(dir, entry.name), rel));
    else out[rel] = readFileSync(join(dir, entry.name)).toString('base64');
  }
  return out;
}

describe('the build script', () => {
  it('lists the files sorted by version whatever order they were created in (P86)', () => {
    // Created newest first, with a shuffled middle: the manifest must not follow the directory order.
    const root = repository({
      '20260301000000_third.sql': 'select 3;\n',
      '20260101000000_first.sql': 'select 1;\n',
      '20260201000000_second.sql': 'select 2;\n',
      '20260101000001_first_b.sql': 'select 11;\n',
    });
    const out = join(work, 'out');
    expect(build(root, out).status).toBe(0);
    const manifest = loadManifest(out);
    expect(manifest.tenant.map((entry) => entry.version)).toEqual([
      '20260101000000',
      '20260101000001',
      '20260201000000',
      '20260301000000',
    ]);
    expect(manifest.tenant.map((entry) => entry.name)).toEqual([
      'first',
      'first_b',
      'second',
      'third',
    ]);
  });

  it('copies every file byte for byte and hashes it (BOM, CRLF and non-ASCII included)', () => {
    const tricky = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('select 1;\r\n-- ç\r\n'),
    ]);
    const root = repository({ '20260101000000_first.sql': 'select 1;\n' });
    writeFileSync(join(root, 'supabase', 'migrations', '20260102000000_tricky.sql'), tricky);
    writeFileSync(
      join(root, 'supabase', 'central', 'migrations', '20260105000000_central.sql'),
      'select 5;\n',
    );
    const out = join(work, 'out');
    expect(build(root, out).status).toBe(0);

    expect(readFileSync(join(out, 'tenant', '20260102000000_tricky.sql')).equals(tricky)).toBe(
      true,
    );
    const manifest = loadManifest(out);
    expect(manifest.tenant[1]?.sha256).toBe(sha(tricky));
    expect(manifest.central).toEqual([
      { version: '20260105000000', name: 'central', sha256: sha('select 5;\n') },
    ]);
    expect(manifest.roles.sha256).toBe(sha('create role x;\n'));
    expect(readFileSync(join(out, 'roles.sql'), 'utf8')).toBe('create role x;\n');
  });

  it('ignores meta/, a README and a name that is not a migration', () => {
    const root = repository({ '20260101000000_first.sql': 'select 1;\n' });
    const dir = join(root, 'supabase', 'migrations');
    mkdirSync(join(dir, 'meta'));
    writeFileSync(join(dir, 'meta', '_journal.json'), '{}');
    writeFileSync(join(dir, 'README.md'), 'x');
    writeFileSync(join(dir, 'notes.sql'), 'select 1');
    writeFileSync(join(dir, '2026010100000_short.sql'), 'select 1');
    const out = join(work, 'out');
    expect(build(root, out).status).toBe(0);
    expect(readdirSync(join(out, 'tenant'))).toEqual(['20260101000000_first.sql']);
    expect(loadManifest(out).tenant).toHaveLength(1);
  });

  it('builds byte-identical output twice, with no timestamp and no absolute path (P87)', () => {
    const root = repository(
      { '20260101000000_first.sql': 'select 1;\n', '20260201000000_second.sql': 'select 2;\n' },
      { '20260105000000_central.sql': 'select 5;\n' },
    );
    const one = join(work, 'one');
    const two = join(work, 'two');
    expect(build(root, one).status).toBe(0);
    expect(build(root, two).status).toBe(0);
    expect(snapshot(one)).toEqual(snapshot(two));

    const text = readFileSync(join(one, 'manifest.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toContain(root);
    expect(text).not.toContain(work);
    expect(text).not.toMatch(/\/(Users|home|tmp|var)\//);
    // Stable key order.
    expect(Object.keys(JSON.parse(text))).toEqual(['tenant', 'central', 'roles']);
  });

  it('rebuilding into a directory that already holds an older build leaves no stale file', () => {
    const root = repository({
      '20260101000000_first.sql': 'select 1;\n',
      '20260201000000_second.sql': 'select 2;\n',
    });
    const out = join(work, 'out');
    expect(build(root, out).status).toBe(0);
    rmSync(join(root, 'supabase', 'migrations', '20260201000000_second.sql'));
    expect(build(root, out).status).toBe(0);
    expect(readdirSync(join(out, 'tenant'))).toEqual(['20260101000000_first.sql']);
    expect(loadManifest(out).tenant).toHaveLength(1);
  });

  it('refuses an empty tenant directory, a missing tenant directory and a missing roles.sql', () => {
    const empty = repository({});
    const refused = build(empty, join(work, 'out-empty'));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('no migration file');

    const missingRoles = join(work, 'other');
    mkdirSync(join(missingRoles, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(
      join(missingRoles, 'supabase', 'migrations', '20260101000000_first.sql'),
      'select 1;\n',
    );
    expect(build(missingRoles, join(work, 'out-no-roles')).status).toBe(1);

    const noTenantDir = join(work, 'bare');
    mkdirSync(noTenantDir, { recursive: true });
    expect(build(noTenantDir, join(work, 'out-bare')).status).toBe(1);
  });

  it('an empty central directory is legitimate', () => {
    const root = repository({ '20260101000000_first.sql': 'select 1;\n' });
    rmSync(join(root, 'supabase', 'central'), { recursive: true });
    const out = join(work, 'out');
    expect(build(root, out).status).toBe(0);
    expect(loadManifest(out).central).toEqual([]);
  });

  it('is a usage error (exit 2) without --root and --out', () => {
    expect(execFileSyncStatus(['--root', work])).toBe(2);
    expect(execFileSyncStatus([])).toBe(2);
  });

  it('builds the real repository: every tenant file and a head equal to the newest file', () => {
    const out = join(work, 'real');
    expect(build(REPO, out).status).toBe(0);
    const files = readdirSync(join(REPO, 'supabase', 'migrations')).filter((name) =>
      /^\d{14}_[a-z0-9_]+\.sql$/.test(name),
    );
    const manifest = loadManifest(out);
    expect(manifest.tenant).toHaveLength(files.length);
    expect(manifest.tenant.at(-1)?.version).toBe(files.sort().at(-1)?.slice(0, 14));
  });
});

function execFileSyncStatus(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('loadManifest and summarize', () => {
  it('reads what the script wrote and summarises the tenant list', () => {
    const root = repository({
      '20260201000000_second.sql': 'select 2;\n',
      '20260101000000_first.sql': 'select 1;\n',
    });
    const out = join(work, 'out');
    build(root, out);
    const manifest = loadManifest(out);
    expect(summarize(manifest.tenant.map((entry) => entry.version))).toEqual({
      count: 2,
      head: '20260201000000',
    });
  });

  it('summarize takes the greatest version, not the last in the list, and nothing for an empty list', () => {
    expect(summarize(['20260301000000', '20260101000000'])).toEqual({
      count: 2,
      head: '20260301000000',
    });
    expect(summarize([])).toBeNull();
  });

  it('a missing, unreadable or malformed manifest is a ManifestError, never an ENOENT', () => {
    expect(() => loadManifest(join(work, 'nope'))).toThrow(ManifestError);
    expect(() => loadManifest(join(work, 'nope'))).toThrow('migrations manifest empty');
    mkdirSync(join(work, 'bad'));
    writeFileSync(join(work, 'bad', 'manifest.json'), '{ not json');
    expect(() => loadManifest(join(work, 'bad'))).toThrow('migrations manifest invalid');
    writeFileSync(
      join(work, 'bad', 'manifest.json'),
      JSON.stringify({ tenant: [{ version: 'x' }] }),
    );
    expect(() => loadManifest(join(work, 'bad'))).toThrow(ManifestError);
  });
});

describe('migrationDirs', () => {
  it('uses MIGRATIONS_DIR when set', () => {
    vi.stubEnv('MIGRATIONS_DIR', '/app/migrations');
    expect(migrationDirs()).toEqual({
      tenant: '/app/migrations/tenant',
      central: '/app/migrations/central',
      roles: '/app/migrations/roles.sql',
    });
  });

  it('finds the repository by walking up from the working directory otherwise', () => {
    vi.stubEnv('MIGRATIONS_DIR', '');
    const dirs = migrationDirs();
    expect(dirs.tenant).toBe(join(REPO, 'supabase', 'migrations').replace(/\/$/, ''));
    expect(dirs.central).toBe(join(REPO, 'supabase', 'central', 'migrations'));
  });
});

describe('assertManifestPresent (P85)', () => {
  it('a production boot with no MIGRATIONS_DIR stops with "migrations manifest empty"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MIGRATIONS_DIR', '');
    expect(() => assertManifestPresent()).toThrow('migrations manifest empty');
  });

  it('a production boot whose manifest file is missing or unreadable stops', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MIGRATIONS_DIR', join(work, 'missing'));
    expect(() => assertManifestPresent()).toThrow('migrations manifest empty');
    mkdirSync(join(work, 'junk'));
    writeFileSync(join(work, 'junk', 'manifest.json'), 'not json');
    vi.stubEnv('MIGRATIONS_DIR', join(work, 'junk'));
    expect(() => assertManifestPresent()).toThrow(ManifestError);
  });

  it('a production boot whose manifest lists no tenant file stops', () => {
    mkdirSync(join(work, 'emptylist'));
    writeFileSync(
      join(work, 'emptylist', 'manifest.json'),
      JSON.stringify({ tenant: [], central: [], roles: { sha256: sha('x') } }),
    );
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MIGRATIONS_DIR', join(work, 'emptylist'));
    expect(() => assertManifestPresent()).toThrow('migrations manifest empty');
  });

  it('a production boot with a real manifest passes, and outside production nothing is asserted', () => {
    const root = repository({ '20260101000000_first.sql': 'select 1;\n' });
    const out = join(work, 'out');
    build(root, out);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MIGRATIONS_DIR', out);
    expect(() => assertManifestPresent()).not.toThrow();

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MIGRATIONS_DIR', '');
    expect(() => assertManifestPresent()).not.toThrow();
  });

  it('main.ts calls the assertion before it picks a role, so the api, worker and migrate branches are all covered', () => {
    const main = readFileSync(join(REPO, 'apps', 'api', 'src', 'main.ts'), 'utf8');
    const assertion = main.indexOf('assertManifestPresent();');
    expect(assertion).toBeGreaterThan(-1);
    expect(assertion).toBeLessThan(main.indexOf("env.ROLE === 'migrate'"));
    expect(assertion).toBeLessThan(main.indexOf("env.ROLE === 'worker'"));
  });
});
