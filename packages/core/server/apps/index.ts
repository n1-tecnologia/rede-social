/**
 * The kernel's `apps` module (13-09, Phase 13): the control-plane facts of a tenant's native app and the
 * write-only custody of its store credentials. The platform routes import ONLY from this file.
 *
 * `readAppCredential` is exported for the release worker (plan 12) and the release script (plan 29). It is
 * the one function that unseals a store credential, and no route calls it.
 */
export {
  type CredentialStore,
  heldCredentials,
  type ReplaceOptions,
  readAppCredential,
  replaceAppCredential,
  summarizeHeld,
} from './credentials';
export {
  type AppDeps,
  type AppPatch,
  type AppRow,
  type AppStore,
  buildAppTab,
  emptyAppRow,
  readAppTab,
  requireTenant,
  type TenantFacts,
} from './tenant-app';
export {
  CredentialRefusal,
  type CredentialRefusalCode,
  validateP8,
  validatePlayServiceAccount,
} from './validate';
