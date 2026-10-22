import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@rede-social/core/db';
import { keyIdOf, openWith, sealWith } from '@rede-social/core/server/secrets/sealed';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminSql } from './setup';

// The command lives in the repo's `scripts/`, outside this package: a static import would leave the package
// and fail `turbo boundaries` (09.2-04 found it). The module is loaded by URL instead; its type is still checked.
const { resealAll, SEALED_COLUMNS } = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/reseal.ts', import.meta.url).href
)) as typeof import('../../../../scripts/reseal');

/**
 * D-539 / DBT-03 (09.2-03): `pnpm platform:reseal` rotates the registry's master key. These cases drive the
 * exported `resealAll` with their own keyring (so no process env matters), then the real command once, as a
 * child process, for the output, the flags and the exit code.
 *
 * Every row is a throwaway `platform.projects` row sealed by the test with a RANDOM ring, never the
 * development key, so nothing here can touch a real registry row's credentials: `resealAll` would FAIL (and
 * leave untouched) any foreign row it cannot open.
 */

const RUN = Date.now().toString(36);
const k1 = randomBytes(32);
const k2 = randomBytes(32);
const ring1 = new Map([[1, k1]]);
const ring12 = new Map([
  [1, k1],
  [2, k2],
]);

const PLAIN = {
  database_url_tx: 'postgres://api_user:tx-password-ZZ@db.one.test:6543/postgres',
  database_url_session: 'postgres://postgres:session-password-ZZ@db.one.test:5432/postgres',
  ddl_url: 'postgres://postgres:ddl-password-ZZ@db.one.test:5432/postgres',
  service_key: 'service-key-value-ZZ',
  hook_secret: 'v1,whsec_hook-secret-ZZ',
} as const;
const ALL_PLAINTEXTS = Object.values(PLAIN);

type Column = (typeof SEALED_COLUMNS)[number];
const plainOf = (column: Column) => PLAIN[column.replace(/_sealed$/, '') as keyof typeof PLAIN];

const created: string[] = [];

/** Inserts a throwaway project sealed under key id 1; `columns` picks which sealed columns it holds. */
async function insertProject(
  tag: string,
  columns: Column[] = [...SEALED_COLUMNS],
  tweak: (column: Column, sealed: string) => string = (_c, sealed) => sealed,
): Promise<string> {
  const id = crypto.randomUUID();
  const values: Record<Column, string | null> = {
    database_url_tx_sealed: null,
    database_url_session_sealed: null,
    ddl_url_sealed: null,
    service_key_sealed: null,
    hook_secret_sealed: null,
  };
  for (const column of columns) {
    const aad = `${id}:${column.replace(/_sealed$/, '')}`;
    values[column] = tweak(column, sealWith(ring1, 1, plainOf(column), aad));
  }
  const ref = `rs-${tag}-${RUN}`.slice(0, 40);
  await adminSql`
    insert into platform.projects
           (id, ref, provider, credential_source, state, api_url, secret_key_id, credential_version,
            database_url_tx_sealed, database_url_session_sealed, ddl_url_sealed,
            service_key_sealed, hook_secret_sealed)
    values (${id}::uuid, ${ref}, 'fake', 'sealed', 'ready', 'https://reseal.example.test', 1, 4,
            ${values.database_url_tx_sealed}, ${values.database_url_session_sealed},
            ${values.ddl_url_sealed}, ${values.service_key_sealed}, ${values.hook_secret_sealed})`;
  created.push(id);
  return id;
}

type Row = Record<Column, string | null> & { secret_key_id: number; credential_version: number };
const rowOf = async (id: string): Promise<Row> => {
  const [row] = await adminSql<Row[]>`
    select database_url_tx_sealed, database_url_session_sealed, ddl_url_sealed, service_key_sealed,
           hook_secret_sealed, secret_key_id, credential_version
      from platform.projects where id = ${id}::uuid`;
  if (!row) throw new Error('project row missing');
  return row;
};

async function clean(): Promise<void> {
  if (created.length > 0) {
    await adminSql`delete from platform.projects where id = any(${created}::uuid[])`;
    created.length = 0;
  }
}

beforeAll(clean);
afterEach(clean);
afterAll(async () => {
  await clean();
  await adminSql.end();
  await sqlClient.end();
});

describe('resealAll', () => {
  it('re-seals every sealed column under the current id and leaves credential_version alone', async () => {
    const a = await insertProject('a');
    const b = await insertProject('b', ['database_url_tx_sealed', 'service_key_sealed']);

    const summary = await resealAll(ring12, 2);
    expect(summary.failed).toBe(0);
    expect(summary.resealed).toBe(2);

    for (const [id, columns] of [
      [a, [...SEALED_COLUMNS]],
      [b, ['database_url_tx_sealed', 'service_key_sealed'] as Column[]],
    ] as const) {
      const row = await rowOf(id);
      expect(row.secret_key_id).toBe(2);
      expect(row.credential_version).toBe(4); // pools keyed on it stay valid
      for (const column of SEALED_COLUMNS) {
        const value = row[column];
        if (!columns.includes(column)) {
          expect(value).toBeNull();
          continue;
        }
        expect(value?.startsWith('v1:2:')).toBe(true);
        expect(keyIdOf(value as string)).toBe(2);
        // The plaintext still opens, and with the NEW key alone (the old one can be dropped).
        const aad = `${id}:${column.replace(/_sealed$/, '')}`;
        expect(openWith(ring12, value as string, aad)).toBe(plainOf(column));
        expect(openWith(new Map([[2, k2]]), value as string, aad)).toBe(plainOf(column));
      }
    }
  });

  it('is resumable: a second run reports resealed 0 and changes nothing', async () => {
    const id = await insertProject('resume');
    await resealAll(ring12, 2);
    const after = await rowOf(id);

    const second = await resealAll(ring12, 2);
    expect(second.resealed).toBe(0);
    expect(second.failed).toBe(0);
    expect(Object.values(second.byColumn).every((n) => n === 0)).toBe(true);
    expect(await rowOf(id)).toEqual(after);
    const mine = second.perRow.find((row) => row.id === id);
    expect(mine).toEqual({ id, columns: 0, from: [], to: 2 });
  });

  it('a row that fails to open (corrupted tag) is reported and leaves its columns untouched, the rest are done', async () => {
    const good = await insertProject('good');
    const bad = await insertProject('bad', [...SEALED_COLUMNS], (column, sealed) => {
      if (column !== 'ddl_url_sealed') return sealed;
      const parts = sealed.split(':');
      const tag = Buffer.from(parts[3] ?? '', 'base64url');
      tag[0] = (tag[0] ?? 0) ^ 0x01;
      parts[3] = tag.toString('base64url');
      return parts.join(':');
    });
    const before = await rowOf(bad);

    const summary = await resealAll(ring12, 2);
    expect(summary.failedIds).toContain(bad);
    expect(summary.failedIds).not.toContain(good);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.resealed).toBe(1);

    // ONE transaction per row: the corrupted row did not keep even its readable columns re-sealed.
    expect(await rowOf(bad)).toEqual(before);
    expect((await rowOf(good)).secret_key_id).toBe(2);
  });

  it('P7: rows are processed in ascending id order and the per-column counts come in the fixed column order', async () => {
    const ids = [await insertProject('o1'), await insertProject('o2'), await insertProject('o3')];
    const first = await resealAll(ring12, 2, { dryRun: true });
    const second = await resealAll(ring12, 2, { dryRun: true });

    const order = first.perRow.map((row) => row.id);
    expect(order).toEqual([...order].sort());
    expect(order.filter((id) => ids.includes(id))).toEqual([...ids].sort());
    // Two runs over the same state print identical reports.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(Object.keys(first.byColumn)).toEqual([...SEALED_COLUMNS]);
    expect(first.byColumn.database_url_tx_sealed).toBeGreaterThanOrEqual(3);
  });

  it('--dry-run opens everything and writes nothing', async () => {
    const id = await insertProject('dry');
    const before = await rowOf(id);
    const summary = await resealAll(ring12, 2, { dryRun: true });
    expect(summary.resealed).toBeGreaterThanOrEqual(1);
    expect(await rowOf(id)).toEqual(before);
  });

  it('P6: over zero re-sealable rows it reports 0 and fails nothing (project 0 holds no sealed column)', async () => {
    const summary = await resealAll(ring12, 2);
    expect(summary.resealed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(summary.rows);
  });

  it('refuses a ring that does not hold the current id', async () => {
    await expect(resealAll(ring1, 2)).rejects.toThrow('platform master keys invalid');
  });

  it('T-09.2-11: the report holds ids and numbers only, never a plaintext or a sealed value', async () => {
    const id = await insertProject('quiet');
    const summary = await resealAll(ring12, 2);
    const printed = JSON.stringify(summary);
    for (const plain of ALL_PLAINTEXTS) expect(printed).not.toContain(plain);
    expect(printed).not.toMatch(/v1:\d+:/);
    expect(printed).toContain(id);
  });
});

describe('the pnpm platform:reseal command', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const keys = JSON.stringify({ '1': k1.toString('base64'), '2': k2.toString('base64') });

  const run = (...flags: string[]) => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/reseal.ts', ...flags], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, PLATFORM_MASTER_KEYS: keys, PLATFORM_MASTER_KEY_ID: '2' },
    });
    return {
      status: result.status,
      lines: result.stdout.split('\n').filter(Boolean),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  it('prints ids and numbers only, exits 1 while a row cannot be opened and 0 once it is gone, and resumes', async () => {
    const good = await insertProject('cli-good');
    const bad = await insertProject('cli-bad', ['service_key_sealed'], (_c, sealed) =>
      sealed.slice(0, -2),
    );

    const dry = run('--dry-run');
    expect(dry.status).toBe(1);
    expect(JSON.parse(dry.lines.at(-1) as string)).toMatchObject({ dryRun: true });
    expect((await rowOf(good)).secret_key_id).toBe(1); // dry run wrote nothing

    const real = run();
    expect(real.status).toBe(1);
    const summary = JSON.parse(real.lines.at(-1) as string) as {
      resealed: number;
      failed: number;
      byColumn: Record<string, number>;
    };
    expect(summary.failed).toBe(1);
    expect(summary.resealed).toBe(1);
    expect(Object.keys(summary.byColumn)).toEqual([...SEALED_COLUMNS]);
    expect(real.lines).toContainEqual(JSON.stringify({ id: bad, failed: true }));
    for (const plain of ALL_PLAINTEXTS) {
      expect(real.stdout).not.toContain(plain);
      expect(real.stderr).not.toContain(plain);
    }
    expect(real.stdout).not.toMatch(/v1:\d+:/);
    expect((await rowOf(good)).secret_key_id).toBe(2);

    await adminSql`delete from platform.projects where id = ${bad}::uuid`;
    const again = run();
    expect(again.status).toBe(0);
    expect(JSON.parse(again.lines.at(-1) as string)).toMatchObject({ resealed: 0, failed: 0 });
  });
});
