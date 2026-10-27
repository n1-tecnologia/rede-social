import type { BootstrapReasonCode } from '@rede-social/contracts/projects';

/**
 * The catalog key (`platform.database.reasons.<key>`) of a bootstrap reason CODE (09.2-18, UI-D-548):
 * the API sends a closed code, never provider text, and the screen shows the catalog's sentence for
 * it. The codes are the engine's snake_case words; the catalog's keys are the Copywriting Contract's
 * camelCase ones. Shared by the confirmation dialog and the Banco tab (plan 19).
 */
const REASON_KEYS = {
  unreachable: 'unreachable',
  access_denied: 'accessDenied',
  not_empty: 'notEmpty',
  migration_failed: 'migration',
  auth_config_failed: 'auth',
  storage_failed: 'storage',
  realtime_failed: 'realtime',
  tenant_failed: 'tenant',
  invite_failed: 'invite',
  unknown: 'unknown',
  // 09.4-03: catalog KEYS only; the sentences arrive with the catalogs in plan 14.
  token_invalid: 'tokenInvalid',
  token_forbidden: 'tokenForbidden',
  org_mismatch: 'orgMismatch',
} as const satisfies Record<BootstrapReasonCode, string>;

export type ReasonCatalogKey = (typeof REASON_KEYS)[BootstrapReasonCode];

/** The reason's catalog key; a code this build does not know reads as `unknown`. */
export function reasonCatalogKey(code: BootstrapReasonCode | null | undefined): ReasonCatalogKey {
  return (code && REASON_KEYS[code]) || 'unknown';
}
