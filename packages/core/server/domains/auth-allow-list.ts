import { type AuthAllowList, allowListEntry } from './types';

/**
 * Auth redirect allow-list writers (D-34, docs/DEPLOY.md WR-09). Task 1 of 02-09 ships the `local`
 * implementation; `createSupabaseAuthAllowList` (the Management API read-modify-write) is added by
 * Task 3 of the same plan and exported from this file under that exact name.
 */

/**
 * Everything the local writer was asked to allow, in this process — the test seam that proves the
 * verified transition ran the allow-list step (`localAllowListEntries.has(allowListEntry(host))`).
 */
export const localAllowListEntries = new Set<string>();

/**
 * `AUTH_ALLOW_LIST=local` — the env default. A NO-OP against the real world on purpose: the local
 * GoTrue already accepts every `http://*.localhost:3000/**` redirect through
 * `supabase/config.toml` (`[auth] additional_redirect_urls`), so there is nothing to write, and
 * writing to a hosted project from a laptop would be exactly the accident the fail-safe default
 * exists to prevent. It keeps an in-memory ledger instead so the verified/detached transitions
 * stay observable in tests. Idempotent both ways.
 */
export function createLocalAuthAllowList(): AuthAllowList {
  return {
    name: 'local',
    async add(host) {
      localAllowListEntries.add(allowListEntry(host));
    },
    async remove(host) {
      localAllowListEntries.delete(allowListEntry(host));
    },
  };
}

// `export function createSupabaseAuthAllowList(...)` — the Supabase Management API writer — is
// appended here by 02-09 Task 3; `domains/index.ts` selects it when `AUTH_ALLOW_LIST=supabase`.
