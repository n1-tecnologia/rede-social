import { createPrivateKey } from 'node:crypto';

/**
 * Format checks for the store credentials an operator pastes into the App tab (13-09, D-605, T-13-18). They run
 * BEFORE anything is sealed or replaced, so a wrong file can never overwrite a working credential.
 *
 * A refusal is a `CredentialRefusal` whose `message` IS the closed code (the `TokenRefusal` style of
 * `projects/token.ts`): it names no value, no length, no prefix and no file name, so nothing a caller logs or
 * a route maps to a body can carry what the operator typed (T-13-16). Neither validator logs or echoes input.
 */
export type CredentialRefusalCode =
  | 'CREDENTIAL_NOT_P8'
  | 'CREDENTIAL_KEY_ID_MISMATCH'
  | 'CREDENTIAL_NOT_SERVICE_ACCOUNT'
  | 'VALIDATION_FAILED';

export class CredentialRefusal extends Error {
  readonly code: CredentialRefusalCode;
  constructor(code: CredentialRefusalCode) {
    super(code);
    this.name = 'CredentialRefusal';
    this.code = code;
  }
}

/** Largest `.p8` accepted (an Apple key is about 250 bytes; the cap only stops an upload of something else). */
export const P8_MAX_LENGTH = 8192;
/** Largest Google service-account JSON accepted (a real one is about 2.4 KB). */
export const SERVICE_ACCOUNT_MAX_LENGTH = 16384;

const PEM_BEGIN = '-----BEGIN PRIVATE KEY-----';
const PEM_END = '-----END PRIVATE KEY-----';

/**
 * An Apple `.p8`: a PKCS8 PEM holding an EC P-256 private key (App Store Connect and APNs both issue exactly
 * that). An RSA key, another curve, a certificate, garbage and the empty string are `CREDENTIAL_NOT_P8`.
 */
export function validateP8(pem: string): void {
  if (typeof pem !== 'string' || pem.length === 0 || pem.length > P8_MAX_LENGTH) {
    throw new CredentialRefusal('CREDENTIAL_NOT_P8');
  }
  if (!pem.includes(PEM_BEGIN) || !pem.includes(PEM_END)) {
    throw new CredentialRefusal('CREDENTIAL_NOT_P8');
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new CredentialRefusal('CREDENTIAL_NOT_P8');
    }
  } catch {
    throw new CredentialRefusal('CREDENTIAL_NOT_P8');
  }
}

/**
 * A Google Play service-account key file: JSON with `type = service_account`, a non-empty `client_email` and a
 * `private_key` that parses. A user-account JSON, a missing field and a non-JSON string are
 * `CREDENTIAL_NOT_SERVICE_ACCOUNT`.
 */
export function validatePlayServiceAccount(json: string): void {
  const refuse = () => new CredentialRefusal('CREDENTIAL_NOT_SERVICE_ACCOUNT');
  if (typeof json !== 'string' || json.length === 0 || json.length > SERVICE_ACCOUNT_MAX_LENGTH) {
    throw refuse();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw refuse();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw refuse();
  const record = parsed as Record<string, unknown>;
  if (record.type !== 'service_account') throw refuse();
  if (typeof record.client_email !== 'string' || record.client_email.trim() === '') throw refuse();
  if (typeof record.private_key !== 'string' || record.private_key.trim() === '') throw refuse();
  try {
    createPrivateKey(record.private_key);
  } catch {
    throw refuse();
  }
}
