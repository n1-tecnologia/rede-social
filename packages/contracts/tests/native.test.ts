import { describe, expect, it } from 'vitest';
import {
  APP_CHECKLIST_AUTO_KEYS,
  APP_CHECKLIST_MANUAL_KEYS,
  APP_CREDENTIAL_KINDS,
  type AppStateInput,
  apnsKeyBodySchema,
  appCredentialHeldSchema,
  appState,
  appVersionAnswerSchema,
  ascKeyBodySchema,
  checklistCounts,
  compareVersions,
  credentialAnswerSchema,
  deriveAppIds,
  deriveIconLabel,
  deriveStoreName,
  isBelowMinVersion,
  isValidApplicationId,
  isValidBundleId,
  isValidTeamId,
  linkVerdict,
  normalizeFingerprint,
  playServiceAccountBodySchema,
  REMOVED_MEMBER_NAME,
  tenantBuildSchema,
} from '../src/native';

/**
 * 13-03 task 3 (D-607, NATIVE-02, NATIVE-32): the id derivation, the store-name cuts, the state
 * functions, the version rule, the build record and the write-only credential bodies.
 */

const codePoints = (value: string) => Array.from(value).length;

describe('deriveAppIds', () => {
  it.each([
    ['comunidade.cliente.com.br', 'br.com.cliente.comunidade'],
    ['my-community.example.com.br', 'br.com.example.my_community'],
    ['1st.example.com', 'com.example.x1st'],
    ['COMUNIDADE.Cliente.COM', 'com.cliente.comunidade'],
    ['xn--exmplo-gva.com', 'com.xn__exmplo_gva'],
    ['comunidade.cliente.com.br:3000', 'br.com.cliente.comunidade'],
  ])('%s -> %s', (host, id) => {
    expect(deriveAppIds(host)).toEqual({ ios: id, android: id });
  });

  it('returns null for a non-ASCII host, a single label, an empty label, empty and null input', () => {
    for (const host of [
      'comunidade.exémplo.com',
      'localhost',
      'a..b',
      '',
      null,
      undefined,
      '.',
      '127.0.0.1',
    ]) {
      expect(deriveAppIds(host)).toBeNull();
    }
    expect(deriveAppIds(42 as unknown as string)).toBeNull();
  });

  it('every non-null result passes both validators, over 200 generated hosts, and is idempotent', () => {
    let seed = 20261105;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
    const label = () => {
      const length = 1 + Math.floor(next() * 12);
      let out = alphabet[Math.floor(next() * 36)] as string;
      for (let i = 1; i < length; i += 1) out += alphabet[Math.floor(next() * alphabet.length)];
      return out;
    };
    let derived = 0;
    for (let i = 0; i < 200; i += 1) {
      const host = Array.from({ length: 2 + Math.floor(next() * 4) }, label).join('.');
      const ids = deriveAppIds(host);
      expect(deriveAppIds(host)).toEqual(ids);
      if (ids) {
        derived += 1;
        expect(isValidBundleId(ids.ios)).toBe(true);
        expect(isValidApplicationId(ids.android)).toBe(true);
      }
    }
    expect(derived).toBeGreaterThan(150);
  });

  it('is pure: 1,000 interleaved derivations over different hosts each get their own id', async () => {
    const hosts = Array.from({ length: 1000 }, (_, i) => `app${i}.cliente${i % 7}.com.br`);
    const results = await Promise.all(
      hosts.map(async (host, i) => {
        if (i % 3 === 0) await Promise.resolve();
        return deriveAppIds(host);
      }),
    );
    results.forEach((ids, i) => {
      expect(ids?.android).toBe(`br.com.cliente${i % 7}.app${i}`);
    });
  });
});

describe('the id validators', () => {
  it('accept real ids and refuse the malformed ones', () => {
    expect(isValidApplicationId('br.com.cliente.comunidade')).toBe(true);
    expect(isValidApplicationId('com.my_app')).toBe(true);
    expect(isValidApplicationId('com.my-app')).toBe(false);
    expect(isValidApplicationId('comunidade')).toBe(false);
    expect(isValidApplicationId('com.1app')).toBe(false);
    expect(isValidApplicationId('com..app')).toBe(false);
    expect(isValidBundleId('com.my-app')).toBe(true);
    expect(isValidBundleId('com.my_app')).toBe(false);
    expect(isValidBundleId('com.1app')).toBe(false);
    expect(isValidBundleId('')).toBe(false);
  });
});

describe('deriveStoreName and deriveIconLabel (D-607)', () => {
  it('cuts at 30 and reports it', () => {
    const result = deriveStoreName('A'.repeat(31));
    expect(result.cut).toBe(true);
    expect(codePoints(result.name)).toBe(30);
    expect(result.length).toBe(31);
    expect(deriveStoreName('A'.repeat(30))).toEqual({
      name: 'A'.repeat(30),
      cut: false,
      length: 30,
    });
  });

  it('cuts on a word boundary, never mid-word', () => {
    const result = deriveStoreName('Comunidade Cliente Exemplo Longa Demais');
    expect(result.cut).toBe(true);
    expect(result.name).toBe('Comunidade Cliente Exemplo');
    expect(codePoints(result.name)).toBeLessThanOrEqual(30);
    // The 30th character ends a word exactly: nothing is lost mid-word.
    expect(deriveStoreName(`${'a'.repeat(29)} bcd`).name).toBe('a'.repeat(29));
  });

  it('counts code points: an emoji is one character and a pair is never split', () => {
    const emoji = '😀';
    expect(deriveStoreName(emoji.repeat(30)).cut).toBe(false);
    const cut = deriveStoreName(emoji.repeat(31));
    expect(cut.cut).toBe(true);
    expect(Array.from(cut.name)).toHaveLength(30);
    expect(deriveStoreName('é'.repeat(30)).cut).toBe(false);
    expect(deriveIconLabel(emoji.repeat(13), 'x').name).toBe(emoji.repeat(12));
  });

  it('an empty name reports cut false', () => {
    expect(deriveStoreName('')).toEqual({ name: '', cut: false, length: 0 });
  });

  it('the icon label is at most 12 code points, preferring the short name', () => {
    const label = deriveIconLabel('Comunidade Exemplo');
    expect(codePoints(label.name)).toBeLessThanOrEqual(12);
    expect(label.cut).toBe(true);
    expect(label.name).toBe('Comunidade');
    expect(deriveIconLabel('Curto', 'Um Nome Bem Mais Longo Que O Curto').name).toBe('Curto');
    expect(deriveIconLabel(null, 'Rede Demo')).toEqual({
      name: 'Rede Demo',
      cut: false,
      length: 9,
    });
    expect(deriveIconLabel('', 'Rede Demo').name).toBe('Rede Demo');
  });
});

describe('appState (UI-D-620)', () => {
  const none: AppStateInput = {
    held: { asc: false, play: false, apns: false },
    links: { ios: 'missing_team', android: 'missing_fingerprint' },
    privacyUrl: false,
    reviewer: false,
    manual: {
      appleAccount: false,
      playAccount: false,
      screenshots: false,
      submitted: false,
      published: false,
    },
  };
  const allAuto: AppStateInput = {
    ...none,
    held: { asc: true, play: true, apns: true },
    links: { ios: 'live', android: 'live' },
    privacyUrl: true,
    reviewer: true,
  };

  it('is none when nothing is held and nothing is done', () => {
    expect(appState(none)).toBe('none');
    expect(checklistCounts(none)).toEqual({ done: 0, total: 10 });
  });

  it('is preparing when anything is held or any manual row is done', () => {
    expect(appState({ ...none, held: { ...none.held, apns: true } })).toBe('preparing');
    expect(appState({ ...none, manual: { ...none.manual, screenshots: true } })).toBe('preparing');
    expect(appState({ ...none, privacyUrl: true })).toBe('preparing');
    expect(appState({ ...none, links: { ios: 'live', android: 'missing_fingerprint' } })).toBe(
      'preparing',
    );
  });

  it('a store key needs BOTH asc and play to count, but one alone is still preparing', () => {
    const onlyAsc = { ...allAuto, held: { asc: true, play: false, apns: true } };
    expect(appState(onlyAsc)).toBe('preparing');
  });

  it('is ready when the five automatic rows are done', () => {
    expect(appState(allAuto)).toBe('ready');
    expect(checklistCounts(allAuto)).toEqual({ done: 5, total: 10 });
  });

  it('published wins, even when the automatic rows are not done', () => {
    expect(appState({ ...none, manual: { ...none.manual, published: true } })).toBe('published');
    expect(appState({ ...allAuto, manual: { ...none.manual, published: true } })).toBe('published');
  });

  it('counts ten rows in the UI-D-627 order', () => {
    expect([...APP_CHECKLIST_AUTO_KEYS, ...APP_CHECKLIST_MANUAL_KEYS]).toHaveLength(10);
    expect(APP_CHECKLIST_AUTO_KEYS).toHaveLength(5);
    expect(
      checklistCounts({
        ...allAuto,
        manual: {
          appleAccount: true,
          playAccount: true,
          screenshots: true,
          submitted: true,
          published: true,
        },
      }),
    ).toEqual({ done: 10, total: 10 });
  });
});

describe('linkVerdict and the fingerprint (UI-D-624)', () => {
  const fingerprint = Array.from({ length: 32 }, (_, i) =>
    (i % 256).toString(16).padStart(2, '0').toUpperCase(),
  ).join(':');

  it('returns live, missing_team, missing_fingerprint and no_host', () => {
    const host = { hasVerifiedPrimaryHost: true, teamId: 'ABCDE12345', fingerprint };
    expect(linkVerdict('ios', host)).toBe('live');
    expect(linkVerdict('android', host)).toBe('live');
    expect(linkVerdict('ios', { ...host, teamId: null })).toBe('missing_team');
    expect(linkVerdict('android', { ...host, fingerprint: null })).toBe('missing_fingerprint');
    expect(linkVerdict('ios', { ...host, hasVerifiedPrimaryHost: false })).toBe('no_host');
    expect(linkVerdict('android', { ...host, hasVerifiedPrimaryHost: false })).toBe('no_host');
    // One platform's gap never changes the other's verdict.
    expect(linkVerdict('android', { ...host, teamId: null })).toBe('live');
  });

  it('normalises a fingerprint with or without colons, in any case', () => {
    const bare = fingerprint.replace(/:/g, '');
    expect(normalizeFingerprint(bare)).toBe(fingerprint);
    expect(normalizeFingerprint(fingerprint.toLowerCase())).toBe(fingerprint);
    expect(normalizeFingerprint(` ${fingerprint} `)).toBe(fingerprint);
    expect(normalizeFingerprint(bare.slice(2))).toBeNull();
    expect(normalizeFingerprint('zz'.repeat(32))).toBeNull();
    expect(normalizeFingerprint('')).toBeNull();
    expect(
      linkVerdict('android', {
        hasVerifiedPrimaryHost: true,
        teamId: null,
        fingerprint: bare.toLowerCase(),
      }),
    ).toBe('live');
    expect(
      linkVerdict('android', { hasVerifiedPrimaryHost: true, teamId: null, fingerprint: 'AB:CD' }),
    ).toBe('missing_fingerprint');
  });

  it('the team id is exactly 10 letters or digits', () => {
    expect(isValidTeamId('ABCDE12345')).toBe(true);
    expect(isValidTeamId('ABCDE1234')).toBe(false);
    expect(isValidTeamId('ABCDE123456')).toBe(false);
    expect(isValidTeamId('ABCDE-2345')).toBe(false);
  });
});

describe('compareVersions and isBelowMinVersion (UI-D-613)', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('is below only when strictly older, and a malformed side never blocks', () => {
    expect(isBelowMinVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isBelowMinVersion('1.0.1', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('1.0.2', '1.0.1')).toBe(false);
    expect(isBelowMinVersion('1.0.0', '0.0.0')).toBe(false);
    expect(isBelowMinVersion('1.0.0', 'abc')).toBe(false);
    expect(isBelowMinVersion('abc', '1.0.0')).toBe(false);
    expect(isBelowMinVersion('1.0', '1.0.1')).toBe(false);
  });

  it('parses the public version answer, with a nullable store link', () => {
    const answer = {
      ios: { minVersion: '1.2.0', storeUrl: 'https://apps.apple.com/app/id1' },
      android: { minVersion: '0.0.0', storeUrl: null },
    };
    expect(appVersionAnswerSchema.parse(answer)).toEqual(answer);
    expect(appVersionAnswerSchema.safeParse({ ...answer, extra: 1 }).success).toBe(false);
    expect(
      appVersionAnswerSchema.safeParse({ ...answer, ios: { minVersion: '1.2', storeUrl: null } })
        .success,
    ).toBe(false);
  });
});

describe('tenantBuildSchema', () => {
  const build = {
    slug: 'rede-demo',
    host: 'comunidade.cliente.com.br',
    hosts: ['comunidade.cliente.com.br'],
    env: 'prod',
    storeName: 'Comunidade Cliente',
    shortName: 'Comunidade',
    bundleId: 'br.com.cliente.comunidade',
    applicationId: 'br.com.cliente.comunidade',
    version: '1.0.0',
    buildNumber: 1,
    teamId: 'ABCDE12345',
    colors: {
      primary: '#112233',
      onPrimary: '#FFFFFF',
      primaryDark: '#223344',
      onPrimaryDark: '#ffffff',
    },
    logoUrl: 'https://cdn.example.com/logo.png',
    strings: { camera: 'Câmera', photos: 'Fotos', microphone: 'Microfone', faceId: 'Face ID' },
    storeUrls: { ios: null, android: 'https://play.google.com/store/apps/details?id=x' },
    googleServicesFile: null,
  };

  it('accepts a full record and lower-cases the colors', () => {
    const parsed = tenantBuildSchema.parse(build);
    expect(parsed.colors.onPrimary).toBe('#ffffff');
  });

  it('refuses a missing host, a bad bundle id, an extra key and a long store name', () => {
    const { host: _host, ...withoutHost } = build;
    expect(tenantBuildSchema.safeParse(withoutHost).success).toBe(false);
    expect(tenantBuildSchema.safeParse({ ...build, bundleId: 'Comunidade' }).success).toBe(false);
    expect(tenantBuildSchema.safeParse({ ...build, applicationId: 'com.my-app' }).success).toBe(
      false,
    );
    expect(tenantBuildSchema.safeParse({ ...build, extra: 1 }).success).toBe(false);
    expect(tenantBuildSchema.safeParse({ ...build, storeName: 'x'.repeat(31) }).success).toBe(
      false,
    );
    expect(tenantBuildSchema.safeParse({ ...build, shortName: 'x'.repeat(13) }).success).toBe(
      false,
    );
    expect(tenantBuildSchema.safeParse({ ...build, buildNumber: 0 }).success).toBe(false);
    expect(
      tenantBuildSchema.safeParse({ ...build, googleServicesFile: '/etc/passwd' }).success,
    ).toBe(false);
    expect(tenantBuildSchema.safeParse({ ...build, googleServicesFile: '../x.json' }).success).toBe(
      false,
    );
    expect(
      tenantBuildSchema.safeParse({ ...build, googleServicesFile: 'creds/google-services.json' })
        .success,
    ).toBe(true);
  });

  it('names the anonymised member', () => {
    expect(REMOVED_MEMBER_NAME).toBe('Membro removido');
  });
});

describe('write-only credential bodies (UI-D-623, UI-D-628)', () => {
  const issuerId = '69a6de70-03db-47e3-e053-5b8c7c11a4d1';

  it('lists the three kinds', () => {
    expect([...APP_CREDENTIAL_KINDS]).toEqual(['asc_key', 'play_service_account', 'apns_key']);
  });

  it('accept a well-formed body, trimmed', () => {
    expect(
      ascKeyBodySchema.parse({ issuerId, keyId: 'ABCDE12345', p8: ' -----BEGIN PRIVATE KEY----- ' })
        .p8,
    ).toBe('-----BEGIN PRIVATE KEY-----');
    expect(apnsKeyBodySchema.safeParse({ keyId: 'ABCDE12345', p8: 'x' }).success).toBe(true);
    expect(
      playServiceAccountBodySchema.safeParse({ json: '{"type":"service_account"}' }).success,
    ).toBe(true);
  });

  it('refuse an oversized p8, an oversized service account and malformed ids', () => {
    expect(
      ascKeyBodySchema.safeParse({ issuerId, keyId: 'ABCDE12345', p8: 'x'.repeat(8192) }).success,
    ).toBe(true);
    expect(
      ascKeyBodySchema.safeParse({ issuerId, keyId: 'ABCDE12345', p8: 'x'.repeat(8193) }).success,
    ).toBe(false);
    expect(apnsKeyBodySchema.safeParse({ keyId: 'ABCDE12345', p8: 'x'.repeat(8193) }).success).toBe(
      false,
    );
    expect(playServiceAccountBodySchema.safeParse({ json: 'x'.repeat(16384) }).success).toBe(true);
    expect(playServiceAccountBodySchema.safeParse({ json: 'x'.repeat(16385) }).success).toBe(false);
    expect(
      ascKeyBodySchema.safeParse({ issuerId: 'not-a-uuid', keyId: 'ABCDE12345', p8: 'x' }).success,
    ).toBe(false);
    expect(ascKeyBodySchema.safeParse({ issuerId, keyId: 'abc', p8: 'x' }).success).toBe(false);
    expect(ascKeyBodySchema.safeParse({ issuerId, keyId: 'ABCDE12345', p8: '' }).success).toBe(
      false,
    );
    expect(
      ascKeyBodySchema.safeParse({ issuerId, keyId: 'ABCDE12345', p8: 'x', extra: 1 }).success,
    ).toBe(false);
  });

  it('answers carry no field of a secret kind', () => {
    expect(Object.keys(credentialAnswerSchema.shape)).toEqual(['ok']);
    expect(Object.keys(appCredentialHeldSchema.shape)).toEqual(['held', 'heldAt']);
    expect(credentialAnswerSchema.safeParse({ ok: true }).success).toBe(true);
    expect(credentialAnswerSchema.safeParse({ ok: true, keyId: 'ABCDE12345' }).success).toBe(false);
    expect(credentialAnswerSchema.safeParse({ ok: false }).success).toBe(false);
    expect(
      appCredentialHeldSchema.safeParse({ held: true, heldAt: '2026-11-05T12:00:00Z' }).success,
    ).toBe(true);
    expect(appCredentialHeldSchema.safeParse({ held: false, heldAt: null }).success).toBe(true);
    expect(
      appCredentialHeldSchema.safeParse({ held: true, heldAt: null, keyId: 'x' }).success,
    ).toBe(false);
  });
});
