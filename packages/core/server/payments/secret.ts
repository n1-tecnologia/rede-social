import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

/**
 * Secret custody for a tenant's webhook token (09.1-05, PAY-04, D-486). AES-256-GCM with `node:crypto`
 * only, never a hand-rolled scheme.
 *
 * A sealed value is ONE text column: `v1:<keyId>:<iv>:<tag>:<ciphertext>`, the three binary parts
 * base64url, a 12-byte random IV, and the INTEGRATION ROW'S ID as additional authenticated data. So:
 *  - a sealed value copied to another row fails to open (the AAD binds it to its row);
 *  - the key id travels with the value, so a rotation can recognise what an old key sealed;
 *  - an algorithm change is a new prefix, not a migration;
 *  - replacing a token is one single-row update (a fresh IV each time), atomic for a reader.
 *
 * The plaintext exists only in API process memory while one delivery is verified. It is never stored,
 * returned or logged: every failure here throws a plain `Error('payment secret unreadable')` whose
 * message contains no input, so neither the token nor the sealed string can reach a log line.
 *
 * The key is `PAYMENTS_SECRET_KEY` (base64, exactly 32 bytes) with `PAYMENTS_SECRET_KEY_ID` for
 * rotation. Only when `fake` is the gateway in use (the list is unset, or names `fake`) and no key is
 * set, a FIXED development key is derived so the local stack and the tests need no configuration;
 * `assertProductionEnv` refuses a production list without a real key.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The key and the id it is known by. */
export type PaymentsKeyMaterial = { key: Buffer; keyId: number };

const unreadable = () => new Error('payment secret unreadable');

/** The fixed development key: the sha256 of a constant. Never a real credential. */
const developmentKey = () =>
  createHash('sha256').update('rede-social-local-payments-secret-key').digest();

/**
 * Pure key resolution, so the rules are testable without touching the process environment.
 * A configured key must decode to exactly 32 bytes; without one, the development key is allowed only
 * while `fake` is enabled (the list unset or naming it).
 */
export function resolvePaymentsKey(input: {
  key: string | undefined;
  keyId: number;
  providers: string | undefined;
}): PaymentsKeyMaterial {
  if (input.key) {
    const key = Buffer.from(input.key, 'base64');
    if (key.length !== KEY_BYTES) throw new Error('payments secret key invalid');
    return { key, keyId: input.keyId };
  }
  const listed = (input.providers ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (input.providers === undefined || listed.includes('fake')) {
    return { key: developmentKey(), keyId: input.keyId };
  }
  throw new Error('payments secret key invalid');
}

let cached: PaymentsKeyMaterial | undefined;

/** The process's key, resolved once from the kernel env. */
export function paymentsKey(): PaymentsKeyMaterial {
  cached ??= resolvePaymentsKey({
    key: env.PAYMENTS_SECRET_KEY,
    keyId: env.PAYMENTS_SECRET_KEY_ID,
    providers: env.PAYMENTS_PROVIDERS,
  });
  return cached;
}

export function sealSecretWith(
  material: PaymentsKeyMaterial,
  plain: string,
  integrationId: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', material.key, iv);
  cipher.setAAD(Buffer.from(integrationId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    String(material.keyId),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function openSecretWith(
  material: PaymentsKeyMaterial,
  sealed: string,
  integrationId: string,
): string {
  const parts = sealed.split(':');
  if (parts.length !== 5) throw unreadable();
  const [version, keyId, iv, tag, ciphertext] = parts as [string, string, string, string, string];
  if (version !== VERSION || keyId !== String(material.keyId)) throw unreadable();
  try {
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== 16) throw unreadable();
    const decipher = createDecipheriv('aes-256-gcm', material.key, ivBytes);
    decipher.setAAD(Buffer.from(integrationId, 'utf8'));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Never rethrow the node error: its message can name the failing step, and callers log it.
    throw unreadable();
  }
}

/** Seals `plain` bound to `integrationId` with the process key. */
export const sealSecret = (plain: string, integrationId: string): string =>
  sealSecretWith(paymentsKey(), plain, integrationId);

/** Opens a value sealed for `integrationId`; throws `Error('payment secret unreadable')` on anything else. */
export const openSecret = (sealed: string, integrationId: string): string =>
  openSecretWith(paymentsKey(), sealed, integrationId);
