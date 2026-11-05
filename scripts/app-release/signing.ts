import { spawn } from 'node:child_process';
import { randomBytes as nodeRandomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { ReleaseRefusal } from './report';
import type { AppleClient } from './store-apple';

/**
 * The signing material the command generates itself (13-29, NATIVE-27, D-605): the Android upload keystore and the
 * iOS distribution key and certificate. They are generated on first use, sealed under the platform master key with
 * the AAD `<rowId>:<kind>` (kinds `android_keystore` and `ios_distribution`), and reused on every later run. They are
 * never entered, never shown and never leave the sealed table except into the CI temporary directory.
 */

export type GeneratedKind = 'android_keystore' | 'ios_distribution';

/** One sealed slot, valid while the store's lock for that tenant and kind is held. */
export type Slot = {
  read(): Promise<string | null>;
  write(plain: string): Promise<void>;
};

export type GeneratedStore = {
  /** Runs `fn` while holding the (tenant, kind) lock; two callers for one pair queue. */
  withLock<T>(tenantId: string, kind: GeneratedKind, fn: (slot: Slot) => Promise<T>): Promise<T>;
  /** Reads without the lock (the unsealing step). `null` when not held. */
  peek(tenantId: string, kind: GeneratedKind): Promise<string | null>;
};

// --- Sub-processes: argument arrays only, never a shell string. -----------------------------------------------

export type ToolResult = { code: number | null; missing: boolean; stdout?: string };
export type ToolRunner = (
  file: string,
  args: readonly string[],
  options?: { env?: Readonly<Record<string, string>>; capture?: boolean },
) => Promise<ToolResult>;

export const runTool: ToolRunner = (file, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(file, [...args], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', options.capture ? 'pipe' : 'ignore', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-8000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', () => resolve({ code: null, missing: true }));
    child.on('close', (code) => {
      // The macOS `keytool` stub exits non-zero with this sentence when no Java is installed.
      resolve({
        code,
        missing: /Unable to locate a Java Runtime/i.test(stderr),
        ...(options.capture ? { stdout } : {}),
      });
    });
  });

export type Random = (bytes: number) => Buffer;

const password = (random: Random): string => random(24).toString('base64url');

// --- Android -----------------------------------------------------------------------------------------------------

/** The keystore alias carries the tenant's own id, so two tenants' aliases never coincide (T-13-51). */
export const keystoreAlias = (tenantId: string, applicationId: string): string =>
  `${applicationId.replaceAll('.', '_')}-${tenantId.slice(0, 8)}`.slice(0, 60);

export async function ensureAndroidKeystore(input: {
  tenantId: string;
  applicationId: string;
  store: GeneratedStore;
  tools: ToolRunner;
  /** The temporary directory (workdir space for the generator). */
  dir: string;
  random?: Random;
  /** Called with the generated passwords BEFORE keytool runs, so the runner redacts them from then on. */
  mask?: (values: string[]) => void;
}): Promise<{ created: boolean }> {
  const { tenantId, store, tools, dir } = input;
  const random = input.random ?? nodeRandomBytes;
  return store.withLock(tenantId, 'android_keystore', async (slot) => {
    if ((await slot.read()) !== null) return { created: false };
    const alias = keystoreAlias(tenantId, input.applicationId);
    const storePassword = password(random);
    const keyPassword = password(random);
    input.mask?.([storePassword, keyPassword]);
    const workdir = await fs.mkdtemp(join(dir, 'keystore-'));
    try {
      const target = join(workdir, 'generated.keystore');
      const result = await tools(
        'keytool',
        [
          '-genkeypair',
          '-keystore',
          target,
          '-storetype',
          'PKCS12',
          '-alias',
          alias,
          '-keyalg',
          'RSA',
          '-keysize',
          '2048',
          '-validity',
          '10000',
          '-dname',
          `CN=${tenantId}`,
          '-storepass:env',
          'APP_RELEASE_STOREPASS',
          '-keypass:env',
          'APP_RELEASE_KEYPASS',
        ],
        { env: { APP_RELEASE_STOREPASS: storePassword, APP_RELEASE_KEYPASS: keyPassword } },
      );
      if (result.missing || result.code === null) throw new ReleaseRefusal('tool_missing');
      if (result.code !== 0) throw new ReleaseRefusal('signing_failed');
      const keystore = await fs.readFile(target);
      const sealed = JSON.stringify({
        alias,
        storePassword,
        keyPassword,
        keystoreB64: keystore.toString('base64'),
      });
      await slot.write(sealed);
      // Sealed and confirmed readable BEFORE any caller writes it anywhere: a value that does not read back is
      // refused here, while the generator's work folder is still the only place the key has ever been.
      if ((await slot.read()) !== sealed) throw new ReleaseRefusal('signing_failed');
      return { created: true };
    } finally {
      await fs.rm(workdir, { recursive: true, force: true });
    }
  });
}

// --- iOS ---------------------------------------------------------------------------------------------------------

export type Csr = { csrPem: string; keyPem: string };
export type MakeCsr = (input: { tenantId: string; dir: string; tools: ToolRunner }) => Promise<Csr>;
export type PackP12 = (input: {
  keyPem: string;
  certificateDerB64: string;
  password: string;
  dir: string;
  tools: ToolRunner;
}) => Promise<Buffer>;

/** A CSR and its RSA key made with `openssl` in workdir space; the key is returned in memory and workdir is deleted. */
export const makeCsrWithOpenssl: MakeCsr = async ({ tenantId, dir, tools }) => {
  const workdir = await fs.mkdtemp(join(dir, 'csr-'));
  try {
    const keyPath = join(workdir, 'key.pem');
    const csrPath = join(workdir, 'csr.pem');
    const result = await tools('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      `/CN=app-${tenantId}`,
    ]);
    if (result.missing || result.code === null) throw new ReleaseRefusal('tool_missing');
    if (result.code !== 0) throw new ReleaseRefusal('signing_failed');
    return {
      csrPem: await fs.readFile(csrPath, 'utf8'),
      keyPem: await fs.readFile(keyPath, 'utf8'),
    };
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
};

/** The PKCS#12 bundle of the key and the certificate Apple returned, made with `openssl` in workdir space. */
export const packP12WithOpenssl: PackP12 = async ({
  keyPem,
  certificateDerB64,
  password: pass,
  dir,
  tools,
}) => {
  const workdir = await fs.mkdtemp(join(dir, 'p12-'));
  try {
    const keyPath = join(workdir, 'key.pem');
    const derPath = join(workdir, 'cert.der');
    const pemPath = join(workdir, 'cert.pem');
    const outPath = join(workdir, 'bundle.p12');
    await fs.writeFile(join(workdir, 'key.pem'), keyPem, { mode: 0o600 });
    await fs.writeFile(join(workdir, 'cert.der'), Buffer.from(certificateDerB64, 'base64'));
    const convert = await tools('openssl', [
      'x509',
      '-inform',
      'DER',
      '-in',
      derPath,
      '-out',
      pemPath,
    ]);
    if (convert.missing || convert.code === null) throw new ReleaseRefusal('tool_missing');
    if (convert.code !== 0) throw new ReleaseRefusal('signing_failed');
    const pack = await tools(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        keyPath,
        '-in',
        pemPath,
        '-out',
        outPath,
        '-passout',
        'env:APP_RELEASE_P12PASS',
      ],
      { env: { APP_RELEASE_P12PASS: pass } },
    );
    if (pack.missing || pack.code === null) throw new ReleaseRefusal('tool_missing');
    if (pack.code !== 0) throw new ReleaseRefusal('signing_failed');
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
};

export type IosSigning = {
  bundleResourceId: string;
  certificateId: string;
  profile: { id: string; content: string; created: boolean };
  certificateCreated: boolean;
};

/**
 * Bundle id and capabilities first, then the certificate, then the profile: each step needs the one before, and
 * each is idempotent, so a failure leaves the earlier steps repeatable.
 */
export async function ensureIosSigning(input: {
  tenantId: string;
  bundleId: string;
  storeName: string;
  apple: AppleClient;
  store: GeneratedStore;
  tools: ToolRunner;
  dir: string;
  makeCsr?: MakeCsr;
  packP12?: PackP12;
  random?: Random;
  /** Called with the generated bundle password before it is used. */
  mask?: (values: string[]) => void;
}): Promise<IosSigning> {
  const { tenantId, apple, store, tools, dir } = input;
  const random = input.random ?? nodeRandomBytes;
  const bundle = await apple.registerBundleId(input.bundleId, input.storeName);
  await apple.ensureCapabilities(bundle.id);

  const certificate = await store.withLock(tenantId, 'ios_distribution', async (slot) => {
    const held = await slot.read();
    if (held !== null) {
      return {
        id: String((JSON.parse(held) as { certificateId: unknown }).certificateId),
        created: false,
      };
    }
    const csr = await (input.makeCsr ?? makeCsrWithOpenssl)({ tenantId, dir, tools });
    const created = await apple.createCertificate(csr.csrPem.replace(/\r?\n/g, '\n'));
    const p12Password = password(random);
    input.mask?.([p12Password]);
    const p12 = await (input.packP12 ?? packP12WithOpenssl)({
      keyPem: csr.keyPem,
      certificateDerB64: created.content,
      password: p12Password,
      dir,
      tools,
    });
    const sealed = JSON.stringify({
      certificateId: created.id,
      p12B64: p12.toString('base64'),
      p12Password,
    });
    await slot.write(sealed);
    // Sealed and confirmed readable before the profile (and any file) depends on it.
    if ((await slot.read()) !== sealed) throw new ReleaseRefusal('signing_failed');
    return { id: created.id, created: true };
  });

  const profile = await apple.ensureProfile({
    name: `app-${tenantId}`,
    bundleResourceId: bundle.id,
    certificateId: certificate.id,
  });
  return {
    bundleResourceId: bundle.id,
    certificateId: certificate.id,
    profile,
    certificateCreated: certificate.created,
  };
}

// --- The two stores ----------------------------------------------------------------------------------------------

type Sealing = {
  seal(plain: string, aad: string): string;
  open(sealed: string, aad: string): string;
};

/**
 * In memory, for the dry run and the unit tests: a dry run must never leave a certificate that exists only on a
 * fake server in the control plane. Seals through the same `Sealing` the real store uses.
 */
export function memoryGeneratedStore(
  sealing: Sealing,
  rows: Map<string, { id: string; sealed: string }> = new Map(),
): GeneratedStore {
  const tails = new Map<string, Promise<unknown>>();
  const key = (tenantId: string, kind: GeneratedKind) => `${tenantId}:${kind}`;
  const peek = async (tenantId: string, kind: GeneratedKind): Promise<string | null> => {
    const row = rows.get(key(tenantId, kind));
    return row ? sealing.open(row.sealed, `${row.id}:${kind}`) : null;
  };
  return {
    peek,
    async withLock(tenantId, kind, fn) {
      const k = key(tenantId, kind);
      const previous = tails.get(k) ?? Promise.resolve();
      const run = previous.then(() =>
        fn({
          read: () => peek(tenantId, kind),
          async write(plain) {
            const id = rows.get(k)?.id ?? randomUUID();
            rows.set(k, { id, sealed: sealing.seal(plain, `${id}:${kind}`) });
          },
        }),
      );
      tails.set(
        k,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

/**
 * The control plane's `platform.tenant_app_credentials`, through the platform lane. A replace keeps the row id, so
 * the sealed AAD `<rowId>:<kind>` stays valid. This is the script layer's `sealGeneratedCredential`: the same
 * `seal` as the kernel, a platform-lane upsert on `(tenant_id, kind)`, and the same advisory-lock key the
 * kernel's writer uses.
 */
export const pgGeneratedStore: GeneratedStore = {
  async peek(tenantId, kind) {
    const { withPlatformTx } = await import('@rede-social/core/db/platform-tx');
    const { open } = await import('@rede-social/core/server/secrets/sealed');
    const { sql } = await import('drizzle-orm');
    const rows = await withPlatformTx((tx) =>
      tx.execute<{ id: string; sealed: string }>(sql`
        select id::text as id, sealed from platform.tenant_app_credentials
         where tenant_id = ${tenantId}::uuid and kind = ${kind}`),
    );
    const row = Array.from(rows)[0];
    return row ? open(row.sealed, `${row.id}:${kind}`) : null;
  },
  async withLock(tenantId, kind, fn) {
    const { withPlatformTx } = await import('@rede-social/core/db/platform-tx');
    const { open, seal } = await import('@rede-social/core/server/secrets/sealed');
    const { sql } = await import('drizzle-orm');
    return withPlatformTx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`app-credential:${tenantId}:${kind}`}))`,
      );
      const existing = async () =>
        Array.from(
          await tx.execute<{ id: string; sealed: string }>(sql`
            select id::text as id, sealed from platform.tenant_app_credentials
             where tenant_id = ${tenantId}::uuid and kind = ${kind}`),
        )[0];
      return fn({
        async read() {
          const row = await existing();
          return row ? open(row.sealed, `${row.id}:${kind}`) : null;
        },
        async write(plain) {
          const id = (await existing())?.id ?? randomUUID();
          const sealed = seal(plain, `${id}:${kind}`);
          await tx.execute(sql`
            insert into platform.tenant_app_credentials (id, tenant_id, kind, sealed)
            values (${id}::uuid, ${tenantId}::uuid, ${kind}, ${sealed})
            on conflict (tenant_id, kind) do update set sealed = excluded.sealed, held_at = now()`);
        },
      });
    });
  },
};
