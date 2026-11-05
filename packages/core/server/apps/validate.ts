/**
 * RED stub (13-09): inert exports so the failing tests can load. Replaced in the GREEN commit.
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

export function validateP8(_pem: string): void {}

export function validatePlayServiceAccount(_json: string): void {}
