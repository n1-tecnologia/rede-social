import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import type { AppCredentialKind } from '@rede-social/contracts/native';

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

/** Writes one secret file into `dir`. */
export async function writeSecretFile(
  dir: string,
  name: string,
  data: Buffer | string,
): Promise<void> {
  await fs.writeFile(join(dir, name), data);
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
  readCredential: ReadCredential;
}): Promise<UnsealResult> {
  const { dir } = input;
  const files: UnsealResult['files'] = {};
  const missing: CredentialKind[] = [];
  for (const kind of input.kinds) {
    const plain = await input.readCredential(input.tenantId, kind);
    if (plain === null) {
      missing.push(kind);
      continue;
    }
    const written: string[] = [];
    for (const file of filesOf(kind, plain)) {
      await writeSecretFile(dir, file.name, file.data);
      written.push(join(dir, file.name));
    }
    files[kind] = written;
  }
  return { files, missing };
}
