import {
  buildKeywords,
  buildReviewNotes,
  buildShortDescription,
  buildStoreDescription,
  buildStoreTitle,
} from '@rede-social/core/server/apps/listing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeStores, type FakeStores } from './fake-stores';
import { appleKeyPair, serviceAccount } from './fixtures';
import { parseCliArgs } from './index';
import { ageRatingAttributes, type ListingTenant, pushListing } from './listing';
import { createReporter, ReleaseRefusal } from './report';
import { createAppleClient } from './store-apple';
import { createGoogleClient } from './store-google';
import { StoreError } from './store-http';

/**
 * 13-31 Task 3 (D-607, NATIVE-29, T-13-55, T-13-56): the listing push through the plan 29 clients against the
 * loopback fakes. No test contacts a real Apple or Google host.
 */

const BUNDLE = 'test.cliente.listing';
const SENTINEL_PASSWORD = 'Sentinel-pass-9Zk4Qm7Xr2Wd8Tn5';
const apple = appleKeyPair();
const play = serviceAccount();
let fakes: FakeStores;

beforeAll(async () => {
  fakes = await createFakeStores({
    appleKeys: { KEYID12345: apple.publicKey },
    googleAccounts: { [play.email]: play.publicKey },
    appRecords: [BUNDLE],
    playPackages: [BUNDLE],
  });
});
afterAll(async () => {
  await fakes.close();
});

const appleClient = () =>
  createAppleClient({
    origin: fakes.apple.origin,
    keyId: 'KEYID12345',
    issuerId: '57246542-96fe-1a63-e053-0824d011072a',
    privateKey: apple.p8,
  });
const googleClient = () =>
  createGoogleClient({
    origin: fakes.google.origin,
    tokenOrigin: fakes.google.tokenOrigin,
    serviceAccount: play.json,
  });

const ICON = Buffer.from('89504e470d0a1a0a-icon-bytes', 'utf8');

const tenantOf = (patch: Partial<ListingTenant> = {}): ListingTenant => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Clube Aurora',
  modules: ['communities', 'events', 'chat'],
  primaryHost: 'comunidade.cliente.test',
  privacyUrl: 'https://comunidade.cliente.test/privacidade',
  reviewerEmail: 'app-review+0a1b2c3d@comunidade.cliente.test',
  reviewerHeld: true,
  bundleId: BUNDLE,
  applicationId: BUNDLE,
  contact: { email: 'suporte@cliente.test', name: 'Maria da Silva', phone: '+55 11 99999-0000' },
  playIcon: ICON,
  ...patch,
});

function harness(overrides: { readCredential?: () => Promise<string | null> } = {}) {
  const lines: string[] = [];
  const masks: string[] = [];
  const deps = {
    readCredential: overrides.readCredential ?? (async () => SENTINEL_PASSWORD),
    maskSink: (line: string) => masks.push(line),
    report: createReporter((line) => lines.push(line)),
  };
  return { deps, lines, masks };
}

/** Wraps a client so every call's arguments are recorded by method name (the values never leave the test). */
function recorded<T extends object>(client: T, calls: { method: string; args: string }[]): T {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args: JSON.stringify(args) });
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const reasonOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseRefusal) return error.reason;
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no refusal';
};

describe('the listing push reaches the fake stores with exactly the specified fields (NATIVE-29)', () => {
  it('sets the version localization, the privacy URL, the age rating, the review detail and the Play listing, details and icon', async () => {
    const before = fakes.counts();
    const { deps, lines } = harness();
    await pushListing({ tenant: tenantOf(), apple: appleClient(), google: googleClient(), deps });
    const state = fakes.listing();

    const expected = {
      description: buildStoreDescription({
        tenantName: 'Clube Aurora',
        modules: ['communities', 'events', 'chat'],
      }).text,
      keywords: buildKeywords({ tenantName: 'Clube Aurora' }).text,
      notes: buildReviewNotes({ tenantName: 'Clube Aurora' }).text,
      title: buildStoreTitle('Clube Aurora').text,
      short: buildShortDescription({ tenantName: 'Clube Aurora' }).text,
    };

    expect(state.apple.versionLocalizations).toEqual([
      expect.objectContaining({
        locale: 'pt-BR',
        description: expected.description,
        keywords: expected.keywords,
        supportUrl: 'https://comunidade.cliente.test',
      }),
    ]);
    expect(state.apple.appInfoLocalizations).toEqual([
      expect.objectContaining({
        locale: 'pt-BR',
        name: expected.title,
        privacyPolicyUrl: 'https://comunidade.cliente.test/privacidade',
      }),
    ]);
    const [rating] = Object.values(state.apple.ageRatings);
    expect(rating).toEqual(ageRatingAttributes());
    expect(rating).toMatchObject({
      userGeneratedContent: true,
      messagingAndChat: true,
      unrestrictedWebAccess: false,
      advertising: false,
      parentalControls: false,
      ageAssurance: false,
      ageRatingOverrideV2: 'THIRTEEN_PLUS',
    });
    expect(state.apple.reviewDetails).toHaveLength(1);
    expect(state.apple.reviewDetails[0]?.attributes).toEqual({
      contactFirstName: 'Maria',
      contactLastName: 'da Silva',
      contactPhone: '+55 11 99999-0000',
      contactEmail: 'suporte@cliente.test',
      demoAccountName: 'app-review+0a1b2c3d@comunidade.cliente.test',
      demoAccountPassword: SENTINEL_PASSWORD,
      demoAccountRequired: true,
      notes: expected.notes,
    });

    expect(state.google.listings[`${BUNDLE}:pt-BR`]).toEqual({
      title: expected.title,
      shortDescription: expected.short,
      fullDescription: expected.description,
    });
    expect(state.google.details[BUNDLE]).toEqual({
      contactEmail: 'suporte@cliente.test',
      contactWebsite: 'https://comunidade.cliente.test',
      defaultLanguage: 'pt-BR',
    });
    expect(state.google.icons[`${BUNDLE}:pt-BR`]).toEqual([ICON.length]);

    const after = fakes.counts();
    expect(after.committedEdits - before.committedEdits).toBe(1);
    expect(after.deletedEdits).toBe(before.deletedEdits);
    expect(lines).toContain('app-release listing.ios.localization created');
    expect(lines).toContain('app-release listing.android.icon ok');
  });

  it('pushing again leaves the stores in the same state: the same rows, no duplicate review detail, one icon', async () => {
    const first = fakes.listing();
    const counts = fakes.counts();
    const { deps, lines } = harness();
    await pushListing({ tenant: tenantOf(), apple: appleClient(), google: googleClient(), deps });
    expect(fakes.listing()).toEqual(first);
    const after = fakes.counts();
    expect(after.versionLocalizations).toBe(counts.versionLocalizations);
    expect(after.appInfoLocalizations).toBe(counts.appInfoLocalizations);
    expect(after.reviewDetails).toBe(counts.reviewDetails);
    expect(after.playIcons).toBe(1);
    expect(lines).toContain('app-release listing.ios.localization reused');
    expect(lines).toContain('app-release listing.ios.review-detail reused');
  });

  it('pushes one platform only when the other client is null', async () => {
    const before = fakes.counts();
    const { deps } = harness();
    await pushListing({ tenant: tenantOf(), apple: null, google: googleClient(), deps });
    const after = fakes.counts();
    expect(after.committedEdits - before.committedEdits).toBe(1);
    expect(after.reviewDetails).toBe(before.reviewDetails);
  });
});

describe('it refuses before any store call when a piece is missing (NATIVE-29 empty)', () => {
  const cases: [string, Partial<ListingTenant>, string][] = [
    ['a missing privacy URL', { privacyUrl: null }, 'privacy_url_missing'],
    ['a blank privacy URL', { privacyUrl: '' }, 'privacy_url_missing'],
    ['no reviewer account', { reviewerEmail: null }, 'reviewer_missing'],
    ['a reviewer address whose password is not held', { reviewerHeld: false }, 'reviewer_missing'],
    ['no contact', { contact: null }, 'contact_missing'],
    [
      'a contact without a phone for the App Store',
      { contact: { email: 'suporte@cliente.test', name: 'Maria', phone: '' } },
      'contact_missing',
    ],
    [
      'a contact whose address is not an address',
      { contact: { email: 'sem-arroba', name: 'Maria', phone: '+55 11 99999-0000' } },
      'contact_missing',
    ],
    ['an empty tenant name', { displayName: '   ' }, 'tenant_name_empty'],
    ['no Play icon', { playIcon: null }, 'artifact_missing'],
  ];

  for (const [name, patch, reason] of cases) {
    it(`${name} is ${reason} and nothing is called`, async () => {
      const requestsBefore = fakes.requests().length;
      const tokensBefore = fakes.counts().tokenExchanges;
      const { deps } = harness();
      const refused = await reasonOf(() =>
        pushListing({
          tenant: tenantOf(patch),
          apple: appleClient(),
          google: googleClient(),
          deps,
        }),
      );
      expect(refused).toBe(reason);
      expect(fakes.requests().length).toBe(requestsBefore);
      expect(fakes.counts().tokenExchanges).toBe(tokensBefore);
    });
  }

  it('a contact without a phone is enough for a Play-only push', async () => {
    const { deps } = harness();
    await pushListing({
      tenant: tenantOf({ contact: { email: 'suporte@cliente.test', name: '', phone: '' } }),
      apple: null,
      google: googleClient(),
      deps,
    });
  });
});

describe('encoding: a name with accents and an emoji, keywords counted in bytes (NATIVE-29 encoding)', () => {
  it('survives a round trip through the fake store, with ids and URLs in ASCII', async () => {
    const name = 'Associação São João 🎉 Café';
    const { deps } = harness();
    await pushListing({
      tenant: tenantOf({ displayName: name }),
      apple: appleClient(),
      google: googleClient(),
      deps,
    });
    const state = fakes.listing();
    expect(state.apple.versionLocalizations[0]?.description).toContain(name);
    expect(state.google.listings[`${BUNDLE}:pt-BR`]?.fullDescription).toContain(name);
    expect(state.google.listings[`${BUNDLE}:pt-BR`]?.title).toBe(name);
    expect(state.apple.reviewDetails[0]?.attributes.notes).toContain(name);
    // Identifiers and links stay ASCII.
    expect(BUNDLE).toMatch(/^[\x20-\x7e]+$/);
    expect(state.apple.versionLocalizations[0]?.supportUrl).toMatch(/^[\x20-\x7e]+$/);
    expect(state.apple.appInfoLocalizations[0]?.privacyPolicyUrl).toMatch(/^[\x20-\x7e]+$/);
  });

  it('keywords of 3-byte characters are cut to fit 100 bytes and the store accepts them', async () => {
    const wide = `${'日本語'.repeat(11)}${'あ'.repeat(1)}`; // 34 characters, 102 bytes
    expect([...wide]).toHaveLength(34);
    const { deps } = harness();
    await pushListing({
      tenant: tenantOf({ displayName: wide }),
      apple: appleClient(),
      google: null,
      deps,
    });
    const keywords = fakes.listing().apple.versionLocalizations[0]?.keywords ?? '';
    expect(Buffer.byteLength(keywords, 'utf8')).toBeLessThanOrEqual(100);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('a tenant whose name is as long as the store limit never produces an over-length field', async () => {
    const name = 'palavra '.repeat(700).trim();
    const { deps } = harness();
    await pushListing({
      tenant: tenantOf({ displayName: name }),
      apple: appleClient(),
      google: googleClient(),
      deps,
    });
    const state = fakes.listing();
    const play = state.google.listings[`${BUNDLE}:pt-BR`];
    expect([...(play?.title ?? '')].length).toBeLessThanOrEqual(30);
    expect([...(play?.shortDescription ?? '')].length).toBeLessThanOrEqual(80);
    expect([...(play?.fullDescription ?? '')].length).toBeLessThanOrEqual(4000);
  });
});

describe('the demo password (T-13-55)', () => {
  it('is masked before the call that sets it, reaches only that call, and never reaches the output or a request log', async () => {
    const calls: { method: string; args: string }[] = [];
    const { deps, lines, masks } = harness();
    const order: string[] = [];
    const maskSink = (line: string) => {
      order.push('mask');
      masks.push(line);
    };
    const client = appleClient();
    const watched = {
      ...recorded(client, calls),
      upsertDemoAccount: (
        version: string,
        detail: Parameters<typeof client.upsertDemoAccount>[1],
      ) => {
        order.push('review-detail');
        return client.upsertDemoAccount(version, detail);
      },
    };
    await pushListing({
      tenant: tenantOf(),
      apple: watched,
      google: googleClient(),
      deps: { ...deps, maskSink },
    });

    // Masked first (the runner redacts it from every later line), then handed to the one call.
    expect(masks).toContain(`::add-mask::${SENTINEL_PASSWORD}`);
    expect(order.indexOf('mask')).toBeLessThan(order.indexOf('review-detail'));
    // Only the review-detail call carried it.
    for (const call of calls) {
      if (call.method === 'upsertDemoAccount') expect(call.args).toContain(SENTINEL_PASSWORD);
      else expect(call.args, call.method).not.toContain(SENTINEL_PASSWORD);
    }
    // Not in what the command prints, not in the fakes' request log.
    expect(lines.join('\n')).not.toContain(SENTINEL_PASSWORD);
    expect(JSON.stringify(fakes.requests())).not.toContain(SENTINEL_PASSWORD);
  });

  it('a reviewer whose password is not held refuses without calling the store', async () => {
    const requestsBefore = fakes.requests().length;
    const { deps } = harness({ readCredential: async () => null });
    const refused = await reasonOf(() =>
      pushListing({ tenant: tenantOf(), apple: appleClient(), google: null, deps }),
    );
    expect(refused).toBe('reviewer_missing');
    expect(fakes.requests().length).toBe(requestsBefore);
  });
});

describe('what it never does (D-619, T-13-56)', () => {
  it('no request of any listing push touches a review submission, a charge or a territory, or a track', async () => {
    const { deps } = harness();
    const startAt = fakes.requests().length;
    await pushListing({ tenant: tenantOf(), apple: appleClient(), google: googleClient(), deps });
    const paths = fakes
      .requests()
      .slice(startAt)
      .map((request) => `${request.method} ${request.path}`);
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      expect(path).not.toMatch(/reviewSubmissions|Price|price|Availab|availab|territor|\/tracks\//);
    }
    expect(fakes.counts().reviewSubmissions).toBe(0);
    expect(fakes.counts().otherTrackUpdates).toBe(0);
    expect(fakes.counts().internalTrackUpdates).toBe(0);
  });
});

describe('store failures are closed reasons, and an open Play edit is removed (NATIVE-29)', () => {
  it('an app record the App Store does not know is app_record_missing before any write', async () => {
    const { deps } = harness();
    const refused = await reasonOf(() =>
      pushListing({
        tenant: tenantOf({ bundleId: 'test.cliente.unknown' }),
        apple: appleClient(),
        google: null,
        deps,
      }),
    );
    expect(refused).toBe('app_record_missing');
  });

  it('a Play package the console does not know is app_record_missing', async () => {
    const { deps } = harness();
    const refused = await reasonOf(() =>
      pushListing({
        tenant: tenantOf({ applicationId: 'test.cliente.unknown' }),
        apple: null,
        google: googleClient(),
        deps,
      }),
    );
    expect(refused).toBe('app_record_missing');
  });

  it('a failure in the middle of the Play edit deletes the edit, so nothing half-done is committed', async () => {
    const packageName = 'test.cliente.listing';
    const before = fakes.listing().google.listings[`${packageName}:pt-BR`];
    const beforeCounts = fakes.counts();
    const real = googleClient();
    const failing = {
      ...real,
      replaceIcon: async () => {
        throw new StoreError('store_unavailable');
      },
    };
    const { deps, lines } = harness();
    const refused = await reasonOf(() =>
      pushListing({
        tenant: tenantOf({ displayName: 'Nome que nunca chega ao Play' }),
        apple: null,
        google: failing,
        deps,
      }),
    );
    expect(refused).toBe('store_failed');
    expect(lines).toContain('app-release listing.android failed store_unavailable');
    expect(fakes.counts().deletedEdits - beforeCounts.deletedEdits).toBe(1);
    expect(fakes.counts().committedEdits).toBe(beforeCounts.committedEdits);
    expect(fakes.listing().google.listings[`${packageName}:pt-BR`]).toEqual(before);
  });
});

describe('the command line (13-31)', () => {
  it('reads the contact and the skip flag, and refuses a malformed contact', () => {
    const parsed = parseCliArgs([
      'publish',
      'comunidade',
      '--contact-email',
      'suporte@cliente.test',
      '--contact-name',
      'Maria da Silva',
      '--contact-phone',
      '+55 11 99999-0000',
    ]);
    expect(parsed.skipListing).toBe(false);
    expect(parsed.contact).toEqual({
      email: 'suporte@cliente.test',
      name: 'Maria da Silva',
      phone: '+55 11 99999-0000',
    });
    expect(parseCliArgs(['publish', 'comunidade', '--skip-listing']).skipListing).toBe(true);
    expect(parseCliArgs(['publish', 'comunidade']).contact).toBeNull();
    for (const bad of [
      ['--contact-email', 'sem-arroba'],
      ['--contact-email', 'a@b.test', '--contact-phone', 'abc'],
      ['--contact-email', 'a@b.test', '--contact-name', ''],
    ]) {
      expect(() => parseCliArgs(['publish', 'comunidade', ...bad])).toThrow(ReleaseRefusal);
    }
  });
});
