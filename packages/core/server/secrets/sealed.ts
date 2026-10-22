import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

/**
 * Credential custody for the project registry (09.2-03, D-539, DBT-02, DBT-03). AES-256-GCM with
 * `node:crypto` only, over a KEYRING so the master key can rotate without a flag day.
 *
 * A sealed value is ONE text column: `v1:<keyId>:<iv>:<tag>:<ciphertext>`, the three binary parts
 * base64url, a 12-byte random IV, and the caller's AAD (`<projectId>:<column>` for the registry) as
 * additional authenticated data. So:
 *  - a value copied to another row or to another column of the same row fails to open (T-09.2-13);
 *  - the key id travels with the value, so any id present in the keyring opens it and a re-seal can
 *    recognise what an older key sealed (`resealWith`);
 *  - the wire format is the payments helper's (`payments/secret.ts`), so a value sealed there still
 *    opens here under a ring that holds its key.
 *
 * The plaintext exists only in process memory while a pool is created or a column is re-sealed. It is
 * never stored, returned or logged: EVERY failure throws a plain `Error('sealed value unreadable')`
 * whose message holds no input, so neither the plaintext nor the sealed string can reach a log line
 * (T-09.2-11). Nothing in this file logs.
 *
 * The ring is `PLATFORM_MASTER_KEYS`, a JSON map of key id to base64 of exactly 32 bytes, and
 * `PLATFORM_MASTER_KEY_ID` names the id that SEALS. Outside production, with no ring configured, a FIXED
 * development key is the only entry (id 1), so the local stack and the tests need no configuration; in
 * production a missing ring is refused (the `payments/secret.ts` WR-01 rule).
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const MIN_KEY_ID = 1;
const MAX_KEY_ID = 32767;

/** Key id to key. Read-only: a ring never changes after it is resolved. */
export type Keyring = ReadonlyMap<number, Buffer>;

/** A ring plus the id that seals. */
export type ResolvedKeyring = { ring: Keyring; currentId: number };

const unreadable = () => new Error('sealed value unreadable');
const keyringInvalid = () => new Error('platform master keys invalid');

/** The fixed development key: the sha256 of a constant. Never a real credential. */
const developmentKey = () =>
  createHash('sha256').update('rede-social-local-platform-master-key').digest();

const isKeyId = (n: number) => Number.isInteger(n) && n >= MIN_KEY_ID && n <= MAX_KEY_ID;

/**
 * `{"1":"<base64 32 bytes>","2":"..."}` to a ring. Refuses anything else: a non-object, `{}`, an id
 * outside 1..32767 or not a plain integer, a key that is not exactly 32 bytes. The error names nothing.
 */
export function parseKeyring(json: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw keyringInvalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw keyringInvalid();
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) throw keyringInvalid();
  const ring = new Map<number, Buffer>();
  for (const [rawId, rawKey] of entries) {
    if (!/^[1-9]\d{0,4}$/.test(rawId)) throw keyringInvalid();
    const id = Number(rawId);
    if (!isKeyId(id)) throw keyringInvalid();
    if (typeof rawKey !== 'string') throw keyringInvalid();
    const key = Buffer.from(rawKey, 'base64');
    if (key.length !== KEY_BYTES) throw keyringInvalid();
    ring.set(id, key);
  }
  return ring;
}

/**
 * Pure ring resolution, so the rules are testable without the process environment. A ring that does
 * not hold `currentId` is refused at load (nothing could be sealed), production never gets the
 * development key, and a ring that is configured wins over it everywhere.
 */
export function resolveKeyring(input: {
  keys: string | undefined;
  currentId: number;
  production?: boolean;
}): ResolvedKeyring {
  if (!isKeyId(input.currentId)) throw keyringInvalid();
  let ring: Keyring;
  if (input.keys) {
    ring = parseKeyring(input.keys);
  } else {
    if (input.production) throw keyringInvalid();
    ring = new Map([[MIN_KEY_ID, developmentKey()]]);
  }
  if (!ring.has(input.currentId)) throw keyringInvalid();
  return { ring, currentId: input.currentId };
}

/** Seals `plain` under `currentId`. An empty plaintext is refused: an empty credential is a bug upstream. */
export function sealWith(ring: Keyring, currentId: number, plain: string, aad: string): string {
  const key = ring.get(currentId);
  if (!key || typeof plain !== 'string' || plain.length === 0) throw unreadable();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    String(currentId),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

type Parts = { keyId: number; iv: string; tag: string; ciphertext: string };

function parse(sealed: unknown): Parts {
  if (typeof sealed !== 'string') throw unreadable();
  const parts = sealed.split(':');
  if (parts.length !== 5) throw unreadable();
  const [version, rawId, iv, tag, ciphertext] = parts as [string, string, string, string, string];
  if (version !== VERSION || !/^[1-9]\d{0,4}$/.test(rawId)) throw unreadable();
  const keyId = Number(rawId);
  if (!isKeyId(keyId)) throw unreadable();
  return { keyId, iv, tag, ciphertext };
}

/** The key id a sealed value names, or the content-free error for anything that is not a sealed value. */
export function keyIdOf(sealed: string): number {
  return parse(sealed).keyId;
}

/** Opens a value sealed under ANY id the ring holds, for the same `aad`. */
export function openWith(ring: Keyring, sealed: string, aad: string): string {
  const { keyId, iv, tag, ciphertext } = parse(sealed);
  const key = ring.get(keyId);
  if (!key) throw unreadable();
  try {
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) throw unreadable();
    const decipher = createDecipheriv('aes-256-gcm', key, ivBytes);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
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

/**
 * Opens `sealed` under its own key id and seals the plaintext again under `currentId` (same `aad`), and
 * checks that the result opens back to the same plaintext before returning it, so a caller that writes
 * the value can never write something unreadable (T-09.2-17).
 */
export function resealWith(ring: Keyring, currentId: number, sealed: string, aad: string): string {
  const plain = openWith(ring, sealed, aad);
  const next = sealWith(ring, currentId, plain, aad);
  if (openWith(ring, next, aad) !== plain) throw unreadable();
  return next;
}

let cached: ResolvedKeyring | undefined;

/** The process's ring, resolved once from the kernel env. */
export function processKeyring(): ResolvedKeyring {
  cached ??= resolveKeyring({
    keys: env.PLATFORM_MASTER_KEYS,
    currentId: env.PLATFORM_MASTER_KEY_ID,
    production: env.NODE_ENV === 'production',
  });
  return cached;
}

/** Seals with the process ring under the current id. */
export const seal = (plain: string, aad: string): string => {
  const { ring, currentId } = processKeyring();
  return sealWith(ring, currentId, plain, aad);
};

/** Opens with the process ring; throws `Error('sealed value unreadable')` on anything else. */
export const open = (sealed: string, aad: string): string =>
  openWith(processKeyring().ring, sealed, aad);
