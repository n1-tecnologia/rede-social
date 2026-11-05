import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tenantBuildSchema } from '@rede-social/contracts/native';
import { sqlClient } from '@rede-social/core/db';
import { replaceAppCredential } from '@rede-social/core/server/apps/index';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminSql } from './setup';

// The command lives in the repo's `scripts/`, outside this package: it is loaded by URL (a static import would
// leave the package and fail `turbo boundaries`, as `reseal.test.ts` found); its types are still checked.
const release = (await import(
  /* @vite-ignore */ new URL('../../../../scripts/app-release/index.ts', import.meta.url).href
)) as typeof import('../../../../scripts/app-release/index');
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
  await adminSql`delete from public.tenants where slug = ${SLUG}`;
}

beforeAll(async () => {
  await removeTenant();
  const branding = {
    logoUrl: '/seed-logos/rede-demo.svg',
    colors: { primary: '#d9480f', secondary: '#1c7ed6' },
  };
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding)
    values (${SLUG}, ${'Comunidade Aplicativo Ação 🌱 de Teste Longa'}, ${adminSql.json(branding)})
    returning id::text as id`;
  tenantId = tenant?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${HOST}, true, now(), 'verified')`;
  await replaceAppCredential(tenantId, 'asc_key', ASC_P8, {
    userId: 'test',
    keyId: KEY_ID,
    issuerId: ISSUER_ID,
  });
  await replaceAppCredential(tenantId, 'apns_key', APNS_P8, { userId: 'test', keyId: KEY_ID });
  await replaceAppCredential(tenantId, 'play_service_account', PLAY_ACCOUNT, { userId: 'test' });
  await adminSql`
    insert into platform.tenant_apps (tenant_id, manual_apple_account, manual_play_account)
    values (${tenantId}::uuid, true, true)
    on conflict (tenant_id) do update set manual_apple_account = true, manual_play_account = true`;
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
