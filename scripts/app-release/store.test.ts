import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeStores, type FakeStores } from './fake-stores';
import { appleKeyPair, serviceAccount } from './fixtures';
import { createAppleClient } from './store-apple';
import { createGoogleClient } from './store-google';
import { StoreError } from './store-http';

/** Every origin here is a loopback fake (`fake-stores.ts`): no test contacts a real Apple, Google or Firebase host. */

const apple = appleKeyPair();
const play = serviceAccount();
let fakes: FakeStores;

beforeAll(async () => {
  fakes = await createFakeStores({
    appleKeys: { KEYID12345: apple.publicKey },
    googleAccounts: { [play.email]: play.publicKey },
    appRecords: ['test.cliente.registered'],
    playPackages: ['test.cliente.registered'],
  });
});
afterAll(async () => {
  await fakes.close();
});

const appleClient = (overrides: Partial<Parameters<typeof createAppleClient>[0]> = {}) =>
  createAppleClient({
    origin: fakes.apple.origin,
    keyId: 'KEYID12345',
    issuerId: '57246542-96fe-1a63-e053-0824d011072a',
    privateKey: apple.p8,
    ...overrides,
  });
const googleClient = () =>
  createGoogleClient({
    origin: fakes.google.origin,
    tokenOrigin: fakes.google.tokenOrigin,
    serviceAccount: play.json,
  });

const errorOf = async (promise: Promise<unknown>): Promise<StoreError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error('expected a StoreError');
};

describe('App Store Connect client', () => {
  it('signs an ES256 token that lives at most 20 minutes and is verified against the key', async () => {
    const client = appleClient();
    await client.registerBundleId('test.cliente.tokens', 'Tokens');
    expect(fakes.lastAppleToken()).toMatchObject({
      kid: 'KEYID12345',
      iss: '57246542-96fe-1a63-e053-0824d011072a',
      lifetimeSeconds: 1200,
    });
  });

  it('reuses the token until a minute before it expires, then signs a new one', async () => {
    let now = Date.UTC(2026, 10, 5, 12, 0, 0);
    const client = appleClient({ now: () => now });
    await client.findApp('test.cliente.registered');
    const first = fakes.lastAppleToken();
    now += 10 * 60 * 1000;
    await client.findApp('test.cliente.registered');
    expect(fakes.lastAppleToken()).toEqual(first);
    now += 10 * 60 * 1000; // 20 minutes after the first: past the refresh margin
    await client.findApp('test.cliente.registered');
    expect(fakes.lastAppleToken()?.issuedAt).toBeGreaterThan(
      first?.issuedAt ?? Number.POSITIVE_INFINITY,
    );
  });

  it('answers store_auth_failed when the key does not match what the store knows', async () => {
    const other = appleKeyPair();
    const error = await errorOf(appleClient({ privateKey: other.p8 }).findApp('x.y.z'));
    expect(error.code).toBe('store_auth_failed');
    expect(error.message).toBe('store_auth_failed');
  });

  it('registers a bundle id once and finds an exact match among prefix matches', async () => {
    const client = appleClient();
    const before = fakes.counts().bundleIds;
    const first = await client.registerBundleId('test.cliente.idem', 'Idem');
    const again = await client.registerBundleId('test.cliente.idem', 'Idem');
    const longer = await client.registerBundleId('test.cliente.idem2', 'Idem 2');
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(longer.created).toBe(true);
    expect(fakes.counts().bundleIds - before).toBe(2);
  });

  it('enables Push Notifications and Associated Domains once', async () => {
    const client = appleClient();
    const bundle = await client.registerBundleId('test.cliente.caps', 'Caps');
    expect((await client.ensureCapabilities(bundle.id)).added).toEqual([
      'PUSH_NOTIFICATIONS',
      'ASSOCIATED_DOMAINS',
    ]);
    expect((await client.ensureCapabilities(bundle.id)).added).toEqual([]);
  });

  it('creates a certificate, then one profile that later calls reuse', async () => {
    const client = appleClient();
    const bundle = await client.registerBundleId('test.cliente.profile', 'Profile');
    const certificate = await client.createCertificate(
      '-----BEGIN CERTIFICATE REQUEST-----\nQUJD\n-----END CERTIFICATE REQUEST-----',
    );
    const before = fakes.counts().profileCreates;
    const first = await client.ensureProfile({
      name: 'app-profile',
      bundleResourceId: bundle.id,
      certificateId: certificate.id,
    });
    const again = await client.ensureProfile({
      name: 'app-profile',
      bundleResourceId: bundle.id,
      certificateId: certificate.id,
    });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(fakes.counts().profileCreates - before).toBe(1);
  });

  it('answers null for a bundle id with no app record (the app_record_missing preflight) and the app when it exists', async () => {
    const client = appleClient();
    await client.registerBundleId('test.cliente.registered', 'Registered');
    await client.registerBundleId('test.cliente.norecord', 'No record');
    expect(await client.findApp('test.cliente.norecord')).toBeNull();
    expect(await client.findApp('test.cliente.registered')).toEqual({
      id: 'app-test.cliente.registered',
    });
  });

  it('polls a build to its processing state', async () => {
    const client = appleClient();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    expect(
      await client.pollBuild({
        appId: 'app-test.cliente.registered',
        buildNumber: 41,
        attempts: 3,
        delayMs: 5,
        sleep,
      }),
    ).toBe('PROCESSING');
    expect(sleeps).toEqual([5, 5]);
    fakes.markBuildUploaded('test.cliente.registered', 41, 'VALID');
    expect(
      await client.pollBuild({
        appId: 'app-test.cliente.registered',
        buildNumber: 41,
        attempts: 3,
        delayMs: 5,
        sleep,
      }),
    ).toBe('VALID');
    fakes.markBuildUploaded('test.cliente.registered', 42, 'FAILED');
    expect(
      await client.pollBuild({ appId: 'app-test.cliente.registered', buildNumber: 42, sleep }),
    ).toBe('FAILED');
    expect(
      await client.attachBuildToInternalGroup({
        appId: 'app-test.cliente.registered',
        buildNumber: 41,
      }),
    ).toEqual({ attached: true });
  });

  it('has no way to submit for review (Apple 4.2.6)', async () => {
    const methods = Object.keys(appleClient());
    expect(methods.filter((name) => /review|submit/i.test(name))).toEqual([]);
    expect(fakes.counts().reviewSubmissions).toBe(0);
  });

  it('refuses an origin that is neither https nor loopback before attaching any credential', () => {
    expect(() => appleClient({ origin: 'http://api.evil.example' })).toThrow('store_rejected');
    expect(() => appleClient({ origin: 'ftp://127.0.0.1' })).toThrow('store_rejected');
    expect(() => appleClient({ origin: 'not a url' })).toThrow('store_rejected');
  });

  it('maps a network failure to store_unavailable and never echoes anything', async () => {
    const dead = await createFakeStores();
    const origin = dead.apple.origin;
    await dead.close();
    const error = await errorOf(appleClient({ origin }).findApp('a.b.c'));
    expect(error.code).toBe('store_unavailable');
  });
});

describe('Google Play client', () => {
  it('exchanges a service-account assertion (RS256, right audience and scope) and reuses the token', async () => {
    const client = googleClient();
    const before = fakes.counts().tokenExchanges;
    const edit = await client.insertEdit('test.cliente.registered');
    await client.deleteEdit('test.cliente.registered', edit.id);
    expect(fakes.counts().tokenExchanges - before).toBe(1);
  });

  it('runs the edit: upload, internal track, validate, commit', async () => {
    const client = googleClient();
    const before = fakes.counts();
    const edit = await client.insertEdit('test.cliente.registered');
    const { versionCode } = await client.uploadBundle(
      'test.cliente.registered',
      edit.id,
      Buffer.from('aab-bytes'),
    );
    await client.updateInternalTrack('test.cliente.registered', edit.id, { versionCode });
    await client.validateEdit('test.cliente.registered', edit.id);
    await client.commitEdit('test.cliente.registered', edit.id);
    const after = fakes.counts();
    expect(after.bundlesUploaded - before.bundlesUploaded).toBe(1);
    expect(after.committedEdits - before.committedEdits).toBe(1);
    expect(after.internalTrackUpdates - before.internalTrackUpdates).toBe(1);
    expect(after.otherTrackUpdates).toBe(0);
    expect(fakes.trackUpdates().at(-1)).toEqual({
      track: 'internal',
      status: 'draft',
      versionCodes: [String(versionCode)],
    });
  });

  it('answers store_not_found for an app the Play Console does not have (the preflight)', async () => {
    const error = await errorOf(googleClient().insertEdit('test.cliente.absent'));
    expect(error.code).toBe('store_not_found');
  });

  it('refuses a service account that is not a service account, and an unsafe origin', () => {
    expect(() =>
      createGoogleClient({
        origin: fakes.google.origin,
        tokenOrigin: fakes.google.tokenOrigin,
        serviceAccount: '{}',
      }),
    ).toThrow('store_auth_failed');
    expect(() =>
      createGoogleClient({ origin: 'http://evil.example', serviceAccount: play.json }),
    ).toThrow('store_rejected');
  });

  it('answers store_auth_failed when the token endpoint refuses the assertion', async () => {
    const other = serviceAccount(play.email);
    const strict = await createFakeStores({ googleAccounts: { [play.email]: play.publicKey } });
    const client = createGoogleClient({
      origin: strict.google.origin,
      tokenOrigin: strict.google.tokenOrigin,
      serviceAccount: other.json,
    });
    const error = await errorOf(client.insertEdit('x.y.z'));
    expect(error.code).toBe('store_auth_failed');
    await strict.close();
  });
});
