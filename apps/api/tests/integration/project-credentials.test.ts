import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { databaseOverviewSchema, replaceCredentialsAnswerSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { AccessDeps } from '@rede-social/core/server/projects/access';
import {
  listSteps,
  resumeBootstrap,
  runBootstrap,
} from '@rede-social/core/server/projects/bootstrap';
import { PROJECT_BOOTSTRAP_QUEUE } from '@rede-social/core/server/projects/bootstrap-job';
import { replaceCredentials } from '@rede-social/core/server/projects/credentials';
import type { FakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import { BOOTSTRAP_STEPS } from '@rede-social/core/server/projects/reasons';
import { ReissueError, reissueCredentials } from '@rede-social/core/server/projects/reissue';
import { open } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  resolveProject,
  resolveProjectById,
} from '@rede-social/core/server/tenancy/project-registry';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bootstrapDeps,
  connectToB,
  createReadyTenant,
  fakeProvider,
  fakeTarget,
  ROOT,
  resetB,
  restoreB,
} from './projects-setup';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Every line any logger writes in this file is captured, so the secrets scan reads what a person tailing the
 * logs would see (T-09.2-67). The mock replaces the ONE root logger every kernel and API logger derives from.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item,
    );
  const make = (bindings: Record<string, unknown>): unknown => {
    const record = (...args: unknown[]) => {
      captured.lines.push(text([bindings, ...args]));
    };
    return {
      info: record,
      warn: record,
      error: record,
      debug: record,
      trace: record,
      fatal: record,
      level: 'trace',
      bindings: () => bindings,
      child: (extra: Record<string, unknown>) => make({ ...bindings, ...extra }),
    };
  };
  const rootLogger = make({});
  return {
    ...real,
    rootLogger,
    moduleLogger: (name: string) =>
      (rootLogger as { child: (b: object) => unknown }).child({ name }),
  };
});

/**
 * Phase 09.2-14 (DBT-02, DBT-40, DBT-47, D-539, P4, P77, P93, P94): replacing a project's credentials safely and
 * re-deriving them through the platform token alone. Real routes, kernel, registry, sealing and bootstrap
 * engine against the FAKE provider mapped to the second local database `rede_tenant_b`.
 */

const RUN = Date.now().toString(36);
const QUEUE = PROJECT_BOOTSTRAP_QUEUE;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const REF_A = `pc-a-${RUN}`;
const REF_B = `pc-b-${RUN}`;
const SLUG_A = `pc-a-${RUN}`;
const SLUG_B = `pc-b-${RUN}`;

const provider: FakeProjectProvider = fakeProvider({
  [REF_A]: fakeTarget(),
  [REF_B]: fakeTarget(),
});

const REAL = {
  serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  databasePassword: 'postgres',
};

const tokens = { superAdmin: '', tenantAdmin: '', member: '' };
const actor = { userId: crypto.randomUUID() };
const noCheck = () => undefined;

async function put(tenantId: string, body: unknown, token: string | null = tokens.superAdmin) {
  const res = await api.request(`/v1/platform/tenants/${tenantId}/database/credentials`, {
    method: 'PUT',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { res, text: await res.text() };
}

type Registry = Record<string, unknown>;
const registryOf = async (projectId: string): Promise<Registry> => {
  const [row] = await adminSql<Registry[]>`
    select ref, state, provider, api_url, hook_ref, plan, publishable_key, service_key_kind,
           secret_key_id, credential_version, ddl_url_sealed, database_url_tx_sealed,
           database_url_session_sealed, service_key_sealed, hook_secret_sealed, updated_at::text as updated_at
      from platform.projects where id = ${projectId}::uuid`;
  return row ?? {};
};
const SEALED = [
  'ddl_url_sealed',
  'database_url_tx_sealed',
  'database_url_session_sealed',
  'service_key_sealed',
  'hook_secret_sealed',
] as const;
const unchanged = (before: Registry, after: Registry, columns: readonly string[]) => {
  for (const column of columns) expect(after[column], column).toBe(before[column]);
};

async function cleanup(): Promise<void> {
  await adminSql`delete from public.tenants where slug in (${SLUG_A}, ${SLUG_B})`;
  await adminSql`
    delete from pgboss_platform.job
     where name = ${QUEUE}
       and data->>'projectId' in (select id::text from platform.projects where ref in (${REF_A}, ${REF_B}))`;
  await adminSql`delete from platform.projects where ref in (${REF_A}, ${REF_B})`;
  await adminSql`
    delete from public.access_grants where email like ${`admin-pc-%-${RUN}@rede-social-test.local`}`;
}

let tenantId = '';
let projectId = '';

beforeAll(async () => {
  if (!SEED_PASSWORD || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_PASSWORD and SUPER_ADMIN_PASSWORD are required (same values as the seed)',
    );
  }
  await cleanup();
  resetB();
  setProjectProviderForTests(provider);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.tenantAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  ({ tenantId, projectId } = await createReadyTenant(provider, REF_A, SLUG_A));
  captured.lines.length = 0;
}, 180_000);

afterAll(async () => {
  setProjectProviderForTests(undefined);
  await cleanup();
  await adminSql`alter role api_user with login password 'postgres'`;
  await stopBoss();
  await closeAllPools();
  await adminSql.end();
  await sqlClient.end();
  restoreB();
});

// ---------------------------------------------------------------------------------------------------------
// Replace credentials: validate first, replace entirely (D-539, DBT-40, T-09.2-70)
// ---------------------------------------------------------------------------------------------------------

describe('PUT /v1/platform/tenants/{id}/database/credentials', () => {
  it('validate-before-replace: a wrong value of each kind answers access: invalid and changes nothing at all', async () => {
    const before = await registryOf(projectId);
    for (const bad of [
      { databasePassword: 'wrong-password' },
      { serviceKey: 'wrong-service-key' },
      { publishableKey: 'wrong-publishable-key' },
    ]) {
      const { res, text } = await put(tenantId, bad);
      expect(res.status, JSON.stringify(Object.keys(bad))).toBe(400);
      const error = (JSON.parse(text) as { error: { code: string; details: unknown } }).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ access: 'invalid' });
      // The refusal names no value.
      for (const secret of Object.values(bad)) expect(text).not.toContain(secret);
      // The sealed columns, the version and the timestamp are byte-identical afterwards.
      expect(await registryOf(projectId)).toEqual(before);
    }
  });

  it('a body with one good value and one bad one is refused as a whole', async () => {
    const before = await registryOf(projectId);
    const { res } = await put(tenantId, {
      serviceKey: REAL.serviceKey,
      publishableKey: 'wrong-publishable-key',
    });
    expect(res.status).toBe(400);
    expect(await registryOf(projectId)).toEqual(before);
  });

  it('a correct subset replaces only its own columns and advances the version by exactly one', async () => {
    // service key only
    let before = await registryOf(projectId);
    let { res, text } = await put(tenantId, { serviceKey: REAL.serviceKey });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(replaceCredentialsAnswerSchema.parse(JSON.parse(text))).toEqual({ ok: true });
    expect(text).not.toContain(REAL.serviceKey);
    let after = await registryOf(projectId);
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
    expect(open(after.service_key_sealed as string, `${projectId}:service_key`)).toBe(
      REAL.serviceKey,
    );
    unchanged(before, after, [
      'ddl_url_sealed',
      'database_url_tx_sealed',
      'database_url_session_sealed',
      'hook_secret_sealed',
      'publishable_key',
      'ref',
      'api_url',
      'state',
    ]);

    // password only: the stored DDL coordinates are kept, the password is the new one
    before = after;
    ({ res, text } = await put(tenantId, { databasePassword: REAL.databasePassword }));
    expect(res.status).toBe(200);
    after = await registryOf(projectId);
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
    const ddl = new URL(open(after.ddl_url_sealed as string, `${projectId}:ddl_url`));
    expect(ddl.username).toBe('postgres');
    expect(decodeURIComponent(ddl.password)).toBe('postgres');
    expect(`${ddl.hostname}:${ddl.port}${ddl.pathname}`).toBe('127.0.0.1:54322/rede_tenant_b');
    unchanged(before, after, [
      'service_key_sealed',
      'database_url_tx_sealed',
      'database_url_session_sealed',
      'hook_secret_sealed',
      'publishable_key',
    ]);

    // publishable key only (a plain column)
    before = after;
    ({ res } = await put(tenantId, { publishableKey: REAL.publishableKey }));
    expect(res.status).toBe(200);
    after = await registryOf(projectId);
    expect(after.publishable_key).toBe(REAL.publishableKey);
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
    unchanged(before, after, ['service_key_sealed', 'ddl_url_sealed', 'database_url_tx_sealed']);
  });

  it('all three at once is ONE replacement: the version moves by one', async () => {
    const before = await registryOf(projectId);
    const { res } = await put(tenantId, REAL);
    expect(res.status).toBe(200);
    const after = await registryOf(projectId);
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
    unchanged(before, after, [
      'database_url_tx_sealed',
      'database_url_session_sealed',
      'hook_secret_sealed',
    ]);
  });

  it('a body that is not a non-empty subset of the three fields is a 400 and changes nothing', async () => {
    const before = await registryOf(projectId);
    for (const body of [
      {},
      { serviceKey: '' },
      { serviceKey: '   ', databasePassword: '' },
      { serviceKey: 'k', token: 'x' },
      { serviceKey: 42 },
      [],
      'text',
    ]) {
      const { res, text } = await put(tenantId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(await registryOf(projectId)).toEqual(before);
  });

  it('an unknown tenant is a 404, the central project’s tenant a 409, and nobody but a super_admin is served', async () => {
    expect((await put(crypto.randomUUID(), REAL)).res.status).toBe(404);
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    const central = await put(demo?.id ?? '', { serviceKey: REAL.serviceKey });
    expect(central.res.status).toBe(409);
    for (const token of [tokens.tenantAdmin, tokens.member]) {
      expect((await put(tenantId, REAL, token)).res.status).toBe(403);
    }
    expect((await put(tenantId, REAL, null)).res.status).toBe(401);
  });

  it('P4: two simultaneous replacements serialise on the project lock; the later one wins ENTIRELY', async () => {
    const before = await registryOf(projectId);
    let active = 0;
    let max = 0;
    const slow = async (): Promise<boolean> => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 150));
      active -= 1;
      return true;
    };
    const access: AccessDeps = {
      connect: () => {
        throw new Error('the password is not part of this case');
      },
      serviceKeyWorks: slow,
      publishableKeyWorks: slow,
    };
    const order: string[] = [];
    const run = (tag: string, key: string, pub: string) =>
      replaceCredentials(tenantId, { serviceKey: key, publishableKey: pub }, actor, {
        access,
        startCheck: noCheck,
      }).then((result) => {
        order.push(tag);
        return result;
      });

    const [a, b] = await Promise.all([
      run('A', 'sb_secret_AAAA', 'publishable-AAAA'),
      run('B', 'sb_secret_BBBB', 'publishable-BBBB'),
    ]);

    // Never two validations at once: the lock covers validate-then-write.
    expect(max).toBe(1);
    // The version advanced once per call, in sequence.
    expect([a.credentialVersion, b.credentialVersion].sort()).toEqual([
      (before.credential_version as number) + 1,
      (before.credential_version as number) + 2,
    ]);
    // The last to finish owns the whole set: the service key and the publishable key come from ONE call.
    const winner = order.at(-1);
    const after = await registryOf(projectId);
    expect(after.credential_version).toBe((before.credential_version as number) + 2);
    expect(open(after.service_key_sealed as string, `${projectId}:service_key`)).toBe(
      winner === 'A' ? 'sb_secret_AAAA' : 'sb_secret_BBBB',
    );
    expect(after.publishable_key).toBe(winner === 'A' ? 'publishable-AAAA' : 'publishable-BBBB');

    // Put the project back on its real keys, through the real validators.
    expect((await put(tenantId, REAL)).res.status).toBe(200);
  });

  it('the lane after a replacement runs on the new credential version and still serves', async () => {
    const detail = () =>
      api.request(`/v1/platform/tenants/${tenantId}`, {
        headers: { authorization: `Bearer ${tokens.superAdmin}` },
      });
    expect((await detail()).status).toBe(200);
    const first = await resolveProject(tenantId);

    expect((await put(tenantId, { serviceKey: REAL.serviceKey })).res.status).toBe(200);
    const second = await resolveProject(tenantId);
    expect(second.credentialVersion).toBe(first.credentialVersion + 1);
    // The tenant lane (invites and admins of the project) opens on the new version and answers.
    expect((await detail()).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Break-glass: reissue (DBT-47, P93, P94)
// ---------------------------------------------------------------------------------------------------------

describe('reissueCredentials: the whole set from the platform token alone (DBT-47)', () => {
  const deps = () => ({ ...bootstrapDeps(provider), startCheck: noCheck });
  const reissue = (overrides: Record<string, unknown> = {}) => {
    const base = deps();
    return reissueCredentials(projectId, {
      provider,
      connect: base.connect as never,
      secrets: base.secrets as never,
      startCheck: noCheck,
      ...overrides,
    });
  };
  const loginWorks = async (url: string) => {
    const probe = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
    try {
      const [row] = await probe<{ u: string }[]>`select current_user as u`;
      return row?.u === 'api_user';
    } finally {
      await probe.end({ timeout: 5 });
    }
  };

  it('P93: ends with a working set twice in a row, changing only the sealed values and the version', async () => {
    captured.lines.length = 0;
    const before = await registryOf(projectId);
    const passwordsBefore = provider.calls.passwords.length;

    const first = await reissue();
    expect(first).toEqual({
      status: 'reissued',
      credentialVersion: (before.credential_version as number) + 1,
    });
    const mid = await registryOf(projectId);
    for (const column of SEALED) expect(mid[column], column).not.toBe(before[column]);
    // Everything that is not a credential is exactly as it was.
    unchanged(before, mid, ['ref', 'api_url', 'state', 'provider', 'hook_ref', 'plan']);
    expect(mid.publishable_key).toBe(`fake_publishable_${REF_A}`);

    // The new set works: the keys are the provider's, the DDL password is the one that was set, api_user logs in.
    expect(open(mid.service_key_sealed as string, `${projectId}:service_key`)).toBe(
      `fake_secret_${REF_A}`,
    );
    const newPassword = provider.calls.passwords.at(-1)?.password ?? '';
    expect(provider.calls.passwords).toHaveLength(passwordsBefore + 1);
    expect(open(mid.ddl_url_sealed as string, `${projectId}:ddl_url`)).toContain(
      encodeURIComponent(newPassword),
    );
    for (const [column, name] of [
      ['database_url_tx_sealed', 'database_url_tx'],
      ['database_url_session_sealed', 'database_url_session'],
    ] as const) {
      expect(await loginWorks(open(mid[column] as string, `${projectId}:${name}`))).toBe(true);
    }
    // The hook secret was written to the project's Auth configuration and sealed under the same value.
    const hookPatches = (provider.calls.patches[REF_A] ?? []).filter(
      (patch) => patch.target === 'auth' && 'hook_send_email_secrets' in patch.body,
    );
    const lastHook = hookPatches.at(-1)?.body.hook_send_email_secrets;
    expect(open(mid.hook_secret_sealed as string, `${projectId}:hook_secret`)).toBe(lastHook);

    // The second clean run ends the same way: another version, other sealed values, the rest untouched.
    const second = await reissue();
    expect(second).toEqual({
      status: 'reissued',
      credentialVersion: (before.credential_version as number) + 2,
    });
    const after = await registryOf(projectId);
    for (const column of SEALED) expect(after[column], column).not.toBe(mid[column]);
    unchanged(mid, after, [
      'ref',
      'api_url',
      'state',
      'provider',
      'hook_ref',
      'plan',
      'publishable_key',
    ]);
    expect(
      await loginWorks(
        open(after.database_url_tx_sealed as string, `${projectId}:database_url_tx`),
      ),
    ).toBe(true);

    // No log line of either run holds a credential (PR-4): not the passwords, the keys, the secrets or a URL.
    const everything = captured.lines.join('\n');
    const secrets = [
      newPassword,
      provider.calls.passwords.at(-2)?.password ?? '',
      `fake_secret_${REF_A}`,
      String(lastHook),
    ];
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(0);
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/postgres:\/\/|sb_secret_/);
  }, 120_000);

  it('P93: an interruption between the provider calls and the store leaves the registry as it was, and a clean run recovers', async () => {
    const before = await registryOf(projectId);
    await expect(
      reissue({
        beforeStore: () => {
          throw new Error('interrupted after the provider calls');
        },
      }),
    ).rejects.toBeInstanceOf(ReissueError);
    // Nothing was stored: not a column, not the version.
    expect(await registryOf(projectId)).toEqual(before);

    // The project's password HAS changed upstream by now (the provider call is not transactional); the next
    // run does not depend on what was stored, so it ends with a working set.
    const recovered = await reissue();
    expect(recovered.status).toBe('reissued');
    const after = await registryOf(projectId);
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
    expect(
      await loginWorks(
        open(after.database_url_tx_sealed as string, `${projectId}:database_url_tx`),
      ),
    ).toBe(true);
  }, 120_000);

  it('never reads the stored credentials: with every sealed column corrupted it still succeeds', async () => {
    await adminSql`
      update platform.projects
         set ddl_url_sealed = 'v1:1:corrupt', database_url_tx_sealed = 'garbage',
             database_url_session_sealed = '', service_key_sealed = 'v1:99:a:b:c',
             hook_secret_sealed = 'not sealed at all'
       where id = ${projectId}::uuid`;
    const result = await reissue();
    expect(result.status).toBe('reissued');
    const after = await registryOf(projectId);
    for (const [column, name] of [
      ['ddl_url_sealed', 'ddl_url'],
      ['database_url_tx_sealed', 'database_url_tx'],
      ['database_url_session_sealed', 'database_url_session'],
      ['service_key_sealed', 'service_key'],
      ['hook_secret_sealed', 'hook_secret'],
    ] as const) {
      expect(() => open(after[column] as string, `${projectId}:${name}`), column).not.toThrow();
    }
    expect(
      await loginWorks(
        open(after.database_url_session_sealed as string, `${projectId}:database_url_session`),
      ),
    ).toBe(true);
    // The pools and the admin client read the new set.
    const record = await resolveProjectById(projectId);
    expect(record?.serviceKeySealed).toBe(after.service_key_sealed);
  }, 120_000);

  it('P94: a bootstrap step that is running answers busy and changes nothing; an expired lease does not block', async () => {
    await adminSql`
      update platform.project_bootstrap_steps
         set status = 'running', started_at = now()
       where project_id = ${projectId}::uuid and step = 'invite'`;
    try {
      const before = await registryOf(projectId);
      expect(await reissue()).toEqual({ status: 'busy' });
      expect(await registryOf(projectId)).toEqual(before);

      // A crashed run (lease older than 15 minutes) is not a live run.
      await adminSql`
        update platform.project_bootstrap_steps
           set started_at = now() - interval '20 minutes'
         where project_id = ${projectId}::uuid and step = 'invite'`;
      expect((await reissue()).status).toBe('reissued');
    } finally {
      await adminSql`
        update platform.project_bootstrap_steps set status = 'done', finished_at = now()
         where project_id = ${projectId}::uuid and step = 'invite'`;
    }
  }, 120_000);

  it('P94: a reissue while another holds the project lock answers busy; the first still completes once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const before = await registryOf(projectId);

    const first = reissue({
      beforeStore: async () => {
        entered();
        await gate;
      },
    });
    await inside;
    expect(await reissue()).toEqual({ status: 'busy' });
    release();
    expect((await first).status).toBe('reissued');

    const after = await registryOf(projectId);
    // Exactly one of the two changed anything.
    expect(after.credential_version).toBe((before.credential_version as number) + 1);
  }, 120_000);

  it('refuses the central project and an unknown one with a catalog code, naming nothing', async () => {
    const [central] = await adminSql<
      { id: string }[]
    >`select id from platform.projects where is_central`;
    await expect(
      reissueCredentials(central?.id ?? '', { startCheck: noCheck }),
    ).rejects.toBeInstanceOf(ReissueError);
    await expect(
      reissueCredentials(crypto.randomUUID(), { startCheck: noCheck }),
    ).rejects.toBeInstanceOf(ReissueError);
  });

  it('the command takes exactly `--ref <ref>` (or --ref=<ref>) and nothing else', async () => {
    // A script outside the package is loaded by URL, like the probe's test does.
    const { parseReissueArgs } = (await import(
      pathToFileURL(resolve(ROOT, 'scripts/reissue-credentials.ts')).href
    )) as {
      parseReissueArgs: (argv: string[]) => { ref: string } | { error: string };
    };
    expect(parseReissueArgs(['--', '--ref', 'abcdefghijklmnopqrst'])).toEqual({
      ref: 'abcdefghijklmnopqrst',
    });
    expect(parseReissueArgs(['--ref=abcdefghijklmnopqrst'])).toEqual({
      ref: 'abcdefghijklmnopqrst',
    });
    for (const bad of [
      [],
      ['--ref'],
      ['--ref', ''],
      ['--ref', 'Not A Ref'],
      ['--ref', 'a'],
      ['--all'],
      ['abc'],
    ]) {
      expect('error' in parseReissueArgs(bad), JSON.stringify(bad)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// A bootstrap claimed after a finished reissue uses the new credentials (P94)
// ---------------------------------------------------------------------------------------------------------

describe('a bootstrap that resumes after a reissue uses the NEW credentials (P94)', () => {
  it('the DDL URL a resumed step opens is the one the reissue stored, not the one it replaced', async () => {
    // A bare database again: this project goes through verify and roles, fails at schema, is reissued, resumed.
    resetB();
    const made = await createReadyTenant(provider, REF_B, SLUG_B, { run: false });
    const failing = fakeProvider(
      { [REF_B]: fakeTarget() },
      { failAt: { step: 'schema', times: 1 } },
    );
    expect(await runBootstrap(made.projectId, bootstrapDeps(failing))).toMatchObject({
      status: 'failed',
      step: 'schema',
    });
    const beforeRow = await registryOf(made.projectId);
    const oldDdl = open(beforeRow.ddl_url_sealed as string, `${made.projectId}:ddl_url`);

    const base = bootstrapDeps(failing);
    const reissued = await reissueCredentials(made.projectId, {
      provider: failing,
      connect: connectToB,
      secrets: base.secrets as never,
      startCheck: noCheck,
    });
    expect(reissued.status).toBe('reissued');
    const afterRow = await registryOf(made.projectId);
    const newDdl = open(afterRow.ddl_url_sealed as string, `${made.projectId}:ddl_url`);
    expect(newDdl).not.toBe(oldDdl);

    await resumeBootstrap(made.projectId);
    const urls: string[] = [];
    const resumed = bootstrapDeps(failing, {
      connect: (kind, url) => {
        if (kind === 'ddl') urls.push(url);
        return connectToB(kind, url);
      },
    });
    expect(await runBootstrap(made.projectId, resumed)).toEqual({ status: 'ready' });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url === newDdl)).toBe(true);
    expect(urls).not.toContain(oldDdl);
    expect((await listSteps(made.projectId)).map((row) => row.status)).toEqual(
      BOOTSTRAP_STEPS.map(() => 'done'),
    );
    const view = databaseOverviewSchema.safeParse(
      await (
        await api.request(`/v1/platform/tenants/${made.tenantId}/database`, {
          headers: { authorization: `Bearer ${tokens.superAdmin}` },
        })
      ).json(),
    );
    expect(view.success).toBe(true);
  }, 180_000);
});
