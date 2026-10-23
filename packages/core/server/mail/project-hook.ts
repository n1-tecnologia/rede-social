import { createBoundedTtlCache } from '@rede-social/contracts';
import { eq } from 'drizzle-orm';
import { projects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { open } from '../secrets/sealed';
import { type ProjectRecord, projectColumns } from '../tenancy/project-registry';
import { parseHookSecrets } from './hook-schema';

/**
 * 09.2-11 (DBT-14, D-542, D-37): which project a Send Email Hook call belongs to. Every project has its
 * own GoTrue and so its own hook URL, `.../v1/hooks/auth/send-email/<hookRef>`, and its own signing
 * secret. The reference only SELECTS the project (22 characters of base64url, 16 random bytes made at
 * bootstrap); the HMAC secret is what authenticates, so a guessed or leaked reference alone sends nothing.
 *
 * The lookup is an EXACT match on `platform.projects.hook_ref`: a prefix, a near miss or a differently
 * cased reference never resolves (P26), and a value that cannot be a reference is answered `null` without
 * a query (P27). The registry row is cached 5 minutes (30 s for "no such project") in a bounded map; the
 * plaintext secret is opened per request from the sealed column and never cached or logged.
 */

/** 16 random bytes in base64url, no padding. */
export const HOOK_REF_SHAPE = /^[A-Za-z0-9_-]{22}$/;
export const HOOK_PROJECT_TTL_MS = 5 * 60_000;
export const HOOK_PROJECT_NEGATIVE_TTL_MS = 30_000;
export const HOOK_PROJECT_CACHE_MAX = 1_000;

let cache = createBoundedTtlCache<ProjectRecord | null>(HOOK_PROJECT_CACHE_MAX);

async function loadByHookRef(hookRef: string): Promise<ProjectRecord | null> {
  const rows = await withPlatformTx((tx) =>
    tx.select(projectColumns).from(projects).where(eq(projects.hookRef, hookRef)).limit(1),
  );
  return rows[0] ?? null;
}

/** The project whose `hook_ref` is exactly `hookRef`, or `null`. A registry failure rejects (the route answers 500). */
export async function resolveHookProject(
  hookRef: string | undefined,
): Promise<ProjectRecord | null> {
  if (typeof hookRef !== 'string' || !HOOK_REF_SHAPE.test(hookRef)) return null;
  const hit = cache.get(hookRef);
  if (hit !== undefined) return hit;
  const project = await loadByHookRef(hookRef);
  cache.set(hookRef, project, project ? HOOK_PROJECT_TTL_MS : HOOK_PROJECT_NEGATIVE_TTL_MS);
  return project;
}

/**
 * The project's signing secrets for `verifyHookRequest`, in stored order (a rotation window keeps two,
 * `v1,whsec_<a>|<b>`). A project with no stored secret yields `[]`, which verifies nothing. AAD is
 * `<projectId>:hook_secret`, the same the bootstrap seals with (steps.ts).
 */
export function hookSecretsFor(project: Pick<ProjectRecord, 'id' | 'hookSecretSealed'>): string[] {
  if (!project.hookSecretSealed) return [];
  return parseHookSecrets(open(project.hookSecretSealed, `${project.id}:hook_secret`));
}

/** Forgets one reference (or all): a rotation, a test or an operator command changed the row. */
export function invalidateHookProject(hookRef?: string): void {
  if (hookRef === undefined) {
    cache = createBoundedTtlCache<ProjectRecord | null>(HOOK_PROJECT_CACHE_MAX);
  } else {
    cache.delete(hookRef);
  }
}

/** Test seam: how many references are remembered right now. */
export function hookProjectCacheSize(): number {
  return cache.size;
}
