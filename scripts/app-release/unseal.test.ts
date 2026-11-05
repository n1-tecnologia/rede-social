import { readdirSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirectory, createTempDirectory, TEMP_PREFIX, withTempDirectory } from './cleanup';
import { appleKeyPair, serviceAccount } from './fixtures';
import { maskValues } from './mask';
import {
  type CredentialKind,
  type ReadCredential,
  SECRET_FILES,
  unsealToDirectory,
  writeSecretFile,
} from './unseal';

const ascP8 = appleKeyPair().p8.trim();
const apnsP8 = appleKeyPair().p8.trim();
const account = serviceAccount();
const HELD: Partial<Record<CredentialKind, string>> = {
  asc_key: JSON.stringify({
    keyId: 'ABCDE12345',
    issuerId: 'issuer-5f3c9a77-0000-4000',
    p8: ascP8,
  }),
  apns_key: JSON.stringify({ keyId: 'ZYXWV98765', p8: apnsP8 }),
  play_service_account: account.json,
  android_keystore: JSON.stringify({
    alias: 'alias-aaaa',
    storePassword: 'store-password-1234',
    keyPassword: 'key-password-5678',
    keystoreB64: Buffer.from('keystore-bytes').toString('base64'),
  }),
};
const read: ReadCredential = async (_tenant, kind) => HELD[kind] ?? null;

const pemBody = (pem: string) =>
  pem
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('-----'))
    .join('');
const unescapeData = (data: string) =>
  data.replaceAll('%0A', '\n').replaceAll('%0D', '\r').replaceAll('%25', '%');

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const scratch = async () => {
  const dir = await createTempDirectory(tmpdir());
  made.push(dir);
  return dir;
};

describe('unsealToDirectory (T-13-50)', () => {
  it('writes each held credential as a mode 0600 file inside the directory only and returns paths, never values', async () => {
    const dir = await scratch();
    const result = await unsealToDirectory({
      tenantId: 't1',
      kinds: ['asc_key', 'apns_key', 'play_service_account', 'android_keystore'],
      dir,
      write: () => {},
      readCredential: read,
    });
    expect(result.missing).toEqual([]);
    const paths = Object.values(result.files).flat();
    expect(paths.length).toBe(7);
    for (const path of paths) {
      expect(dirname(path)).toBe(dir);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect((await readdir(dir)).sort()).toEqual(
      [
        SECRET_FILES.ascKeyP8,
        SECRET_FILES.ascKeyJson,
        SECRET_FILES.apnsKeyP8,
        SECRET_FILES.apnsKeyJson,
        SECRET_FILES.playServiceAccount,
        SECRET_FILES.androidKeystore,
        SECRET_FILES.androidSigning,
      ].sort(),
    );
    const text = JSON.stringify(result);
    for (const secret of ['ABCDE12345', 'issuer-5f3c9a77', 'store-password-1234', pemBody(ascP8)]) {
      expect(text).not.toContain(secret);
    }
    expect(await readFile(join(dir, SECRET_FILES.androidKeystore), 'utf8')).toBe('keystore-bytes');
  });

  it('emits the mask line for every secret BEFORE the first file is written (the order is observed, not assumed)', async () => {
    const dir = await scratch();
    const masks: string[] = [];
    const filesAtEachMask: number[] = [];
    await unsealToDirectory({
      tenantId: 't1',
      kinds: ['asc_key', 'play_service_account', 'android_keystore'],
      dir,
      write: (line) => {
        masks.push(line);
        filesAtEachMask.push(readdirSync(dir).length);
      },
      readCredential: read,
    });
    expect(masks.length).toBeGreaterThan(0);
    expect(filesAtEachMask.every((count) => count === 0)).toBe(true);
    expect(masks.every((line) => line.startsWith('::add-mask::'))).toBe(true);
    const values = new Set(masks.map((line) => unescapeData(line.slice('::add-mask::'.length))));
    for (const secret of [
      'ABCDE12345',
      'issuer-5f3c9a77-0000-4000',
      ascP8,
      pemBody(ascP8),
      'store-password-1234',
      'key-password-5678',
      Buffer.from('keystore-bytes').toString('base64'),
      JSON.parse(account.json).private_key_id,
    ]) {
      expect(values.has(secret)).toBe(true);
    }
  });

  it('masks a multi-line key line by line, so a log that splits it still hides it', async () => {
    const lines: string[] = [];
    maskValues([ascP8], (line) => lines.push(line));
    const values = lines.map((line) => unescapeData(line.slice('::add-mask::'.length)));
    for (const body of ascP8.split('\n').filter((l) => l.length >= 4 && !l.startsWith('-----'))) {
      expect(values).toContain(body);
    }
    // No emitted line carries a raw newline, which would end the workflow command early.
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('keeps a held value out of the result when another is missing, and lists what is missing', async () => {
    const dir = await scratch();
    const result = await unsealToDirectory({
      tenantId: 't1',
      kinds: ['asc_key', 'reviewer_password'],
      dir,
      write: () => {},
      readCredential: read,
    });
    expect(result.missing).toEqual(['reviewer_password']);
    expect(await readdir(dir)).toContain(SECRET_FILES.ascKeyP8);
  });

  it('refuses a destination outside the directory (path traversal) and writes nothing', async () => {
    const dir = await scratch();
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    made.push(outside);
    for (const name of ['../escape.txt', `../${outside}/x`, '/etc/escape', 'a/b', '', 'x\0y']) {
      await expect(writeSecretFile(dir, name, 'secret')).rejects.toThrow();
    }
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('tightens a file that already exists with looser permissions', async () => {
    const dir = await scratch();
    const path = join(dir, SECRET_FILES.reviewerPassword);
    await writeFile(path, 'old');
    await chmod(path, 0o644);
    await writeSecretFile(dir, SECRET_FILES.reviewerPassword, 'new');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe('new');
  });
});

describe('cleanupDirectory and withTempDirectory (T-13-50)', () => {
  it('removes the directory and every file in it even when the step threw, and a second call is a no-op', async () => {
    let seen = '';
    await expect(
      withTempDirectory(tmpdir(), async (dir) => {
        seen = dir;
        await writeSecretFile(dir, 'secret.txt', 'x');
        throw new Error('step failed');
      }),
    ).rejects.toThrow('step failed');
    await expect(stat(seen)).rejects.toThrow();
    await expect(cleanupDirectory(seen)).resolves.toBeUndefined();
  });

  it('refuses to remove anything that is not one of its own temporary directories', async () => {
    for (const path of [
      '/',
      tmpdir(),
      '/Users',
      'relative/app-release-x',
      join(tmpdir(), 'other-dir'),
    ]) {
      await expect(cleanupDirectory(path)).rejects.toThrow('cleanup_refused');
    }
    expect(TEMP_PREFIX).toBe('app-release-');
  });
});
