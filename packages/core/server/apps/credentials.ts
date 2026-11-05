import type { AppCredentialKind } from '@rede-social/contracts/native';
import type { Logger } from 'pino';

/**
 * RED stub (13-09): inert exports so the failing tests can load. Replaced in the GREEN commit.
 */
export type CredentialStore = {
  upsertSealed(
    tenantId: string,
    kind: AppCredentialKind,
    build: (rowId: string) => string,
  ): Promise<{ id: string; heldAt: Date }>;
  readSealed(
    tenantId: string,
    kind: AppCredentialKind,
  ): Promise<{ id: string; sealed: string } | null>;
  held(tenantId: string): Promise<{ kind: string; heldAt: Date }[]>;
};

export type ReplaceOptions = {
  userId: string;
  logger?: Logger;
  keyId?: string | undefined;
  issuerId?: string | undefined;
  fileKeyId?: string | null | undefined;
  store?: CredentialStore;
};

export async function replaceAppCredential(
  _tenantId: string,
  _kind: AppCredentialKind,
  _plain: string,
  _opts: ReplaceOptions,
): Promise<void> {}

export async function readAppCredential(
  _tenantId: string,
  _kind: AppCredentialKind,
  _deps: { store?: CredentialStore } = {},
): Promise<string | null> {
  return null;
}

export async function heldCredentials(
  _tenantId: string,
  _deps: { store?: CredentialStore } = {},
): Promise<{ kind: AppCredentialKind; held: boolean; heldAt: string | null }[]> {
  return [];
}
