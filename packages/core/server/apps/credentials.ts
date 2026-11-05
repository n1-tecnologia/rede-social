import { randomUUID } from 'node:crypto';
import { APP_CREDENTIAL_KINDS, type AppCredentialKind } from '@rede-social/contracts/native';
import { and, eq, sql } from 'drizzle-orm';
import { tenantAppCredentials } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { type Logger, moduleLogger } from '../logging';
import { open, seal } from '../secrets/sealed';
import { CredentialRefusal, validateP8, validatePlayServiceAccount } from './validate';

/**
 * The write-only custody of the three store credentials (13-09, D-605, D-539, NATIVE-26, T-13-16, T-13-18):
 * the App Store Connect API key, the Google Play service account and the Apple push (APNs) key. It reuses the
 * 09.2 / 09.4 sealing exactly: each value is `seal(plain, "<rowId>:<kind>")` from `secrets/sealed.ts`, stored in
 * `platform.tenant_app_credentials`, whose only plain columns are the tenant, the kind and the date it was
 * saved. A credential is therefore "held" when its row exists, and nothing about the value (the Key ID, the
 * Issuer ID, a prefix, a length, a hash, the file name) is kept anywhere but INSIDE the sealed string.
 *
 * What a sealed string holds, after it is opened:
 *  - `asc_key` and `apns_key`: the JSON `{ "keyId", "issuerId"?, "p8" }` (the issuer is for App Store Connect only);
 *  - `play_service_account`: the service-account JSON exactly as it was pasted.
 *
 * `replaceAppCredential` validates the FORMAT before anything is replaced (a wrong file changes nothing) and
 * writes in ONE platform transaction. `readAppCredential` unseals and is exported for the release worker
 * (plan 12) and the release script (plan 29) ONLY; no route may call it, and the integration test spies that
 * none does.
 */

export type CredentialStore = {
  /**
   * In ONE transaction under a per-(tenant, kind) lock: finds the existing row id or makes one, calls `build`
   * with it (the sealed AAD is `<rowId>:<kind>`) and writes the result, keeping the id on a replace.
   */
  upsertSealed(
    tenantId: string,
    kind: AppCredentialKind,
    build: (rowId: string) => string,
  ): Promise<{ id: string; heldAt: Date }>;
  readSealed(
    tenantId: string,
    kind: AppCredentialKind,
  ): Promise<{ id: string; sealed: string } | null>;
  /** The kinds the tenant holds (any of the six) and when each was saved. Never a sealed value. */
  held(tenantId: string): Promise<{ kind: string; heldAt: Date }[]>;
};

export const pgCredentialStore: CredentialStore = {
  async upsertSealed(tenantId, kind, build) {
    return withPlatformTx(async (tx) => {
      // Two first-time saves of one pair would each invent a row id and the loser's sealed value would be bound
      // to an id that never lands: the lock makes the pair queue, so the loser reuses the winner's id.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`app-credential:${tenantId}:${kind}`}))`,
      );
      const [existing] = await tx
        .select({ id: tenantAppCredentials.id })
        .from(tenantAppCredentials)
        .where(
          and(eq(tenantAppCredentials.tenantId, tenantId), eq(tenantAppCredentials.kind, kind)),
        )
        .limit(1);
      const id = existing?.id ?? randomUUID();
      const sealed = build(id);
      const [row] = await tx
        .insert(tenantAppCredentials)
        .values({ id, tenantId, kind, sealed })
        .onConflictDoUpdate({
          target: [tenantAppCredentials.tenantId, tenantAppCredentials.kind],
          set: { sealed, heldAt: sql`now()` },
        })
        .returning({ id: tenantAppCredentials.id, heldAt: tenantAppCredentials.heldAt });
      if (!row) throw new Error('credential row missing');
      return row;
    });
  },
  async readSealed(tenantId, kind) {
    const [row] = await withPlatformTx((tx) =>
      tx
        .select({ id: tenantAppCredentials.id, sealed: tenantAppCredentials.sealed })
        .from(tenantAppCredentials)
        .where(
          and(eq(tenantAppCredentials.tenantId, tenantId), eq(tenantAppCredentials.kind, kind)),
        )
        .limit(1),
    );
    return row ?? null;
  },
  async held(tenantId) {
    return withPlatformTx((tx) =>
      tx
        .select({ kind: tenantAppCredentials.kind, heldAt: tenantAppCredentials.heldAt })
        .from(tenantAppCredentials)
        .where(eq(tenantAppCredentials.tenantId, tenantId)),
    );
  },
};

export type ReplaceOptions = {
  userId: string;
  logger?: Logger | undefined;
  /** The Key ID the operator typed (`asc_key` and `apns_key`). Sealed with the key, never stored plain. */
  keyId?: string | undefined;
  /** The App Store Connect Issuer ID (`asc_key` only). Sealed with the key. */
  issuerId?: string | undefined;
  /** The Key ID read from the `.p8` file name by the browser, when it could. Compared, then dropped. */
  fileKeyId?: string | null | undefined;
  store?: CredentialStore | undefined;
};

/**
 * Validates, then seals and saves one credential. Throws a `CredentialRefusal` (a closed code, no value) and
 * writes NOTHING when the file is the wrong kind, the typed Key ID differs from the file's, or a required
 * companion field (the Key ID, the Issuer ID) is missing. The log line names the tenant, the kind and the user.
 */
export async function replaceAppCredential(
  tenantId: string,
  kind: AppCredentialKind,
  plain: string,
  opts: ReplaceOptions,
): Promise<void> {
  const store = opts.store ?? pgCredentialStore;
  const payload = payloadOf(kind, plain, opts);

  await store.upsertSealed(tenantId, kind, (rowId) => seal(payload, `${rowId}:${kind}`));

  const log = opts.logger
    ? opts.logger.child({ name: 'platform.apps' })
    : moduleLogger('platform.apps');
  log.info(
    { event: 'platform.apps.credential', tenantId, kind, userId: opts.userId },
    'platform write',
  );
}

/** Format first, then the string that gets sealed. Throws before anything is written. */
function payloadOf(kind: AppCredentialKind, plain: string, opts: ReplaceOptions): string {
  if (kind === 'play_service_account') {
    validatePlayServiceAccount(plain);
    return plain;
  }
  validateP8(plain);
  const keyId = opts.keyId;
  if (typeof keyId !== 'string' || !/^[A-Z0-9]{10}$/.test(keyId)) {
    throw new CredentialRefusal('VALIDATION_FAILED');
  }
  if (typeof opts.fileKeyId === 'string' && opts.fileKeyId !== keyId) {
    throw new CredentialRefusal('CREDENTIAL_KEY_ID_MISMATCH');
  }
  if (kind === 'asc_key') {
    if (typeof opts.issuerId !== 'string' || opts.issuerId.length === 0) {
      throw new CredentialRefusal('VALIDATION_FAILED');
    }
    return JSON.stringify({ keyId, issuerId: opts.issuerId, p8: plain });
  }
  return JSON.stringify({ keyId, p8: plain });
}

/**
 * Unseals one credential and returns what was sealed (the JSON described above), or `null` when it is not held.
 * FOR THE RELEASE WORKER AND THE RELEASE SCRIPT ONLY. No platform route may call this: the panel only ever
 * learns that a credential is held (`heldCredentials`), never its value. A sealed value that cannot be opened
 * throws the content-free `sealed value unreadable`.
 */
export async function readAppCredential(
  tenantId: string,
  kind: AppCredentialKind,
  deps: { store?: CredentialStore | undefined } = {},
): Promise<string | null> {
  const row = await (deps.store ?? pgCredentialStore).readSealed(tenantId, kind);
  return row ? open(row.sealed, `${row.id}:${kind}`) : null;
}

/** The rows of `held()` as `{ kind, held, heldAt }` for the three kinds the operator enters, in the contract's order. */
export function summarizeHeld(
  rows: readonly { kind: string; heldAt: Date }[],
): { kind: AppCredentialKind; held: boolean; heldAt: string | null }[] {
  return APP_CREDENTIAL_KINDS.map((kind) => {
    const row = rows.find((candidate) => candidate.kind === kind);
    return { kind, held: row !== undefined, heldAt: row ? row.heldAt.toISOString() : null };
  });
}

/** `{ kind, held, heldAt }` for the three kinds the operator enters. Never a value. */
export async function heldCredentials(
  tenantId: string,
  deps: { store?: CredentialStore | undefined } = {},
): Promise<{ kind: AppCredentialKind; held: boolean; heldAt: string | null }[]> {
  return summarizeHeld(await (deps.store ?? pgCredentialStore).held(tenantId));
}
