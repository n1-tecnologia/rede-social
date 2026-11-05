import { appVersionAnswerSchema, hostAppSchema } from '@rede-social/contracts/native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AppRow,
  type AppStore,
  type AppVersionRow,
  type AppVersionStore,
  appVersionAnswerOf,
  emptyAppRow,
  hostAppBlockOf,
  invalidatePurchaseSwitch,
  nativeRequestOf,
  PURCHASE_SWITCH_CACHE_MAX,
  purchaseSwitchCache,
  readAppVersion,
  readHostAppBlock,
  readPurchaseSwitches,
  setPurchaseSwitch,
} from '../server/apps/index';
import { ApiError } from '../server/http/api-error';
import { memoryAppStore } from './fixtures/apps-memory';

/**
 * 13-10 (D-615, D-617, D-603, D-611; NATIVE-07, NATIVE-24, T-13-24): the three control-plane reads of the request
 * path, at unit level over in-memory stores. The same reads run against the real tables in
 * `apps/api/tests/integration/public-app.test.ts`.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FINGERPRINT =
  'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const HOST = 'comunidade.cliente.com.br';

const rowOf = (patch: Partial<AppRow>, tenantId = TENANT): AppRow => ({
  ...emptyAppRow(tenantId),
  ...patch,
});

/** A store that counts how many times the cache fell through to it. */
function countingStore(initial: Record<string, AppRow> = {}) {
  const memory = memoryAppStore(
    {
      [TENANT]: { displayName: 'A', primaryHost: HOST },
      [OTHER]: { displayName: 'B', primaryHost: null },
    },
    initial,
  );
  const counter = { reads: 0 };
  const store: AppStore = {
    ...memory.store,
    async read(tenantId) {
      counter.reads += 1;
      return memory.store.read(tenantId);
    },
  };
  return { ...memory, store, counter };
}

beforeEach(() => {
  invalidatePurchaseSwitch(TENANT);
  invalidatePurchaseSwitch(OTHER);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('readHostAppBlock (D-603, D-611, T-13-24)', () => {
  it('a tenant with team id, bundle id, application id and one fingerprint gets both sides', async () => {
    const { store } = countingStore({
      [TENANT]: rowOf({
        teamId: 'ABCDE12345',
        bundleId: 'br.com.cliente.comunidade',
        applicationId: 'br.com.cliente.comunidade',
        androidSha256: [FINGERPRINT],
        purchaseIos: true,
      }),
    });

    const block = await readHostAppBlock(TENANT, { app: store, primaryHost: HOST });

    expect(block).toEqual({
      ios: { appId: 'ABCDE12345.br.com.cliente.comunidade' },
      android: { applicationId: 'br.com.cliente.comunidade', sha256: [FINGERPRINT] },
      purchase: { ios: true, android: false },
    });
    expect(hostAppSchema.safeParse(block).success).toBe(true);
  });

  it('only a team id and no bundle id (and no host to derive one from) leaves both sides null', async () => {
    const { store } = countingStore({ [TENANT]: rowOf({ teamId: 'ABCDE12345' }) });

    const block = await readHostAppBlock(TENANT, { app: store, primaryHost: null });

    expect(block).toEqual({ ios: null, android: null, purchase: { ios: false, android: false } });
  });

  it('a tenant with no saved ids takes the ids derived from the primary host, keeping hyphens on iOS and underscores on Android', async () => {
    const { store } = countingStore({
      [TENANT]: rowOf({ teamId: 'ABCDE12345', androidSha256: [FINGERPRINT] }),
    });

    const block = await readHostAppBlock(TENANT, {
      app: store,
      primaryHost: 'minha-loja.exemplo.com.br',
    });

    expect(block?.ios).toEqual({ appId: 'ABCDE12345.br.com.exemplo.minha-loja' });
    expect(block?.android).toEqual({
      applicationId: 'br.com.exemplo.minha_loja',
      sha256: [FINGERPRINT],
    });
  });

  it('a platform with partial data is null while the other platform still answers (D-611)', async () => {
    const androidOnly = hostAppBlockOf(
      rowOf({ applicationId: 'br.com.cliente.comunidade', androidSha256: [FINGERPRINT] }),
      null,
    );
    expect(androidOnly?.ios).toBeNull();
    expect(androidOnly?.android).not.toBeNull();

    const noFingerprint = hostAppBlockOf(
      rowOf({
        teamId: 'ABCDE12345',
        bundleId: 'br.com.cliente.comunidade',
        applicationId: 'br.com.cliente.comunidade',
      }),
      null,
    );
    expect(noFingerprint?.ios).not.toBeNull();
    expect(noFingerprint?.android).toBeNull();
  });

  it('a tenant with no row has no app: null, not an empty block', async () => {
    const { store } = countingStore();
    expect(await readHostAppBlock(TENANT, { app: store, primaryHost: HOST })).toBeNull();
    expect(hostAppBlockOf(null, HOST)).toBeNull();
  });

  it('an appId longer than the strict schema allows is refused as a null side, never an invalid answer', () => {
    const longBundle = `${'a'.repeat(80)}.${'b'.repeat(70)}`;
    const block = hostAppBlockOf(rowOf({ teamId: 'ABCDE12345', bundleId: longBundle }), null);
    expect(block?.ios).toBeNull();
    expect(hostAppSchema.safeParse(block).success).toBe(true);
  });

  it('carries no key beyond the three the strict schema names (T-13-24)', () => {
    const block = hostAppBlockOf(
      rowOf({
        teamId: 'ABCDE12345',
        bundleId: 'br.com.cliente.comunidade',
        applicationId: 'br.com.cliente.comunidade',
        androidSha256: [FINGERPRINT],
        reviewerEmail: 'revisor@exemplo.com',
        privacyUrl: 'https://cliente.com.br/privacidade',
        lastIosVersion: '1.0.0',
      }),
      HOST,
    );
    expect(Object.keys(block ?? {}).sort()).toEqual(['android', 'ios', 'purchase']);
    expect(JSON.stringify(block)).not.toContain('revisor@exemplo.com');
    expect(JSON.stringify(block)).not.toContain('privacidade');
  });
});

describe('readPurchaseSwitches (D-615, D-617, PU-5)', () => {
  it('reads the stored switches as strict booleans and serves the second read from the cache', async () => {
    const { store, counter } = countingStore({
      [TENANT]: rowOf({ purchaseIos: true, purchaseAndroid: false }),
    });

    const first = await readPurchaseSwitches(TENANT, { app: store });
    const second = await readPurchaseSwitches(TENANT, { app: store });

    expect(first).toEqual({ ios: true, android: false });
    expect(second).toEqual(first);
    expect(typeof first.ios).toBe('boolean');
    expect(typeof first.android).toBe('boolean');
    expect(counter.reads).toBe(1);
  });

  it('a tenant with no row reads both switches false, never null or an error', async () => {
    const { store } = countingStore();
    expect(await readPurchaseSwitches(TENANT, { app: store })).toEqual({
      ios: false,
      android: false,
    });
  });

  it('invalidatePurchaseSwitch makes the next read hit the store again', async () => {
    const { store, counter, rows } = countingStore({ [TENANT]: rowOf({ purchaseIos: false }) });
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);

    rows.set(TENANT, rowOf({ purchaseIos: true }));
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);
    invalidatePurchaseSwitch(TENANT);

    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(true);
    expect(counter.reads).toBe(2);
  });

  it('setPurchaseSwitch (plan 09) clears the cache of the writing instance at once', async () => {
    const { store } = countingStore();
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);

    await setPurchaseSwitch(TENANT, 'ios', true, { app: store });

    expect(await readPurchaseSwitches(TENANT, { app: store })).toEqual({
      ios: true,
      android: false,
    });
  });

  it('the cache is bounded: 1,000 tenants never leave more than the bound', async () => {
    const { store } = countingStore();
    for (let i = 0; i < 1_000; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await readPurchaseSwitches(id, { app: store });
    }
    expect(PURCHASE_SWITCH_CACHE_MAX).toBe(500);
    expect(purchaseSwitchCache.size).toBeLessThanOrEqual(PURCHASE_SWITCH_CACHE_MAX);
    expect(purchaseSwitchCache.size).toBe(PURCHASE_SWITCH_CACHE_MAX);
  });

  it('with a fake clock another instance serves the old value at 14 s and the new one at 16 s; the writer sees it at once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const { store, rows } = countingStore({ [TENANT]: rowOf({ purchaseIos: false }) });
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);

    // A write on ANOTHER instance: the row changes, this instance's cache is not told.
    rows.set(TENANT, rowOf({ purchaseIos: true }));

    vi.setSystemTime(new Date('2026-11-05T12:00:14Z'));
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);
    vi.setSystemTime(new Date('2026-11-05T12:00:16Z'));
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(true);

    // The writing instance drops the key, so it needs no wait.
    rows.set(TENANT, rowOf({ purchaseIos: false }));
    invalidatePurchaseSwitch(TENANT);
    expect((await readPurchaseSwitches(TENANT, { app: store })).ios).toBe(false);
  });

  it('two concurrent reads during a write each return the old or the new value, never an error', async () => {
    const { store, rows } = countingStore({ [TENANT]: rowOf({ purchaseAndroid: false }) });
    const reads = Promise.all([
      readPurchaseSwitches(TENANT, { app: store }),
      (async () => {
        rows.set(TENANT, rowOf({ purchaseAndroid: true }));
        invalidatePurchaseSwitch(TENANT);
        return readPurchaseSwitches(TENANT, { app: store });
      })(),
    ]);
    const [a, b] = await reads;
    expect([false, true]).toContain(a.android);
    expect([false, true]).toContain(b.android);
  });
});

describe('readAppVersion (NATIVE-07)', () => {
  const versionStore = (rows: Record<string, AppVersionRow | null>): AppVersionStore => ({
    async bySlug(slug) {
      return rows[slug] ?? null;
    },
  });
  const noRow: AppVersionRow = {
    minVersionIos: null,
    minVersionAndroid: null,
    storeUrlIos: null,
    storeUrlAndroid: null,
  };

  it('returns the stored floors and store URLs', async () => {
    const answer = await readAppVersion('rede-demo', {
      versions: versionStore({
        'rede-demo': {
          minVersionIos: '1.2.0',
          minVersionAndroid: '1.3.4',
          storeUrlIos: 'https://apps.apple.com/app/id1',
          storeUrlAndroid: 'https://play.google.com/store/apps/details?id=x',
        },
      }),
    });
    expect(answer).toEqual({
      ios: { minVersion: '1.2.0', storeUrl: 'https://apps.apple.com/app/id1' },
      android: { minVersion: '1.3.4', storeUrl: 'https://play.google.com/store/apps/details?id=x' },
    });
    expect(appVersionAnswerSchema.safeParse(answer).success).toBe(true);
  });

  it('a tenant with no app row, or no floor, answers 0.0.0 and no store link, so the shell never blocks', async () => {
    const answer = await readAppVersion('rede-demo', {
      versions: versionStore({ 'rede-demo': noRow }),
    });
    expect(answer).toEqual({
      ios: { minVersion: '0.0.0', storeUrl: null },
      android: { minVersion: '0.0.0', storeUrl: null },
    });
  });

  it('a malformed stored floor (impossible by the CHECK) reads 0.0.0 and a non-https link reads null', () => {
    const answer = appVersionAnswerOf({
      minVersionIos: '1.2',
      minVersionAndroid: 'latest',
      storeUrlIos: 'http://apps.apple.com/app/id1',
      storeUrlAndroid: 'javascript:alert(1)',
    });
    expect(answer.ios).toEqual({ minVersion: '0.0.0', storeUrl: null });
    expect(answer.android).toEqual({ minVersion: '0.0.0', storeUrl: null });
    expect(appVersionAnswerSchema.safeParse(answer).success).toBe(true);
  });

  it('an unknown slug is 404 TENANT_NOT_FOUND, and so is a malformed one, without reading the store', async () => {
    const versions = versionStore({});
    await expect(readAppVersion('ninguem', { versions })).rejects.toMatchObject({
      status: 404,
      code: 'TENANT_NOT_FOUND',
    });
    const spy = vi.spyOn(versions, 'bySlug');
    await expect(readAppVersion('Rede-Demo', { versions })).rejects.toBeInstanceOf(ApiError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('nativeRequestOf (NATIVE-24 boundary: the header is a hint, never authority, T-13-25)', () => {
  it('an absent header is a browser', () => {
    expect(nativeRequestOf(undefined)).toEqual({ native: false, platform: null });
  });

  it('exactly ios and android select a platform', () => {
    expect(nativeRequestOf('ios')).toEqual({ native: true, platform: 'ios' });
    expect(nativeRequestOf('android')).toEqual({ native: true, platform: 'android' });
  });

  it.each(['', 'IOS', 'Android', 'ios ', ' ios', 'windows', 'ios,android', 'ios\n'])(
    'the value %j is native with no platform (fail closed)',
    (value) => {
      expect(nativeRequestOf(value)).toEqual({ native: true, platform: null });
    },
  );
});
