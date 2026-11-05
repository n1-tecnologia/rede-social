import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../src/bootstrap';
import { resolveBranding, toHostBranding } from '../src/branding';
import { hostTenantSchema } from '../src/hosts';
import {
  buildNativeUa,
  deriveAppIds,
  isValidApplicationId,
  isValidBundleId,
  NATIVE_PLATFORM_HEADER,
  parseNativeUa,
  purchaseVisible,
} from '../src/native';

/**
 * Phase 13-03 tracer (D-603, NATIVE-32): the native subpath exists outside the barrel, the two
 * existing answers gained their fields ADDITIVELY, and one id derivation works end to end.
 * Imports are relative; the subpath wiring itself is asserted against package.json below.
 */

const hostBody = {
  slug: 'rede-demo',
  displayName: 'Rede Demo',
  status: 'active',
  isPrimary: true,
  primaryHost: 'rede-demo.localhost',
  branding: toHostBranding(resolveBranding({})),
};

const app = {
  ios: { appId: 'ABCDE12345.br.com.cliente.comunidade' },
  android: { applicationId: 'br.com.cliente.comunidade', sha256: ['AB:CD'] },
  purchase: { ios: false, android: false },
};

const oldBootstrap = {
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', name: 'Ana' },
  membership: {
    tenantId: '22222222-2222-4222-8222-222222222222',
    role: 'member',
    status: 'active',
    profile: { displayName: 'Ana', avatarUrl: null, bio: null },
  },
  tenant: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'rede-demo',
    displayName: 'Rede Demo',
    branding: {},
    timezone: 'America/Sao_Paulo',
  },
  modules: [],
  permissions: [],
  counters: { unreadNotifications: 0, unreadConversations: 0 },
};

describe('hostTenantSchema.app — additive and still strict', () => {
  it('parses an old answer with app undefined, and a new one with the block or null', () => {
    expect(hostTenantSchema.parse(hostBody).app).toBeUndefined();
    expect(hostTenantSchema.parse({ ...hostBody, app }).app).toEqual(app);
    expect(hostTenantSchema.parse({ ...hostBody, app: null }).app).toBeNull();
  });

  it('one platform missing never blocks the other (D-611)', () => {
    const half = { ...app, ios: null };
    expect(hostTenantSchema.parse({ ...hostBody, app: half }).app?.android?.applicationId).toBe(
      'br.com.cliente.comunidade',
    );
    expect(
      hostTenantSchema.safeParse({ ...hostBody, app: { ...app, android: null } }).success,
    ).toBe(true);
  });

  it('still refuses any OTHER unknown key, at the top level and inside the block', () => {
    expect(hostTenantSchema.safeParse({ ...hostBody, foo: 1 }).success).toBe(false);
    expect(hostTenantSchema.safeParse({ ...hostBody, app: { ...app, foo: 1 } }).success).toBe(
      false,
    );
  });
});

describe('bootstrapSchema — purchaseVisible and pendingDeletion', () => {
  it('reads an old bootstrap as purchaseVisible true and pendingDeletion null', () => {
    const parsed = bootstrapSchema.parse(oldBootstrap);
    expect(parsed.purchaseVisible).toBe(true);
    expect(parsed.pendingDeletion).toBeNull();
  });

  it('keeps the values the API sends', () => {
    const parsed = bootstrapSchema.parse({
      ...oldBootstrap,
      purchaseVisible: false,
      pendingDeletion: { until: '2026-11-18' },
    });
    expect(parsed.purchaseVisible).toBe(false);
    expect(parsed.pendingDeletion).toEqual({ until: '2026-11-18' });
  });
});

describe('deriveAppIds — the tracer derivation', () => {
  it('reverses the labels of the primary host', () => {
    expect(deriveAppIds('comunidade.cliente.com.br')).toEqual({
      ios: 'br.com.cliente.comunidade',
      android: 'br.com.cliente.comunidade',
    });
  });

  it('every derived id passes both validators', () => {
    const ids = deriveAppIds('comunidade.cliente.com.br');
    expect(isValidBundleId(ids?.ios ?? '')).toBe(true);
    expect(isValidApplicationId(ids?.android ?? '')).toBe(true);
  });
});

describe('purchaseVisible — D-617, fail closed', () => {
  it('is always true for a browser', () => {
    expect(
      purchaseVisible({ native: false, platform: null, switches: { ios: false, android: false } }),
    ).toBe(true);
  });

  it('reads only an explicit true for the app', () => {
    const switches = { ios: true, android: false };
    expect(purchaseVisible({ native: true, platform: 'ios', switches })).toBe(true);
    expect(purchaseVisible({ native: true, platform: 'android', switches })).toBe(false);
    expect(purchaseVisible({ native: true, platform: 'ios', switches: undefined })).toBe(false);
    expect(purchaseVisible({ native: true, platform: 'ios', switches: null })).toBe(false);
    expect(purchaseVisible({ native: true, platform: null, switches })).toBe(false);
  });
});

describe('the in-app marker', () => {
  it('builds and parses the UA token, and an absent UA is the browser', () => {
    const ua = buildNativeUa('1.2.3', 'android');
    expect(ua).toBe('RedeSocialApp/1.2.3 (android)');
    expect(parseNativeUa(`Mozilla/5.0 ${ua}`)).toEqual({
      native: true,
      platform: 'android',
      version: '1.2.3',
    });
    expect(parseNativeUa('')).toEqual({ native: false, platform: null, version: null });
    expect(parseNativeUa(null)).toEqual({ native: false, platform: null, version: null });
    expect(NATIVE_PLATFORM_HEADER).toBe('x-rede-app-platform');
  });
});

describe('rolling deploy matrix (T-13-06)', () => {
  // The bootstrap schema before this plan: same shape, no new fields. A plain z.object strips unknown keys.
  const legacyBootstrap = () =>
    bootstrapSchema.omit({ purchaseVisible: true, pendingDeletion: true } as never);
  const newBootstrap = {
    ...oldBootstrap,
    purchaseVisible: false,
    pendingDeletion: { until: '2026-11-18' },
  };

  it.each([
    ['old API x new web (by-host)', () => hostTenantSchema.safeParse(hostBody)],
    ['new API x new web (by-host)', () => hostTenantSchema.safeParse({ ...hostBody, app })],
    ['old API x new web (bootstrap)', () => bootstrapSchema.safeParse(oldBootstrap)],
    ['new API x new web (bootstrap)', () => bootstrapSchema.safeParse(newBootstrap)],
    ['new API x old web (bootstrap strips)', () => legacyBootstrap().safeParse(newBootstrap)],
    ['old API x old web (bootstrap)', () => legacyBootstrap().safeParse(oldBootstrap)],
  ])('%s parses', (_name, run) => {
    expect(run().success).toBe(true);
  });

  it('key order inside objects changes no result', () => {
    const reordered = Object.fromEntries(Object.entries({ ...hostBody, app }).reverse());
    expect(hostTenantSchema.parse(reordered)).toEqual(hostTenantSchema.parse({ ...hostBody, app }));
  });

  it('keeps the order of the sha256 array through a parse', () => {
    const sha256 = ['CC:CC', 'AA:AA', 'BB:BB'];
    const parsed = hostTenantSchema.parse({
      ...hostBody,
      app: { ...app, android: { applicationId: 'br.com.x', sha256 } },
    });
    expect(parsed.app?.android?.sha256).toEqual(sha256);
  });
});

describe('the subpath wiring', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));

  it('exports ./native and ./hosts from package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports['./native']).toBe('./src/native.ts');
    expect(pkg.exports['./hosts']).toBe('./src/hosts.ts');
  });

  it('keeps the native module out of the barrel', () => {
    const index = readFileSync(resolve(root, 'src/index.ts'), 'utf8');
    expect(index).not.toMatch(/['"]\.\/native['"]/);
    expect(index).not.toContain('native');
  });
});
