import type { ProjectProvider } from './types';

/**
 * The provider the panel API, the health job and the break-glass command use (09.2-14, D-541). It is resolved
 * LAZILY, with a dynamic import of `./index`, for the reason plan 13 gave: `projects/index.ts` builds the
 * env-selected singleton at import and throws in production without `PROJECT_PROVIDER=supabase`, so a process
 * that merely mounts the platform routes (the expand release, a worker that never bootstraps) must not need it
 * until a request actually reaches a provider.
 *
 * Tests inject their own provider (the fake mapped to a local database) with `setProjectProviderForTests`; the
 * seam refuses to run outside `NODE_ENV=test`, so the fake can never be swapped in by a production process.
 */

let override: ProjectProvider | undefined;

export async function getProjectProvider(): Promise<ProjectProvider> {
  if (override) return override;
  return (await import('./index')).projectProvider;
}

/** Test seam: pin (or clear with `undefined`) the provider. */
export function setProjectProviderForTests(provider: ProjectProvider | undefined): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setProjectProviderForTests is a test seam');
  }
  override = provider;
}

/** Read-only view of the test override (09.4-06): the per-project resolver asks whether a test pinned one. */
export function peekProviderOverride(): ProjectProvider | undefined {
  return override;
}
