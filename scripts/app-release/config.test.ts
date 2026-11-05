import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tenantBuildSchema } from '@rede-social/contracts/native';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveBuildRecord,
  nextBuildNumber,
  permissionStrings,
  readBuildRecord,
  renderAssets,
  serializeBuildRecord,
  type TenantRecord,
  writeBuildRecord,
} from './config';
import { BRANDING, SVG_LOGO, tabOf, tenantOf } from './fixtures';
import { parseCliArgs } from './index';
import { ReleaseRefusal } from './report';

const logo = async () => ({ data: Buffer.from(SVG_LOGO), mime: 'image/svg+xml' });
const sourceOf = (record: TenantRecord | null) => ({ load: async () => record });
const derive = (record: TenantRecord | null, env: 'hml' | 'prod' = 'hml') =>
  deriveBuildRecord({ slug: 'comunidade', env, source: sourceOf(record), readLogo: logo });
const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReleaseRefusal) return error.reason;
    throw error;
  }
  return 'no refusal';
};

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-release-test-'));
  made.push(dir);
  return dir;
};

describe('the build record comes from the tenant record only (NATIVE-02, D-607)', () => {
  it('derives names, hosts, ids, colours and permission texts, and validates with tenantBuildSchema', async () => {
    const { build } = await derive(
      tenantOf({ tab: tabOf({ teamId: 'ABCDE12345', shortName: 'Comunidade' }) }),
      'prod',
    );
    expect(tenantBuildSchema.parse(build)).toEqual(build);
    expect(build).toMatchObject({
      slug: 'comunidade',
      host: 'comunidade.cliente.test',
      hosts: ['comunidade.cliente.test', 'www.cliente.test'],
      env: 'prod',
      storeName: 'Comunidade Cliente',
      shortName: 'Comunidade',
      bundleId: 'test.cliente.comunidade',
      applicationId: 'test.cliente.comunidade',
      teamId: 'ABCDE12345',
      version: '1.0.0',
      buildNumber: 1,
    });
    expect(build.colors.primary).toBe(BRANDING.colors.primary);
    expect(build.logoUrl).toBe('https://comunidade.cliente.test/seed-logos/comunidade.svg');
    for (const text of Object.values(build.strings)) {
      expect(text).toContain('Comunidade Cliente');
      expect(text).not.toContain('{tenant}');
    }
  });

  it('cuts the store name at 30 code points, never splitting an emoji or an accent (NATIVE-28 encoding)', async () => {
    const name = 'Comunidade da Ação Cidadã 🌱🌱🌱 Brasil';
    const { build } = await derive(tenantOf({ displayName: name }));
    expect(Array.from(build.storeName).length).toBeLessThanOrEqual(30);
    expect(build.storeName).not.toMatch(/�/);
    expect(name.startsWith(build.storeName)).toBe(true);
    expect(JSON.parse(serializeBuildRecord(build)).storeName).toBe(build.storeName);
  });

  it('is monotonic: one more than the highest recorded build and the highest recorded version', async () => {
    const tab = tabOf({
      lastIos: { version: '1.2.0', buildNumber: 7 },
      lastAndroid: { version: '1.1.0', buildNumber: 9 },
    });
    expect(nextBuildNumber(tab)).toBe(10);
    const { build } = await derive(tenantOf({ tab }));
    expect(build).toMatchObject({ version: '1.2.0', buildNumber: 10 });
  });

  it('refuses instead of inventing a placeholder', async () => {
    expect(await refusal(derive(null))).toBe('tenant_not_found');
    expect(await refusal(derive(tenantOf({ primaryHost: null })))).toBe('no_primary_host');
    expect(await refusal(derive(tenantOf({ branding: {} })))).toBe('no_brand_colors');
    expect(await refusal(derive(tenantOf({ branding: { logoUrl: '/x.svg' } })))).toBe(
      'no_brand_colors',
    );
    expect(await refusal(derive(tenantOf({ branding: { colors: BRANDING.colors } })))).toBe(
      'no_logo',
    );
    expect(await refusal(derive(tenantOf({ tab: tabOf({ bundleId: null }) })))).toBe('no_app_ids');
    const failing = deriveBuildRecord({
      slug: 'comunidade',
      env: 'hml',
      source: sourceOf(tenantOf()),
      readLogo: async () => {
        throw new Error('network');
      },
    });
    expect(await refusal(failing)).toBe('no_logo');
  });

  it('carries no trace of the platform: no neutral brand colour, no platform name', async () => {
    const { build } = await derive(tenantOf());
    const text = JSON.stringify(build);
    expect(text).not.toContain('#2e6fd0');
    expect(text).not.toContain('#5b9cf8');
    expect(text.toLowerCase()).not.toContain('rede social');
  });

  it('keeps shell metacharacters as plain data in the JSON (NATIVE-28 encoding)', async () => {
    const hostile = '"; rm -rf / #$(id)`x`';
    const { build } = await derive(tenantOf({ displayName: hostile }));
    expect(build.storeName).toBe(hostile);
    expect(JSON.parse(serializeBuildRecord(build)).storeName).toBe(hostile);
  });

  it('permissionStrings replaces {tenant} with the store name in all four texts', () => {
    const strings = permissionStrings('Ação 🌱');
    expect(Object.values(strings).every((text) => text.startsWith('Ação 🌱 '))).toBe(true);
  });
});

describe('writing the build record (NATIVE-28 idempotency)', () => {
  it('writes UTF-8 JSON that round-trips, plus the five images, byte-identically twice', async () => {
    const derived = await derive(tenantOf({ displayName: 'Ação 🌱 Comunidade' }));
    const assets = await renderAssets(derived);
    expect(Object.keys(assets).sort()).toEqual([
      'adaptive-foreground.png',
      'icon.png',
      'notification-icon.png',
      'play-icon.png',
      'splash.png',
    ]);
    const one = await scratch();
    const two = await scratch();
    await writeBuildRecord({ dir: one, build: derived.build, assets });
    await writeBuildRecord({ dir: two, build: derived.build, assets });
    const first = await readFile(join(one, 'build.json'));
    expect(first.equals(await readFile(join(two, 'build.json')))).toBe(true);
    expect((await readBuildRecord(one)).storeName).toBe('Ação 🌱 Comunidade');
    const icon = await readFile(join(one, 'icon.png'));
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
  });

  it('refuses a record the schema rejects before writing anything', async () => {
    const derived = await derive(tenantOf());
    const dir = await scratch();
    await expect(
      writeBuildRecord({ dir, build: { ...derived.build, bundleId: 'not valid' }, assets: {} }),
    ).rejects.toThrow();
    await expect(readFile(join(dir, 'build.json'))).rejects.toThrow();
  });

  it('readBuildRecord refuses a missing or malformed file with a closed reason', async () => {
    const dir = await scratch();
    expect(await refusal(readBuildRecord(dir))).toBe('artifact_missing');
    await writeFile(join(dir, 'build.json'), '{"slug":1}');
    expect(await refusal(readBuildRecord(dir))).toBe('artifact_missing');
  });
});

describe('the command line (OQ-4)', () => {
  it('defaults to dispatch, hml and all platforms; a subcommand takes the slug after it', () => {
    expect(parseCliArgs(['comunidade'])).toMatchObject({
      command: 'dispatch',
      slug: 'comunidade',
      env: 'hml',
      platform: 'all',
      dryRun: false,
    });
    expect(
      parseCliArgs(['prepare', 'comunidade', '--env', 'prod', '--platform', 'ios', '--dry-run']),
    ).toMatchObject({
      command: 'prepare',
      slug: 'comunidade',
      env: 'prod',
      platform: 'ios',
      dryRun: true,
    });
  });

  it('rejects unknown flags, bad choices, bad versions and non-https links', () => {
    const reason = (argv: string[]) => {
      try {
        parseCliArgs(argv);
      } catch (error) {
        return error instanceof ReleaseRefusal ? error.reason : 'other';
      }
      return 'accepted';
    };
    expect(reason(['comunidade', '--password', 'x'])).toBe('bad_arguments');
    expect(reason(['comunidade', '--env', 'staging'])).toBe('bad_arguments');
    expect(reason(['comunidade', '--platform', 'web'])).toBe('bad_arguments');
    expect(reason(['comunidade', '--min-version', '1.2'])).toBe('bad_arguments');
    expect(reason(['comunidade', '--store-url-ios', 'http://x.test'])).toBe('bad_arguments');
    expect(reason([])).toBe('bad_arguments');
    expect(reason(['a', 'b', 'c'])).toBe('bad_arguments');
    expect(
      reason(['comunidade', '--min-version', '1.2.0', '--store-url-ios', 'https://apps.test/x']),
    ).toBe('accepted');
  });
});
