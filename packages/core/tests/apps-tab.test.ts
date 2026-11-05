import { appTabSchema } from '@rede-social/contracts/native';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AppRow,
  invalidatePurchaseSwitch,
  purchaseSwitchCache,
  readAppTab,
  setAppIds,
  setAppLinks,
  setChecklistFlag,
  setPrivacyUrl,
  setPurchaseSwitch,
} from '../server/apps/index';
import { memoryAppStore, memoryCredentialStore } from './fixtures/apps-memory';

/**
 * 13-09 Task 2 (D-615, D-617, D-611, NATIVE-24, NATIVE-26, T-13-18): the remaining writes of the App tab and the
 * state derived from them, at unit level over in-memory stores. The same routes run against the real tables in
 * `apps/api/tests/integration/platform-apps.test.ts`.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const NO_HOST_TENANT = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';
const LONG_NAME = 'Associação Beneficente dos Amigos da Comunidade Digital';
const FINGERPRINT =
  'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const BARE_FINGERPRINT = FINGERPRINT.replaceAll(':', '').toLowerCase();

let app: ReturnType<typeof memoryAppStore>;
let deps: {
  app: ReturnType<typeof memoryAppStore>['store'];
  credentials: ReturnType<typeof memoryCredentialStore>['store'];
};

beforeEach(() => {
  app = memoryAppStore({
    [TENANT]: { displayName: LONG_NAME, primaryHost: 'comunidade.cliente.com.br' },
    [NO_HOST_TENANT]: { displayName: 'Sem endereço', primaryHost: null },
  });
  deps = { app: app.store, credentials: memoryCredentialStore().store };
  invalidatePurchaseSwitch(TENANT);
  invalidatePurchaseSwitch(NO_HOST_TENANT);
});

const row = (tenantId = TENANT): AppRow => {
  const found = app.rows.get(tenantId);
  if (!found) throw new Error('no row');
  return found;
};

describe('readAppTab for a tenant with no row (the empty form)', () => {
  it('derives the ids from the host, reads state none, both switches off, 0 of 10 and a cut 30-character store name', async () => {
    const tab = await readAppTab(TENANT, deps);

    expect(tab.identity.bundleId).toBe('br.com.cliente.comunidade');
    expect(tab.identity.applicationId).toBe('br.com.cliente.comunidade');
    expect(tab.identity.idsDefault).toBe(true);
    expect(tab.identity.idsLocked).toBe(false);
    expect(tab.appState).toBe('none');
    expect(tab.purchase).toEqual({ ios: false, android: false });
    expect(tab.checklist.done).toBe(0);
    expect(tab.checklist.total).toBe(10);
    expect(Array.from(tab.listing.name.name).length).toBeLessThanOrEqual(30);
    expect(tab.listing.name.cut).toBe(true);
    expect(tab.identity.shortName.name.length).toBeLessThanOrEqual(12);
    expect(tab.links.verdict).toEqual({ ios: 'missing_team', android: 'missing_fingerprint' });
    expect(app.rows.size).toBe(0);
    expect(appTabSchema.safeParse(tab).success).toBe(true);
  });

  it('a tenant with no verified host has no derived ids and the verdict no_host on both sides', async () => {
    const tab = await readAppTab(NO_HOST_TENANT, deps);
    expect(tab.identity.bundleId).toBeNull();
    expect(tab.identity.applicationId).toBeNull();
    expect(tab.identity.idsDefault).toBe(false);
    expect(tab.links.verdict).toEqual({ ios: 'no_host', android: 'no_host' });
  });
});

describe('setAppIds (D-615, T-13-18)', () => {
  it('accepts valid ids and stores them; the read shows them as saved, not as defaults', async () => {
    await setAppIds(
      TENANT,
      { bundleId: 'br.com.cliente.app', applicationId: 'br.com.cliente.app' },
      deps,
    );
    const tab = await readAppTab(TENANT, deps);
    expect(tab.identity.bundleId).toBe('br.com.cliente.app');
    expect(tab.identity.idsDefault).toBe(false);
  });

  it('refuses a malformed id with VALIDATION_FAILED and changes nothing', async () => {
    for (const input of [
      { bundleId: 'semponto', applicationId: 'br.com.cliente.app' },
      { bundleId: 'br.com.cliente.app', applicationId: 'br.com.1cliente' },
      { bundleId: 'br.com.cliente_app', applicationId: 'br.com.cliente.app' },
    ]) {
      await expect(setAppIds(TENANT, input, deps)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(app.rows.size).toBe(0);
  });

  it('after the published flag is set the ids answer IDS_LOCKED (409); un-setting it unlocks', async () => {
    await setAppIds(
      TENANT,
      { bundleId: 'br.com.cliente.app', applicationId: 'br.com.cliente.app' },
      deps,
    );
    await setChecklistFlag(TENANT, 'published', true, deps);
    expect(row().idsLockedAt).not.toBeNull();

    await expect(
      setAppIds(TENANT, { bundleId: 'br.com.outro.app', applicationId: 'br.com.outro.app' }, deps),
    ).rejects.toMatchObject({ status: 409, code: 'IDS_LOCKED' });
    expect(row().bundleId).toBe('br.com.cliente.app');
    expect((await readAppTab(TENANT, deps)).identity.idsLocked).toBe(true);

    await setChecklistFlag(TENANT, 'published', false, deps);
    expect(row().idsLockedAt).toBeNull();
    await setAppIds(
      TENANT,
      { bundleId: 'br.com.outro.app', applicationId: 'br.com.outro.app' },
      deps,
    );
    expect(row().bundleId).toBe('br.com.outro.app');
  });

  it('published before any ids: the flag is set and the lock waits for the ids, then engages', async () => {
    await setChecklistFlag(TENANT, 'published', true, deps);
    expect(row().manualPublished).toBe(true);
    expect(row().idsLockedAt).toBeNull();

    await setAppIds(
      TENANT,
      { bundleId: 'br.com.cliente.app', applicationId: 'br.com.cliente.app' },
      deps,
    );
    expect(row().idsLockedAt).not.toBeNull();
  });
});

describe('setAppLinks (D-611, D-615)', () => {
  it('stores the Team ID upper-case and the fingerprint normalised, and the verdicts turn live', async () => {
    await setAppLinks(TENANT, { teamId: 'abcde12345', sha256: BARE_FINGERPRINT }, deps);
    expect(row().teamId).toBe('ABCDE12345');
    expect(row().androidSha256).toEqual([FINGERPRINT]);

    const tab = await readAppTab(TENANT, deps);
    expect(tab.links).toEqual({
      teamId: 'ABCDE12345',
      fingerprint: FINGERPRINT,
      verdict: { ios: 'live', android: 'live' },
    });
  });

  it('rejects a 9-character Team ID and a malformed fingerprint with VALIDATION_FAILED, storing nothing', async () => {
    await expect(
      setAppLinks(TENANT, { teamId: 'ABCDE1234', sha256: null }, deps),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      setAppLinks(TENANT, { teamId: null, sha256: 'AB:CD' }, deps),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(app.rows.size).toBe(0);
  });

  it('null clears either value, each on its own', async () => {
    await setAppLinks(TENANT, { teamId: 'ABCDE12345', sha256: FINGERPRINT }, deps);
    await setAppLinks(TENANT, { teamId: null, sha256: FINGERPRINT }, deps);
    expect(row().teamId).toBeNull();
    expect(row().androidSha256).toEqual([FINGERPRINT]);
    await setAppLinks(TENANT, { teamId: 'ABCDE12345', sha256: null }, deps);
    expect(row().androidSha256).toEqual([]);
    const tab = await readAppTab(TENANT, deps);
    expect(tab.links.verdict).toEqual({ ios: 'live', android: 'missing_fingerprint' });
  });

  it('a tenant with no verified primary host reads no_host however complete the data is', async () => {
    await setAppLinks(NO_HOST_TENANT, { teamId: 'ABCDE12345', sha256: FINGERPRINT }, deps);
    const tab = await readAppTab(NO_HOST_TENANT, deps);
    expect(tab.links.verdict).toEqual({ ios: 'no_host', android: 'no_host' });
  });
});

describe('setPurchaseSwitch (D-617, NATIVE-24)', () => {
  it('flips only the iOS switch, and the first write creates the row with the OTHER switch off', async () => {
    expect(app.rows.size).toBe(0);
    await setPurchaseSwitch(TENANT, 'ios', true, deps);
    expect(row().purchaseIos).toBe(true);
    expect(row().purchaseAndroid).toBe(false);
    expect((await readAppTab(TENANT, deps)).purchase).toEqual({ ios: true, android: false });
  });

  it('the same call twice leaves the same state, and turning it back off restores the default', async () => {
    await setPurchaseSwitch(TENANT, 'android', true, deps);
    await setPurchaseSwitch(TENANT, 'android', true, deps);
    expect(row()).toMatchObject({ purchaseIos: false, purchaseAndroid: true });
    await setPurchaseSwitch(TENANT, 'android', false, deps);
    expect(row()).toMatchObject({ purchaseIos: false, purchaseAndroid: false });
  });

  it('invalidates the in-process purchase cache of the tenant, and only of that tenant', async () => {
    purchaseSwitchCache.set(TENANT, { ios: false, android: false }, 15_000);
    purchaseSwitchCache.set(NO_HOST_TENANT, { ios: false, android: false }, 15_000);
    await setPurchaseSwitch(TENANT, 'ios', true, deps);
    expect(purchaseSwitchCache.get(TENANT)).toBeUndefined();
    expect(purchaseSwitchCache.get(NO_HOST_TENANT)).toBeDefined();
    purchaseSwitchCache.set(TENANT, { ios: true, android: false }, 15_000);
    invalidatePurchaseSwitch(TENANT);
    expect(purchaseSwitchCache.get(TENANT)).toBeUndefined();
  });

  it('no code path of the module defaults a switch to on', async () => {
    await setChecklistFlag(TENANT, 'screenshots', true, deps);
    await setPrivacyUrl(TENANT, 'https://cliente.com.br/privacidade', deps);
    expect(row()).toMatchObject({ purchaseIos: false, purchaseAndroid: false });
  });
});

describe('setPrivacyUrl and setChecklistFlag (UI-D-626, UI-D-627)', () => {
  it('accepts an https address and refuses http, a javascript URL, a non-URL and 2049 characters', async () => {
    await setPrivacyUrl(TENANT, 'https://cliente.com.br/privacidade', deps);
    expect(row().privacyUrl).toBe('https://cliente.com.br/privacidade');

    for (const bad of [
      'http://cliente.com.br/privacidade',
      'javascript:alert(1)',
      'privacidade',
      `https://cliente.com.br/${'a'.repeat(2030)}`,
      '',
    ]) {
      await expect(setPrivacyUrl(TENANT, bad, deps)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(row().privacyUrl).toBe('https://cliente.com.br/privacidade');
  });

  it('a manual flag round-trips and moves the count in the read', async () => {
    expect((await readAppTab(TENANT, deps)).checklist.done).toBe(0);
    await setChecklistFlag(TENANT, 'screenshots', true, deps);
    const tab = await readAppTab(TENANT, deps);
    expect(tab.checklist.manual.screenshots).toBe(true);
    expect(tab.checklist.done).toBe(1);
    expect(tab.appState).toBe('preparing');
    await setChecklistFlag(TENANT, 'screenshots', false, deps);
    expect((await readAppTab(TENANT, deps)).checklist.done).toBe(0);
  });

  it('refuses a key outside the five manual keys', async () => {
    await expect(setChecklistFlag(TENANT, 'storeKeys', true, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(app.rows.size).toBe(0);
  });

  it('the privacy address and the flags move the derived checklist rows', async () => {
    await setPrivacyUrl(TENANT, 'https://cliente.com.br/privacidade', deps);
    const tab = await readAppTab(TENANT, deps);
    expect(tab.checklist.auto.privacyUrl).toBe(true);
    expect(tab.checklist.done).toBe(1);
  });
});

describe('every write on an unknown tenant is 404 NOT_FOUND', () => {
  it('answers NOT_FOUND and creates nothing', async () => {
    const calls = [
      () => setAppIds(UNKNOWN, { bundleId: 'br.com.a.b', applicationId: 'br.com.a.b' }, deps),
      () => setAppLinks(UNKNOWN, { teamId: 'ABCDE12345', sha256: null }, deps),
      () => setPurchaseSwitch(UNKNOWN, 'ios', true, deps),
      () => setPrivacyUrl(UNKNOWN, 'https://a.com.br/p', deps),
      () => setChecklistFlag(UNKNOWN, 'screenshots', true, deps),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    }
    expect(app.rows.size).toBe(0);
  });
});
