import { generateKeyPairSync } from 'node:crypto';
import { appTabSchema } from '@rede-social/contracts/native';
import { describe, expect, it, vi } from 'vitest';
import { readAppCredential, replaceAppCredential } from '../server/apps/credentials';
import { readAppTab } from '../server/apps/tenant-app';
import { CredentialRefusal, validateP8, validatePlayServiceAccount } from '../server/apps/validate';
import { open } from '../server/secrets/sealed';
import { memoryAppStore, memoryCredentialStore } from './fixtures/apps-memory';

/**
 * 13-09 Task 1 (D-605, D-539, NATIVE-26, T-13-16, T-13-18): the write-only custody of the three store
 * credentials at unit level. Format first, then seal, and nothing about the value ever leaves the module.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = { userId: '22222222-2222-4222-8222-222222222222' };
const KEY_ID = 'ABCDE12345';
const ISSUER = 'a1b2c3d4-0000-4000-8000-123456789abc';

const pkcs8 = (privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) =>
  privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const ecPem = () => pkcs8(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey);
const rsaPem = () => pkcs8(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
const p384Pem = () => pkcs8(generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey);

const CERTIFICATE_PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ2Vy\n-----END CERTIFICATE-----\n';

const serviceAccount = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'sentinel-project',
    client_email: 'robot@sentinel-project.iam.gserviceaccount.com',
    private_key: rsaPem(),
    ...over,
  });

const code = async (run: () => unknown): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CredentialRefusal) return error.code;
    return `other:${String(error)}`;
  }
  return 'no refusal';
};

describe('validateP8 (T-13-18)', () => {
  it('accepts an EC P-256 PKCS8 key', () => {
    expect(() => validateP8(ecPem())).not.toThrow();
  });

  it('refuses an RSA key, a P-384 key, a certificate, garbage and an empty string with CREDENTIAL_NOT_P8', async () => {
    for (const bad of [rsaPem(), p384Pem(), CERTIFICATE_PEM, 'not a key at all', '', '   ']) {
      expect(await code(() => validateP8(bad))).toBe('CREDENTIAL_NOT_P8');
    }
  });

  it('refuses a key larger than 8192 characters and a PEM whose markers wrap garbage', async () => {
    expect(await code(() => validateP8(`${ecPem()}${'A'.repeat(8200)}`))).toBe('CREDENTIAL_NOT_P8');
    const wrapped = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';
    expect(await code(() => validateP8(wrapped))).toBe('CREDENTIAL_NOT_P8');
  });

  it('a refusal carries the code and nothing of the input', () => {
    const sentinel = 'SENTINEL-NOT-A-KEY-9f3c';
    try {
      validateP8(sentinel);
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
      expect((error as Error).message).toBe('CREDENTIAL_NOT_P8');
      return;
    }
    throw new Error('expected a refusal');
  });
});

describe('validatePlayServiceAccount (T-13-18)', () => {
  it('accepts a well-formed service account record', () => {
    expect(() => validatePlayServiceAccount(serviceAccount())).not.toThrow();
  });

  it('refuses a user-account JSON, a missing client_email, an unparseable private key, a non-JSON string and a JSON array', async () => {
    const bad = [
      serviceAccount({ type: 'authorized_user' }),
      serviceAccount({ client_email: undefined }),
      serviceAccount({ client_email: '' }),
      serviceAccount({ private_key: 'not a pem' }),
      serviceAccount({ private_key: undefined }),
      'this is not json',
      '[]',
      'null',
      '',
    ];
    for (const json of bad) {
      expect(await code(() => validatePlayServiceAccount(json))).toBe(
        'CREDENTIAL_NOT_SERVICE_ACCOUNT',
      );
    }
  });

  it('refuses a document larger than 16384 characters', async () => {
    const big = serviceAccount({ padding: 'x'.repeat(17000) });
    expect(await code(() => validatePlayServiceAccount(big))).toBe(
      'CREDENTIAL_NOT_SERVICE_ACCOUNT',
    );
  });
});

describe('replaceAppCredential (D-605: validate first, then seal under <rowId>:<kind>)', () => {
  it('a bad file leaves the previously held value readable and unchanged, and writes nothing', async () => {
    const { store, calls } = memoryCredentialStore();
    const first = ecPem();
    await replaceAppCredential(TENANT, 'apns_key', first, { ...ACTOR, keyId: KEY_ID, store });
    const before = await readAppCredential(TENANT, 'apns_key', { store });
    expect(before).not.toBeNull();
    const upserts = calls.upsert;

    expect(
      await code(() =>
        replaceAppCredential(TENANT, 'apns_key', rsaPem(), { ...ACTOR, keyId: KEY_ID, store }),
      ),
    ).toBe('CREDENTIAL_NOT_P8');

    expect(calls.upsert).toBe(upserts);
    expect(await readAppCredential(TENANT, 'apns_key', { store })).toBe(before);
    expect(JSON.parse(before as string).p8).toBe(first);
  });

  it('a good file is sealed with the AAD <rowId>:<kind> and opens only for that pair', async () => {
    const { store, rows } = memoryCredentialStore();
    const pem = ecPem();
    await replaceAppCredential(TENANT, 'asc_key', pem, {
      ...ACTOR,
      keyId: KEY_ID,
      issuerId: ISSUER,
      store,
    });

    const row = rows.get(`${TENANT}:asc_key`);
    expect(row).toBeDefined();
    const { id, sealed } = row as { id: string; sealed: string };
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(KEY_ID);
    expect(sealed).not.toContain(ISSUER);

    const payload = JSON.parse(open(sealed, `${id}:asc_key`));
    expect(payload).toEqual({ keyId: KEY_ID, issuerId: ISSUER, p8: pem });
    // Copied to another kind, or to another row, it does not open.
    expect(() => open(sealed, `${id}:apns_key`)).toThrow();
    expect(() => open(sealed, `${TENANT}:asc_key`)).toThrow();
  });

  it('the Play service account is sealed as the JSON it was', async () => {
    const { store } = memoryCredentialStore();
    const json = serviceAccount();
    await replaceAppCredential(TENANT, 'play_service_account', json, { ...ACTOR, store });
    expect(await readAppCredential(TENANT, 'play_service_account', { store })).toBe(json);
  });

  it('readAppCredential answers null for a kind that was never saved', async () => {
    const { store } = memoryCredentialStore();
    expect(await readAppCredential(TENANT, 'apns_key', { store })).toBeNull();
  });

  it('a typed Key ID that differs from the one in the file name is CREDENTIAL_KEY_ID_MISMATCH; equal, null and absent pass', async () => {
    const { store, calls } = memoryCredentialStore();
    const base = { ...ACTOR, keyId: KEY_ID, store };
    expect(
      await code(() =>
        replaceAppCredential(TENANT, 'apns_key', ecPem(), { ...base, fileKeyId: 'ZZZZZ99999' }),
      ),
    ).toBe('CREDENTIAL_KEY_ID_MISMATCH');
    expect(calls.upsert).toBe(0);
    for (const fileKeyId of [KEY_ID, null, undefined]) {
      await replaceAppCredential(TENANT, 'apns_key', ecPem(), { ...base, fileKeyId });
    }
    expect(calls.upsert).toBe(3);
  });

  it('an ASC key without an issuer, or a .p8 without a Key ID, is VALIDATION_FAILED and writes nothing', async () => {
    const { store, calls } = memoryCredentialStore();
    expect(
      await code(() =>
        replaceAppCredential(TENANT, 'asc_key', ecPem(), { ...ACTOR, keyId: KEY_ID, store }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await code(() => replaceAppCredential(TENANT, 'apns_key', ecPem(), { ...ACTOR, store })),
    ).toBe('VALIDATION_FAILED');
    expect(calls.upsert).toBe(0);
  });

  it('logs the event, the tenant, the kind and the user, and no value, in a success and in a refusal', async () => {
    const { store } = memoryCredentialStore();
    const info = vi.fn();
    const logger = { child: () => ({ info }) } as never;
    const pem = ecPem();
    await replaceAppCredential(TENANT, 'apns_key', pem, { ...ACTOR, keyId: KEY_ID, logger, store });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toEqual({
      event: 'platform.apps.credential',
      tenantId: TENANT,
      kind: 'apns_key',
      userId: ACTOR.userId,
    });
    const text = JSON.stringify(info.mock.calls);
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain(pem.slice(40, 80));

    await code(() =>
      replaceAppCredential(TENANT, 'apns_key', rsaPem(), {
        ...ACTOR,
        keyId: KEY_ID,
        logger,
        store,
      }),
    );
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('readAppTab: held and nothing else (NATIVE-26, UI-D-628)', () => {
  const FORBIDDEN = ['p8', 'keyId', 'issuerId', 'sealed', 'json', 'fileKeyId', 'client_email'];

  const keysOf = (value: unknown, found: string[] = []): string[] => {
    if (Array.isArray(value)) {
      for (const item of value) keysOf(item, found);
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        found.push(key);
        keysOf(inner, found);
      }
    }
    return found;
  };

  it('reports held true with a date for apns_key and held false for the others, with no secret-kind key anywhere', async () => {
    const credentials = memoryCredentialStore();
    const sentinel = 'QX7QX7QX70';
    await replaceAppCredential(TENANT, 'apns_key', ecPem(), {
      ...ACTOR,
      keyId: sentinel,
      store: credentials.store,
    });
    const app = memoryAppStore({ [TENANT]: { displayName: 'Rede Demo', primaryHost: null } });

    const tab = await readAppTab(TENANT, { app: app.store, credentials: credentials.store });

    expect(tab.credentials.map((c) => c.kind)).toEqual([
      'asc_key',
      'play_service_account',
      'apns_key',
    ]);
    expect(tab.credentials.map((c) => c.held)).toEqual([false, false, true]);
    expect(tab.credentials[2]?.heldAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tab.credentials[0]?.heldAt).toBeNull();
    for (const key of keysOf(tab)) expect(FORBIDDEN).not.toContain(key);
    expect(JSON.stringify(tab)).not.toContain(sentinel);
    // The answer is exactly the strict contract the screens parse.
    expect(appTabSchema.safeParse(tab).success).toBe(true);
  });

  it('a tenant the control plane does not know is a 404 NOT_FOUND', async () => {
    const app = memoryAppStore({});
    await expect(
      readAppTab(TENANT, { app: app.store, credentials: memoryCredentialStore().store }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
