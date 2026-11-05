import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTempDirectory } from './cleanup';
import { createFakeStores, type FakeStores } from './fake-stores';
import { appleKeyPair, testSealing } from './fixtures';
import {
  ensureAndroidKeystore,
  ensureIosSigning,
  type GeneratedKind,
  type GeneratedStore,
  keystoreAlias,
  makeCsrWithOpenssl,
  memoryGeneratedStore,
  runTool,
  type ToolRunner,
} from './signing';
import { createAppleClient } from './store-apple';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const APP_ID = 'test.cliente.comunidade';

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const scratch = async () => {
  const dir = await createTempDirectory(tmpdir());
  made.push(dir);
  return dir;
};

type Call = { file: string; args: readonly string[]; env: Readonly<Record<string, string>> };
/** A `keytool` that writes bytes where the real one would, recording how it was called. */
const recordingKeytool =
  (calls: Call[], events?: string[]): ToolRunner =>
  async (file, args, options) => {
    calls.push({ file, args, env: options?.env ?? {} });
    events?.push('keytool');
    const target = args[args.indexOf('-keystore') + 1];
    if (target) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(target, Buffer.from(`keystore-${calls.length}-${Math.random()}`));
    }
    return { code: 0, missing: false };
  };
const missingTool: ToolRunner = async () => ({ code: null, missing: true });

/** Wraps a store so every slot read and write is recorded in order. */
const observed = (inner: GeneratedStore, events: string[]): GeneratedStore => ({
  peek: (tenantId, kind) => inner.peek(tenantId, kind),
  withLock: (tenantId, kind, fn) =>
    inner.withLock(tenantId, kind, (slot) =>
      fn({
        read: async () => {
          events.push('read');
          return slot.read();
        },
        write: async (plain) => {
          events.push('write');
          return slot.write(plain);
        },
      }),
    ),
});

describe('Android upload keystore (NATIVE-27)', () => {
  it('generates with keytool on first use (random passwords, derived alias), seals it, and reuses it afterwards', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    const calls: Call[] = [];
    const first = await ensureAndroidKeystore({
      tenantId: TENANT_A,
      applicationId: APP_ID,
      store,
      tools: recordingKeytool(calls),
      dir,
    });
    expect(first.created).toBe(true);
    expect(calls.length).toBe(1);

    const held = JSON.parse((await store.peek(TENANT_A, 'android_keystore')) ?? '{}');
    expect(held.alias).toBe(keystoreAlias(TENANT_A, APP_ID));
    expect(held.alias).toContain(TENANT_A.slice(0, 8));
    expect(held.storePassword).not.toBe(held.keyPassword);
    expect(Buffer.from(held.keystoreB64, 'base64').length).toBeGreaterThan(0);

    // Argument array only, and the passwords travel in the environment, never on the command line.
    const call = calls[0];
    expect(call?.file).toBe('keytool');
    expect(call?.args.join(' ')).not.toContain(held.storePassword);
    expect(call?.args.join(' ')).not.toContain(held.keyPassword);
    expect(Object.values(call?.env ?? {})).toEqual(
      expect.arrayContaining([held.storePassword, held.keyPassword]),
    );

    const second = await ensureAndroidKeystore({
      tenantId: TENANT_A,
      applicationId: APP_ID,
      store,
      tools: recordingKeytool(calls),
      dir,
    });
    expect(second.created).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('answers tool_missing and seals nothing when keytool is absent', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    await expect(
      ensureAndroidKeystore({
        tenantId: TENANT_A,
        applicationId: APP_ID,
        store,
        tools: missingTool,
        dir,
      }),
    ).rejects.toMatchObject({ reason: 'tool_missing' });
    expect(await store.peek(TENANT_A, 'android_keystore')).toBeNull();
  });

  it('seals first and reads the value back before it returns (the file is written only after)', async () => {
    const events: string[] = [];
    const store = observed(memoryGeneratedStore(testSealing()), events);
    const dir = await scratch();
    await ensureAndroidKeystore({
      tenantId: TENANT_A,
      applicationId: APP_ID,
      store,
      tools: recordingKeytool([], events),
      dir,
    });
    expect(events).toEqual(['read', 'keytool', 'write', 'read']);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses when what was sealed cannot be read back, and leaves no scratch files', async () => {
    const lossy: GeneratedStore = {
      peek: async () => null,
      withLock: (_tenant, _kind, fn) => fn({ read: async () => null, write: async () => {} }),
    };
    const dir = await scratch();
    await expect(
      ensureAndroidKeystore({
        tenantId: TENANT_A,
        applicationId: APP_ID,
        store: lossy,
        tools: recordingKeytool([]),
        dir,
      }),
    ).rejects.toMatchObject({ reason: 'signing_failed' });
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps two tenants apart: different aliases, and one tenant's sealed value never opens as the other's", async () => {
    expect(keystoreAlias(TENANT_A, APP_ID)).not.toBe(keystoreAlias(TENANT_B, APP_ID));
    const rows = new Map<string, { id: string; sealed: string }>();
    const store = memoryGeneratedStore(testSealing(), rows);
    const dir = await scratch();
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await ensureAndroidKeystore({
        tenantId,
        applicationId: APP_ID,
        store,
        tools: recordingKeytool([]),
        dir,
      });
    }
    const a = rows.get(`${TENANT_A}:android_keystore`);
    const b = rows.get(`${TENANT_B}:android_keystore`);
    expect(a && b && a.id !== b.id).toBe(true);
    // Copy A's sealed text into B's row (B's own id, as a copied column would have): it must not open.
    rows.set(`${TENANT_B}:android_keystore`, { id: b?.id ?? '', sealed: a?.sealed ?? '' });
    await expect(store.peek(TENANT_B, 'android_keystore')).rejects.toThrow(
      'sealed value unreadable',
    );
  });

  it('serialises callers for one tenant: one keystore, one keytool run', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    const calls: Call[] = [];
    const run = () =>
      ensureAndroidKeystore({
        tenantId: TENANT_A,
        applicationId: APP_ID,
        store,
        tools: recordingKeytool(calls),
        dir,
      });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => r.created).length).toBe(1);
    expect(calls.length).toBe(1);
  });
});

describe('iOS distribution key and certificate (NATIVE-27)', () => {
  const apple = appleKeyPair();
  let fakes: FakeStores;
  beforeAll(async () => {
    fakes = await createFakeStores();
  });
  afterAll(async () => {
    await fakes.close();
  });

  const clientOf = () =>
    createAppleClient({
      origin: fakes.apple.origin,
      keyId: 'KEYID12345',
      issuerId: 'issuer',
      privateKey: apple.p8,
    });
  const csr = async () => ({
    csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nQUJD\n-----END CERTIFICATE REQUEST-----\n',
    keyPem: '-----BEGIN PRIVATE KEY-----\nS0VZ\n-----END PRIVATE KEY-----\n',
  });
  const pack = async () => Buffer.from('p12-bytes');

  it('registers the bundle id and capabilities first, then the certificate, then the profile, and seals the key', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    const before = fakes.requests().length;
    const signing = await ensureIosSigning({
      tenantId: TENANT_A,
      bundleId: 'test.cliente.ordem',
      storeName: 'Ordem',
      apple: clientOf(),
      store,
      tools: missingTool,
      dir,
      makeCsr: csr,
      packP12: pack,
    });
    const writes = fakes
      .requests()
      .slice(before)
      .filter((r) => r.method === 'POST')
      .map((r) => r.path);
    expect(writes).toEqual([
      '/v1/bundleIds',
      '/v1/bundleIdCapabilities',
      '/v1/bundleIdCapabilities',
      '/v1/certificates',
      '/v1/profiles',
    ]);
    expect(signing).toMatchObject({ certificateCreated: true });
    const held = JSON.parse((await store.peek(TENANT_A, 'ios_distribution')) ?? '{}');
    expect(Buffer.from(held.p12B64, 'base64').toString()).toBe('p12-bytes');
    expect(held.certificateId).toBe(signing.certificateId);
  });

  it('leaves the certificate sealed when the profile step fails, and a rerun reuses it', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    const real = clientOf();
    let failures = 1;
    const flaky = {
      ...real,
      ensureProfile: async (input: Parameters<typeof real.ensureProfile>[0]) => {
        if (failures-- > 0) throw new Error('profile step failed');
        return real.ensureProfile(input);
      },
    };
    const before = fakes.counts().certificates;
    const input = {
      tenantId: TENANT_B,
      bundleId: 'test.cliente.retomada',
      storeName: 'Retomada',
      store,
      tools: missingTool,
      dir,
      makeCsr: csr,
      packP12: pack,
    };
    await expect(ensureIosSigning({ ...input, apple: flaky })).rejects.toThrow(
      'profile step failed',
    );
    expect(fakes.counts().certificates - before).toBe(1);
    expect(await store.peek(TENANT_B, 'ios_distribution')).not.toBeNull();
    const again = await ensureIosSigning({ ...input, apple: flaky });
    expect(again.certificateCreated).toBe(false);
    expect(fakes.counts().certificates - before).toBe(1);
  });

  it('creates nothing at the store when the bundle id step fails', async () => {
    const store = memoryGeneratedStore(testSealing());
    const dir = await scratch();
    const real = clientOf();
    const broken = {
      ...real,
      registerBundleId: async () => {
        throw new Error('register failed');
      },
    };
    const before = fakes.counts();
    await expect(
      ensureIosSigning({
        tenantId: TENANT_A,
        bundleId: 'test.cliente.falha',
        storeName: 'Falha',
        apple: broken,
        store,
        tools: missingTool,
        dir,
        makeCsr: csr,
        packP12: pack,
      }),
    ).rejects.toThrow('register failed');
    expect(fakes.counts().certificates).toBe(before.certificates);
    expect(await store.peek(TENANT_A, 'ios_distribution')).toBeNull();
  });

  it('builds a real CSR with openssl in a work folder that is gone afterwards', async () => {
    const dir = await scratch();
    const probe = await runTool('openssl', ['version']);
    if (probe.missing || probe.code !== 0) return;
    const made = await makeCsrWithOpenssl({ tenantId: TENANT_A, dir, tools: runTool });
    expect(made.csrPem).toContain('BEGIN CERTIFICATE REQUEST');
    expect(made.keyPem).toContain('PRIVATE KEY');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('the two kinds are separate rows of one tenant', () => {
  it('an Android and an iOS slot do not share a value', async () => {
    const store = memoryGeneratedStore(testSealing());
    const kinds: GeneratedKind[] = ['android_keystore', 'ios_distribution'];
    for (const kind of kinds) {
      await store.withLock(TENANT_A, kind, (slot) => slot.write(`{"k":"${kind}"}`));
    }
    expect(await store.peek(TENANT_A, 'android_keystore')).toBe('{"k":"android_keystore"}');
    expect(await store.peek(TENANT_A, 'ios_distribution')).toBe('{"k":"ios_distribution"}');
  });
});
