import * as fs from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { AppCredentialKind } from '@rede-social/contracts/native';
import { maskValues, secretValuesOf } from './mask';

/**
 * Sealed credentials reach the CI runner only as FILES in a temporary directory (13-29, D-605, D-539, T-13-50).
 * `readCredential` is the kernel's `readAppCredential` for the three kinds the operator enters and the script's own
 * reader for the generated kinds; nothing else unseals.
 */

export type CredentialKind =
  | AppCredentialKind
  | 'android_keystore'
  | 'ios_distribution'
  | 'reviewer_password';

export type ReadCredential = (tenantId: string, kind: CredentialKind) => Promise<string | null>;

/** The file a secret is written to; the names are fixed, so no input can choose a path. */
export const SECRET_FILES = {
  ascKeyP8: 'asc_key.p8',
  ascKeyJson: 'asc_key.json',
  apnsKeyP8: 'apns_key.p8',
  apnsKeyJson: 'apns_key.json',
  playServiceAccount: 'play_sa.json',
  androidKeystore: 'android.keystore',
  androidSigning: 'android-signing.properties',
  iosP12: 'ios_distribution.p12',
  iosP12Password: 'ios_distribution.password',
  reviewerPassword: 'reviewer_password',
  iosProfile: 'profile.mobileprovision',
} as const;

export type SecretFile = { name: string; data: Buffer | string };

const parse = (plain: string): Record<string, unknown> => {
  const value = JSON.parse(plain) as unknown;
  if (typeof value !== 'object' || value === null) throw new Error('sealed payload shape');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('sealed payload shape');
  return value;
};

/** The files one credential becomes. `plain` is what `readCredential` returned. */
export function filesOf(kind: CredentialKind, plain: string): SecretFile[] {
  switch (kind) {
    case 'asc_key': {
      const body = parse(plain);
      return [
        { name: SECRET_FILES.ascKeyP8, data: text(body.p8) },
        {
          name: SECRET_FILES.ascKeyJson,
          data: JSON.stringify({
            key_id: text(body.keyId),
            issuer_id: text(body.issuerId),
            key: text(body.p8),
            in_house: false,
          }),
        },
      ];
    }
    case 'apns_key': {
      const body = parse(plain);
      return [
        { name: SECRET_FILES.apnsKeyP8, data: text(body.p8) },
        {
          name: SECRET_FILES.apnsKeyJson,
          data: JSON.stringify({ key_id: text(body.keyId), key: text(body.p8) }),
        },
      ];
    }
    case 'play_service_account':
      return [{ name: SECRET_FILES.playServiceAccount, data: plain }];
    case 'android_keystore': {
      const body = parse(plain);
      return [
        { name: SECRET_FILES.androidKeystore, data: Buffer.from(text(body.keystoreB64), 'base64') },
        {
          name: SECRET_FILES.androidSigning,
          data: [
            `storeFile=${SECRET_FILES.androidKeystore}`,
            `storePassword=${text(body.storePassword)}`,
            `keyAlias=${text(body.alias)}`,
            `keyPassword=${text(body.keyPassword)}`,
            '',
          ].join('\n'),
        },
      ];
    }
    case 'ios_distribution': {
      const body = parse(plain);
      return [
        { name: SECRET_FILES.iosP12, data: Buffer.from(text(body.p12B64), 'base64') },
        { name: SECRET_FILES.iosP12Password, data: text(body.p12Password) },
      ];
    }
    case 'reviewer_password':
      return [{ name: SECRET_FILES.reviewerPassword, data: plain }];
  }
}

/** A file name is one plain segment: no separator, no `..`, no NUL, nothing absolute. Throws before any write. */
export function assertInsideDirectory(dir: string, name: string): void {
  const refused = () => new Error('path_outside_directory');
  if (name === '' || name === '.' || name === '..' || name.includes('\0')) throw refused();
  if (name.includes('/') || name.includes('\\') || isAbsolute(name)) throw refused();
  const inside = relative(dir, join(dir, name));
  if (inside !== name) throw refused();
}

/**
 * Writes one secret file into `dir` with mode 0600 (the mode is set again after the write, so a file that already
 * existed with looser permissions is tightened). A symbolic link in the way is refused.
 */
export async function writeSecretFile(
  dir: string,
  name: string,
  data: Buffer | string,
): Promise<void> {
  assertInsideDirectory(dir, name);
  const existing = await fs.lstat(join(dir, name)).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error('path_outside_directory');
  await fs.writeFile(join(dir, name), data, { mode: 0o600 });
  await fs.chmod(join(dir, name), 0o600);
}

export async function readSecretFile(dir: string, name: string): Promise<string> {
  return fs.readFile(join(dir, name), 'utf8');
}

export type UnsealResult = {
  /** The files written, by kind. Paths only. */
  files: Partial<Record<CredentialKind, string[]>>;
  /** The kinds that are not held. */
  missing: CredentialKind[];
};

export async function unsealToDirectory(input: {
  tenantId: string;
  kinds: readonly CredentialKind[];
  dir: string;
  /** Receives every `::add-mask::` line. Called for ALL secrets before the first file is written. */
  write: (line: string) => void;
  readCredential: ReadCredential;
}): Promise<UnsealResult> {
  const { dir } = input;
  const held: { kind: CredentialKind; plain: string }[] = [];
  const missing: CredentialKind[] = [];
  for (const kind of input.kinds) {
    const plain = await input.readCredential(input.tenantId, kind);
    if (plain === null) missing.push(kind);
    else held.push({ kind, plain });
  }

  // Masks first, writes second: from the first byte on disk, the runner already redacts every one of these.
  maskValues(
    held.flatMap((entry) => secretValuesOf(entry.plain)),
    input.write,
  );

  const files: UnsealResult['files'] = {};
  for (const { kind, plain } of held) {
    const written: string[] = [];
    for (const file of filesOf(kind, plain)) {
      await writeSecretFile(dir, file.name, file.data);
      written.push(join(dir, file.name));
    }
    files[kind] = written;
  }
  return { files, missing };
}
