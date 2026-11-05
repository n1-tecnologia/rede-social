import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tenantBuildSchema } from '@rede-social/contracts/native';
import { sqlClient } from '@rede-social/core/db';
import { replaceAppCredential } from '@rede-social/core/server/apps/index';
import { open } from '@rede-social/core/server/secrets/sealed';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminSql } from './setup';

// The command lives in the repo's `scripts/`, outside this package: it is loaded by URL (a static import would
// leave the package and fail `turbo boundaries`, as `reseal.test.ts` found); its types are still checked.
const release = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/index.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/index');
const signing = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/signing.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/signing');
const fakeStoresModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/fake-stores.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/fake-stores');
const appleModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/store-apple.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/store-apple');
type Tools = import('../../../../scripts/app-release/signing').ToolRunner;

/**
 * Phase 13-29 (D-605, D-619, NATIVE-02, NATIVE-28, T-13-50): `pnpm platform:app-release` against the real local
 * control plane and local FAKE stores. The tracer is a dry run for a seeded tenant: it derives the build record,
 * unseals the held credentials, registers everything on the fakes and writes `build.json`, printing closed outcomes
 * only. Every credential here carries a sentinel, and the whole of standard output and standard error is scanned.
 */

const RUN = Date.now().toString(36);
const SLUG = `ar-${RUN}`.slice(0, 40);
const HOST = `ar-${RUN}.cliente.test`;
const KEY_ID = 'SENTINEL01';
const ISSUER_ID = 'sentinel-issuer-5f3c9a77-0000-4000-8000-000000000001';
const ACCOUNT_KEY_ID = 'sentinel-private-key-id-0001';

const ec = () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
};
const ASC_P8 = ec();
const APNS_P8 = ec();
const PLAY_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'sentinel-release@project.iam.test',
  private_key_id: ACCOUNT_KEY_ID,
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
});

/** What would be a secret if it ever reached the output: the bodies, the lines of the PEMs, the ids. */
const pemLines = (pem: string) =>
  pem.split('\n').filter((line) => line.length > 20 && !line.startsWith('-----'));
const SENTINELS = [
  KEY_ID,
  ISSUER_ID,
  ACCOUNT_KEY_ID,
  ...pemLines(ASC_P8),
  ...pemLines(APNS_P8),
  ...pemLines(JSON.parse(PLAY_ACCOUNT).private_key),
];

/** A stand-in for `keytool`, which needs a JRE this machine may not have: it writes bytes where keytool would. */
const fakeKeytool: Tools = async (file, args) => {
  if (file !== 'keytool') return { code: 0, missing: false };
  const target = args[args.indexOf('-keystore') + 1];
  if (!target) return { code: 1, missing: false };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(target, Buffer.from(`fake-keystore-${Math.random()}`));
  return { code: 0, missing: false };
};
const fakeCsr = async () => ({
  csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nZmFrZQ==\n-----END CERTIFICATE REQUEST-----\n',
  keyPem: '-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END PRIVATE KEY-----\n',
});

let tenantId = '';
let out = '';

async function removeTenant(): Promise<void> {
  await adminSql`delete from public.tenants where slug = ${SLUG} or slug like ${`${SLUG}-%`}`;
}

/** A tenant ready for a release: brand, verified host, the three credentials and both account ticks. */
async function seedFullTenant(slug: string, host: string, tick = true): Promise<string> {
  const branding = {
    logoUrl: '/seed-logos/rede-demo.svg',
    colors: { primary: '#d9480f', secondary: '#1c7ed6' },
  };
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding)
    values (${slug}, ${'Comunidade Aplicativo Ação 🌱 de Teste Longa'}, ${adminSql.json(branding)})
    returning id::text as id`;
  const id = tenant?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${id}::uuid, ${host}, true, now(), 'verified')`;
  await replaceAppCredential(id, 'asc_key', ASC_P8, {
    userId: 'test',
    keyId: KEY_ID,
    issuerId: ISSUER_ID,
  });
  await replaceAppCredential(id, 'apns_key', APNS_P8, { userId: 'test', keyId: KEY_ID });
  await replaceAppCredential(id, 'play_service_account', PLAY_ACCOUNT, { userId: 'test' });
  await adminSql`
    insert into platform.tenant_apps (tenant_id, manual_apple_account, manual_play_account)
    values (${id}::uuid, ${tick}, ${tick})
    on conflict (tenant_id) do update set manual_apple_account = ${tick}, manual_play_account = ${tick}`;
  return id;
}

beforeAll(async () => {
  await removeTenant();
  tenantId = await seedFullTenant(SLUG, HOST);
});

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'app-release-it-'));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
  vi.restoreAllMocks();
});
afterAll(async () => {
  await removeTenant();
  await adminSql.end();
  await sqlClient.end();
});

/** Runs the command and returns its exit code and everything it wrote to standard output and error. */
async function run(argv: string[], overrides: Parameters<typeof release.runCli>[1] = {}) {
  const lines: string[] = [];
  const capture = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  let code: number;
  try {
    code = await release.runCli(argv, { tools: fakeKeytool, makeCsr: fakeCsr, ...overrides });
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { code, text: lines.join('') };
}

describe('the tracer: a dry run for a seeded tenant (D-619, NATIVE-02, NATIVE-28)', () => {
  it('derives the build record, registers on the fakes, writes build.json and prints only closed outcomes', async () => {
    const { code, text } = await run([
      'prepare',
      SLUG,
      '--env',
      'hml',
      '--platform',
      'all',
      '--dry-run',
      '--out',
      join(out, '.tenant'),
    ]);
    expect(text).toContain('app-release derive ok');
    expect(text).toContain('app-release ios.bundle-id ok');
    expect(text).toContain('app-release ios.certificate created');
    expect(text).toContain('app-release ios.profile created');
    expect(text).toContain('app-release android.keystore created');
    expect(text).toContain('app-release done ok');
    expect(code).toBe(0);

    const build = tenantBuildSchema.parse(
      JSON.parse(await readFile(join(out, '.tenant', 'build.json'), 'utf8')),
    );
    expect(build).toMatchObject({
      slug: SLUG,
      host: HOST,
      env: 'hml',
      bundleId: expect.stringMatching(/^test\.cliente\.ar/),
      version: '1.0.0',
      buildNumber: 1,
    });
    expect(Array.from(build.storeName).length).toBeLessThanOrEqual(30);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it('refuses an unknown slug with a closed reason and starts nothing', async () => {
    const { code, text } = await run([
      'prepare',
      `nope-${RUN}`,
      '--dry-run',
      '--out',
      join(out, '.tenant'),
    ]);
    expect(code).toBe(1);
    expect(text).toContain('app-release release refused tenant_not_found');
    await expect(readFile(join(out, '.tenant', 'build.json'))).rejects.toThrow();
  });

  it('refuses when the build workspace is missing instead of creating it', async () => {
    const { code, text } = await run([
      'prepare',
      SLUG,
      '--dry-run',
      '--out',
      join(out, 'absent', '.tenant'),
    ]);
    expect(code).toBe(1);
    expect(text).toContain('workspace_missing');
  });
});

/** A throwaway tenant (slug `${SLUG}-<tag>`), removed with the others in `afterAll`. */
async function freshTenant(tag: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name) values (${`${SLUG}-${tag}`}, ${`Tenant ${tag}`})
    returning id::text as id`;
  return row?.id ?? '';
}

const keystoreRows = (id: string, kind: string) =>
  adminSql<{ id: string; sealed: string }[]>`
    select id::text as id, sealed from platform.tenant_app_credentials
     where tenant_id = ${id}::uuid and kind = ${kind}`;

/** Counts calls and writes distinct bytes where keytool would, slowly enough for two callers to overlap. */
const countingKeytool =
  (counter: { calls: number }): Tools =>
  async (file, args) => {
    if (file !== 'keytool') return { code: 0, missing: false };
    counter.calls += 1;
    const target = args[args.indexOf('-keystore') + 1] ?? '';
    const { writeFile } = await import('node:fs/promises');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await writeFile(target, Buffer.from(`keystore-${counter.calls}-${Math.random()}`));
    return { code: 0, missing: false };
  };

describe('first-use generation against the local control plane (NATIVE-27, T-13-51, T-13-52)', () => {
  it('two concurrent first-use runs leave exactly one keystore row, one keytool run and one value for both callers', async () => {
    const id = await freshTenant('race');
    const dir = await mkdtemp(join(tmpdir(), 'app-release-it-'));
    const counter = { calls: 0 };
    try {
      const run = () =>
        signing.ensureAndroidKeystore({
          tenantId: id,
          applicationId: 'test.cliente.race',
          store: signing.pgGeneratedStore,
          tools: countingKeytool(counter),
          dir,
        });
      const results = await Promise.all([run(), run()]);
      expect(results.filter((r) => r.created).length).toBe(1);
      expect(counter.calls).toBe(1);
      expect(await keystoreRows(id, 'android_keystore')).toHaveLength(1);
      const held = await signing.pgGeneratedStore.peek(id, 'android_keystore');
      expect(JSON.parse(held ?? '{}').alias).toBe(signing.keystoreAlias(id, 'test.cliente.race'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("seals under <rowId>:<kind>: it opens with its own AAD and with no other tenant's or kind's", async () => {
    const a = await freshTenant('aad-a');
    const b = await freshTenant('aad-b');
    const dir = await mkdtemp(join(tmpdir(), 'app-release-it-'));
    try {
      for (const tenantId of [a, b]) {
        await signing.ensureAndroidKeystore({
          tenantId,
          applicationId: 'test.cliente.aad',
          store: signing.pgGeneratedStore,
          tools: countingKeytool({ calls: 0 }),
          dir,
        });
      }
      const [rowA] = await keystoreRows(a, 'android_keystore');
      const [rowB] = await keystoreRows(b, 'android_keystore');
      expect(rowA && rowB && rowA.id !== rowB.id).toBe(true);
      expect(() => open(rowA?.sealed ?? '', `${rowA?.id}:android_keystore`)).not.toThrow();
      expect(() => open(rowA?.sealed ?? '', `${rowB?.id}:android_keystore`)).toThrow(
        'sealed value unreadable',
      );
      expect(() => open(rowA?.sealed ?? '', `${rowA?.id}:ios_distribution`)).toThrow(
        'sealed value unreadable',
      );
      const aliasA = JSON.parse(open(rowA?.sealed ?? '', `${rowA?.id}:android_keystore`)).alias;
      const aliasB = JSON.parse(open(rowB?.sealed ?? '', `${rowB?.id}:android_keystore`)).alias;
      expect(aliasA).not.toBe(aliasB);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('two apps of one tenant keep separate kinds, and two concurrent iOS runs create one certificate', async () => {
    const id = await freshTenant('ios');
    const dir = await mkdtemp(join(tmpdir(), 'app-release-it-'));
    const fakes = await fakeStoresModule.createFakeStores();
    const { appleKeyPair } = (await import(
      /* @vite-ignore */ new URL('../../../../scripts/app-release/fixtures.ts', import.meta.url)
        .href
    )) as typeof import('../../../../scripts/app-release/fixtures');
    try {
      const apple = appleModule.createAppleClient({
        origin: fakes.apple.origin,
        keyId: 'KEYID12345',
        issuerId: 'issuer',
        privateKey: appleKeyPair().p8,
      });
      const run = () =>
        signing.ensureIosSigning({
          tenantId: id,
          bundleId: 'test.cliente.ios',
          storeName: 'Ios',
          apple,
          store: signing.pgGeneratedStore,
          tools: async () => ({ code: 0, missing: false }),
          dir,
          makeCsr: fakeCsr,
          packP12: async () => Buffer.from('p12'),
        });
      const [one, two] = await Promise.all([run(), run()]);
      expect(fakes.counts().certificates).toBe(1);
      expect(fakes.counts().profileCreates).toBe(1);
      expect(one.certificateId).toBe(two.certificateId);
      expect(await keystoreRows(id, 'ios_distribution')).toHaveLength(1);
      expect(await keystoreRows(id, 'android_keystore')).toHaveLength(0);
    } finally {
      await fakes.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- Task 3: publish, idempotency, repeatability ---------------------------------------------------------------------

const reportModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/report.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/report');
const sourcesModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/sources.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/sources');
const prepareModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/prepare.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/prepare');
const publishModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/publish.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/publish');
const versionsModule = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/versions.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/versions');
const { readAppCredential } = await import('@rede-social/core/server/apps/index');
const { seal } = await import('@rede-social/core/server/secrets/sealed');
const { fileURLToPath } = await import('node:url');
const PUBLIC_DIR = fileURLToPath(new URL('../../../web/public', import.meta.url));

type RunDeps = import('../../../../scripts/app-release/publish').PublishDeps;

/** The command's dependencies over persistent fakes, an in-memory generated store and a counting keytool. */
function makeDeps(
  fakes: import('../../../../scripts/app-release/fake-stores').FakeStores,
  extra: Partial<RunDeps> = {},
) {
  const lines: string[] = [];
  const masks: string[] = [];
  const keytool = { calls: 0 };
  const generated = signing.memoryGeneratedStore({ seal, open });
  const readCredential: RunDeps['readCredential'] = (id, kind) =>
    kind === 'android_keystore' || kind === 'ios_distribution'
      ? generated.peek(id, kind)
      : readAppCredential(id, kind as 'asc_key' | 'play_service_account' | 'apns_key');
  const deps: RunDeps = {
    source: sourcesModule.pgTenantSource,
    readLogo: sourcesModule.localLogoReader(PUBLIC_DIR),
    readCredential,
    generatedStore: generated,
    tools: countingKeytool(keytool),
    report: reportModule.createReporter((line) => lines.push(line)),
    maskSink: (line) => masks.push(line),
    tempBase: tmpdir(),
    stores: { apple: fakes.apple, google: fakes.google },
    makeCsr: fakeCsr,
    packP12: async () => Buffer.from('p12'),
    versionStore: versionsModule.memoryVersionStore(),
    sleep: async () => {},
    ...extra,
  };
  return { deps, lines, masks, keytool };
}

const buildFiles = async (dir: string) => ({
  build: await readFile(join(dir, 'build.json')),
  icon: await readFile(join(dir, 'icon.png')),
});

describe('repeatability (NATIVE-28 idempotency)', () => {
  it('two dry runs print byte-identical logs and write a byte-identical build.json', async () => {
    const outA = join(out, 'a');
    const outB = join(out, 'b');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(outA);
    await mkdir(outB);
    const first = await run(['prepare', SLUG, '--dry-run', '--out', join(outA, '.tenant')]);
    const second = await run(['prepare', SLUG, '--dry-run', '--out', join(outB, '.tenant')]);
    expect(first.code).toBe(0);
    expect(second.text).toBe(first.text);
    const a = await buildFiles(join(outA, '.tenant'));
    const b = await buildFiles(join(outB, '.tenant'));
    expect(a.build.equals(b.build)).toBe(true);
    expect(a.icon.equals(b.icon)).toBe(true);
  });

  it('a dry run persists nothing: no generated credential and no recorded build', async () => {
    await run(['prepare', SLUG, '--dry-run', '--out', join(out, '.tenant')]);
    await run([
      'publish',
      SLUG,
      '--dry-run',
      '--out',
      join(out, '.tenant'),
      '--min-version',
      '2.0.0',
    ]);
    const generated = await adminSql`
      select kind from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind in ('android_keystore', 'ios_distribution')`;
    expect(generated).toHaveLength(0);
    const [row] = await adminSql<
      { last_ios_build: number | null; min_version_ios: string | null }[]
    >`
      select last_ios_build, min_version_ios from platform.tenant_apps where tenant_id = ${tenantId}::uuid`;
    expect(row).toMatchObject({ last_ios_build: null, min_version_ios: null });
  });

  it('a dry-run publish after a dry-run prepare prints only closed outcomes and no sentinel', async () => {
    const outDir = join(out, '.tenant');
    await run(['prepare', SLUG, '--dry-run', '--out', outDir]);
    const { code, text } = await run(['publish', SLUG, '--dry-run', '--out', outDir]);
    expect(code).toBe(0);
    for (const line of [
      'publish.ios.build ok',
      'publish.android.upload ok',
      'publish.android.track ok',
    ]) {
      expect(text).toContain(`app-release ${line}`);
    }
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it('prepare twice registers nothing twice and runs keytool once; the masks precede any file', async () => {
    const fakes = await fakeStoresModule.createFakeStores();
    const { deps, masks, keytool } = makeDeps(fakes);
    const options = {
      slug: SLUG,
      env: 'hml' as const,
      platform: 'all' as const,
      outDir: join(out, '.tenant'),
    };
    try {
      await prepareModule.runPrepare(options, deps);
      await prepareModule.runPrepare(options, deps);
      const counts = fakes.counts();
      expect(counts).toMatchObject({
        bundleIds: 1,
        certificates: 1,
        profiles: 1,
        profileCreates: 1,
      });
      expect(keytool.calls).toBe(1);
      expect(counts.reviewSubmissions).toBe(0);
      expect(fakes.requests().some((r) => /review|submission/i.test(r.path))).toBe(false);
      // Every secret was masked for the runner (the real, non-dry sink), and none of them went anywhere else.
      const masked = masks.map((line) => line.replace('::add-mask::', ''));
      expect(masked).toEqual(expect.arrayContaining([KEY_ID, ISSUER_ID, ACCOUNT_KEY_ID]));
      expect(masks.every((line) => line.startsWith('::add-mask::'))).toBe(true);
    } finally {
      await fakes.close();
    }
  });
});

describe('publish records the build only after the uploads succeed (NATIVE-28)', () => {
  const baseOptions = (outDir: string) => ({
    slug: '',
    platform: 'all' as const,
    outDir,
    aab: null as string | null,
    aabBytes: Buffer.from('aab'),
    minVersion: null as string | null,
    storeUrlIos: null as string | null,
    storeUrlAndroid: null as string | null,
  });

  const lastBuilds = async (id: string) => {
    const [row] = await adminSql<
      {
        last_ios_build: number | null;
        last_android_build: number | null;
        min_version_ios: string | null;
        min_version_android: string | null;
        store_url_ios: string | null;
        store_url_android: string | null;
      }[]
    >`select last_ios_build, last_android_build, min_version_ios, min_version_android, store_url_ios, store_url_android
        from platform.tenant_apps where tenant_id = ${id}::uuid`;
    return row;
  };

  it('increments the build number once per publish and writes only the fields passed', async () => {
    const slug = `${SLUG}-pub`;
    const id = await seedFullTenant(slug, `${slug}.cliente.test`);
    const fakes = await fakeStoresModule.createFakeStores();
    const { deps } = makeDeps(fakes, { versionStore: versionsModule.pgVersionStore });
    const outDir = join(out, '.tenant');
    const prepare = { slug, env: 'hml' as const, platform: 'all' as const, outDir };
    try {
      await prepareModule.runPrepare(prepare, deps);
      expect(JSON.parse(await readFile(join(outDir, 'build.json'), 'utf8')).buildNumber).toBe(1);
      // Two prepares without a publish keep the same number: it moves only when a build is recorded.
      await prepareModule.runPrepare(prepare, deps);
      expect(JSON.parse(await readFile(join(outDir, 'build.json'), 'utf8')).buildNumber).toBe(1);

      fakes.markBuildUploaded(
        JSON.parse(await readFile(join(outDir, 'build.json'), 'utf8')).bundleId,
        1,
      );
      await publishModule.runPublish(
        {
          ...baseOptions(outDir),
          slug,
          minVersion: '1.0.0',
          storeUrlIos: 'https://apps.apple.test/app/id1',
        },
        deps,
      );
      expect(await lastBuilds(id)).toMatchObject({
        last_ios_build: 1,
        last_android_build: 1,
        min_version_ios: '1.0.0',
        min_version_android: '1.0.0',
        store_url_ios: 'https://apps.apple.test/app/id1',
        store_url_android: null,
      });

      await prepareModule.runPrepare(prepare, deps);
      expect(JSON.parse(await readFile(join(outDir, 'build.json'), 'utf8')).buildNumber).toBe(2);
      expect(fakes.counts().internalTrackUpdates).toBe(1);
      expect(fakes.counts().otherTrackUpdates).toBe(0);
      expect(fakes.trackUpdates().every((update) => update.track === 'internal')).toBe(true);
    } finally {
      await fakes.close();
    }
  });

  it('records nothing for a platform whose build did not process, and keeps the other platform', async () => {
    const slug = `${SLUG}-fail`;
    const id = await seedFullTenant(slug, `${slug}.cliente.test`);
    const fakes = await fakeStoresModule.createFakeStores();
    const { deps, lines } = makeDeps(fakes, { versionStore: versionsModule.pgVersionStore });
    const outDir = join(out, '.tenant');
    try {
      await prepareModule.runPrepare({ slug, env: 'hml', platform: 'all', outDir }, deps);
      const build = JSON.parse(await readFile(join(outDir, 'build.json'), 'utf8'));
      fakes.markBuildUploaded(build.bundleId, build.buildNumber, 'FAILED');
      await expect(
        publishModule.runPublish({ ...baseOptions(outDir), slug, platform: 'ios' }, deps),
      ).rejects.toMatchObject({ reason: 'store_failed' });
      expect(lines.join('\n')).toContain('publish.ios.build failed build_failed');
      expect((await lastBuilds(id))?.last_ios_build ?? null).toBeNull();

      await publishModule.runPublish({ ...baseOptions(outDir), slug, platform: 'android' }, deps);
      expect(await lastBuilds(id)).toMatchObject({ last_ios_build: null, last_android_build: 1 });
    } finally {
      await fakes.close();
    }
  });

  it('refuses a store link for a platform that is not in the run, an http link and a bad version, before any store call', async () => {
    const fakes = await fakeStoresModule.createFakeStores();
    const { deps } = makeDeps(fakes);
    const outDir = join(out, '.tenant');
    try {
      await prepareModule.runPrepare({ slug: SLUG, env: 'hml', platform: 'all', outDir }, deps);
      const before = fakes.requests().length;
      await expect(
        publishModule.runPublish(
          {
            ...baseOptions(outDir),
            slug: SLUG,
            platform: 'android',
            storeUrlIos: 'https://x.test/a',
          },
          deps,
        ),
      ).rejects.toMatchObject({ reason: 'bad_arguments' });
      await expect(
        versionsModule.pgVersionStore.write(tenantId, { storeUrl: { ios: 'http://x.test/a' } }),
      ).rejects.toMatchObject({ reason: 'bad_arguments' });
      await expect(
        versionsModule.pgVersionStore.write(tenantId, { minVersion: { ios: '1.2' } }),
      ).rejects.toMatchObject({ reason: 'bad_arguments' });
      expect(fakes.requests().length).toBe(before);
    } finally {
      await fakes.close();
    }
  });

  it('refuses a publish whose build.json belongs to another tenant or is missing', async () => {
    const fakes = await fakeStoresModule.createFakeStores();
    const { deps } = makeDeps(fakes);
    try {
      await expect(
        publishModule.runPublish({ ...baseOptions(join(out, 'none')), slug: SLUG }, deps),
      ).rejects.toMatchObject({ reason: 'artifact_missing' });
      const outDir = join(out, '.tenant');
      await prepareModule.runPrepare({ slug: SLUG, env: 'hml', platform: 'all', outDir }, deps);
      await expect(
        publishModule.runPublish({ ...baseOptions(outDir), slug: `${SLUG}-pub` }, deps),
      ).rejects.toMatchObject({ reason: 'artifact_missing' });
    } finally {
      await fakes.close();
    }
  });
});

describe('dispatch (NATIVE-28 empty)', () => {
  it('refuses an incomplete tenant with the exact list of what is missing and starts nothing', async () => {
    const slug = `${SLUG}-empty`;
    const id = await freshTenant('empty');
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${id}::uuid, ${`${slug}.cliente.test`}, true, now(), 'verified')`;
    const calls: string[] = [];
    const tools: Tools = async (file, args) => {
      calls.push([file, ...args].join(' '));
      return { code: 0, missing: false };
    };
    const { code, text } = await run(['dispatch', slug, '--platform', 'all'], { tools });
    expect(code).toBe(1);
    expect(text).toContain('release refused missing_credentials');
    for (const item of ['asc_key', 'apns_key', 'play_service_account'])
      expect(text).toContain(`missing refused ${item}`);
    expect(calls).toEqual([]);

    // The credentials held but the account steps not ticked: the checklist is what is missing.
    await adminSql`insert into platform.tenant_apps (tenant_id) values (${id}::uuid) on conflict do nothing`;
    await replaceAppCredential(id, 'asc_key', ASC_P8, {
      userId: 'test',
      keyId: KEY_ID,
      issuerId: ISSUER_ID,
    });
    await replaceAppCredential(id, 'apns_key', APNS_P8, { userId: 'test', keyId: KEY_ID });
    await replaceAppCredential(id, 'play_service_account', PLAY_ACCOUNT, { userId: 'test' });
    const second = await run(['dispatch', slug], { tools });
    expect(second.text).toContain('release refused missing_checklist');
    expect(second.text).toContain('missing refused appleaccount');
    expect(calls).toEqual([]);
  });

  it('starts the protected workflow for a ready tenant with an argument array, and prints it (not runs it) under --dry-run', async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const tools: Tools = async (file, args) => {
      calls.push({ file, args });
      return { code: 0, missing: false, stdout: 'https://github.com/acme/repo/actions/runs/123\n' };
    };
    const dry = await run(['dispatch', SLUG, '--dry-run'], { tools });
    expect(dry.code).toBe(0);
    expect(dry.text).toContain('dispatch.workflow planned');
    expect(calls).toEqual([]);

    const real = await run(['dispatch', SLUG, '--env', 'prod', '--platform', 'ios'], {
      tools,
      sleep: async () => {},
    } as never);
    expect(real.code).toBe(0);
    expect(calls[0]).toEqual({
      file: 'gh',
      args: [
        'workflow',
        'run',
        'app-release.yml',
        '-f',
        `tenant=${SLUG}`,
        '-f',
        'env=prod',
        '-f',
        'platform=ios',
      ],
    });
    expect(real.text).toContain(
      'app-release run-url https://github.com/acme/repo/actions/runs/123',
    );
  });

  it('--check-only stops after the checks', async () => {
    const calls: string[] = [];
    const tools: Tools = async (file) => {
      calls.push(file);
      return { code: 0, missing: false };
    };
    const { code, text } = await run(['dispatch', SLUG, '--check-only'], { tools });
    expect(code).toBe(0);
    expect(text).toContain('dispatch.check ok');
    expect(calls).toEqual([]);
  });
});
