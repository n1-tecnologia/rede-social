import { createHash } from 'node:crypto';
import { env } from '../env';
import { openWith, sealWith } from '../secrets/sealed';

/**
 * Secret custody for a tenant's webhook token (09.1-05, PAY-04, D-486). AES-256-GCM with `node:crypto`
 * only, never a hand-rolled scheme. Since 09.2-03 (D-539) the primitives live ONCE in
 * `../secrets/sealed.ts` (the project registry's keyring uses the same wire format); this file keeps the
 * payments key (`PAYMENTS_SECRET_KEY`, its own variable: rotating it is out of scope), its development-key
 * rule and its public API, and calls the shared functions with a ONE-key ring.
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
 * rotation. Only outside production, when `fake` is the gateway in use (the list is unset, or names `fake`) and
 * no key is set, a FIXED development key is derived so the local stack and the tests need no
 * configuration; `assertProductionEnv` refuses a production boot without a real key (WR-01).
 */

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
 * while `fake` is enabled (the list unset or naming it) AND the process is not production (WR-01).
 */
export function resolvePaymentsKey(input: {
  key: string | undefined;
  keyId: number;
  providers: string | undefined;
  /** True when `NODE_ENV=production`: there is then no development key (WR-01). */
  production?: boolean;
}): PaymentsKeyMaterial {
  if (input.key) {
    const key = Buffer.from(input.key, 'base64');
    if (key.length !== KEY_BYTES) throw new Error('payments secret key invalid');
    return { key, keyId: input.keyId };
  }
  // WR-01: the public development key exists for local stacks and tests only, never for a hosted process.
  if (input.production) throw new Error('payments secret key invalid');
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
    production: env.NODE_ENV === 'production',
  });
  return cached;
}

/** The shared helper works over a keyring; a payments key is a ring of exactly one. */
const oneKeyRing = (material: PaymentsKeyMaterial) => new Map([[material.keyId, material.key]]);

export function sealSecretWith(
  material: PaymentsKeyMaterial,
  plain: string,
  integrationId: string,
): string {
  try {
    return sealWith(oneKeyRing(material), material.keyId, plain, integrationId);
  } catch {
    throw unreadable();
  }
}

export function openSecretWith(
  material: PaymentsKeyMaterial,
  sealed: string,
  integrationId: string,
): string {
  try {
    return openWith(oneKeyRing(material), sealed, integrationId);
  } catch {
    // The shared helper's own error is content-free too; this keeps the payments wording the callers and
    // their tests already match on.
    throw unreadable();
  }
}

/** Seals `plain` bound to `integrationId` with the process key. */
export const sealSecret = (plain: string, integrationId: string): string =>
  sealSecretWith(paymentsKey(), plain, integrationId);

/** Opens a value sealed for `integrationId`; throws `Error('payment secret unreadable')` on anything else. */
export const openSecret = (sealed: string, integrationId: string): string =>
  openSecretWith(paymentsKey(), sealed, integrationId);
