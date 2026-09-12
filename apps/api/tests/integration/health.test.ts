import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@tria/core/db';
import { afterAll, describe, expect, it } from 'vitest';
import { api } from './setup';

type Health = { ok: boolean; service: string; role: string; db?: boolean };

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));

afterAll(async () => {
  await sqlClient.end();
});

describe('GET /v1/health', () => {
  it('1. answers 200 without touching the database', async () => {
    const res = await api.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Health;
    expect(body).toMatchObject({ ok: true, service: 'api', role: 'api' });
    expect(body.db).toBeUndefined();
  });

  it('2. deep=1 runs select 1 through api_user and reports db: true', async () => {
    const res = await api.request('/v1/health?deep=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Health;
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
  });

  it('3. stays 200 in a fresh process whose DATABASE_URL points at a closed port', () => {
    const out = execFileSync(tsx, ['tests/integration/health-no-db.ts'], {
      cwd: apiRoot,
      // LOG_LEVEL=fatal keeps pino's request line off the child's stdout, which carries the body.
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://api_user:nope@127.0.0.1:1/postgres',
        LOG_LEVEL: 'fatal',
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(JSON.parse(out)).toMatchObject({ ok: true, service: 'api' });
  });

  it('4. deep=1 returns 500 with db: false when the database is unreachable', () => {
    let failed = false;
    try {
      execFileSync(tsx, ['tests/integration/health-no-db.ts', '--deep'], {
        cwd: apiRoot,
        // LOG_LEVEL=fatal keeps pino's request line off the child's stdout, which carries the body.
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://api_user:nope@127.0.0.1:1/postgres',
          LOG_LEVEL: 'fatal',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      failed = true;
      const stderr = String((err as { stderr?: string }).stderr ?? '');
      expect(stderr).toContain('"db":false');
      expect(stderr).toContain('500');
    }
    expect(failed).toBe(true);
  });
});
