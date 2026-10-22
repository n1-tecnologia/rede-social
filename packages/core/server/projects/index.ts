import { env } from '../env';
import { createFakeProjectProvider } from './fake';
import { createSupabaseProjectProvider } from './management-api';
import type { ProjectProvider } from './types';

/**
 * Env-selected project provider (09.2-12, D-540, D-541), the `DOMAIN_PROVIDER` / `VIDEO_PROVIDER` pattern.
 * Configuration is read ONLY through the kernel `env` module. The bootstrap, health, credentials and move
 * code import `projectProvider` (or build their own through `createProjectProviderFor` in tests) and never
 * the adapters.
 *
 * Imported as `@rede-social/core/server/projects/index` from outside the kernel.
 */

/** The values that choose and credential the provider; `env` satisfies it, a test passes its own. */
export type ProjectProviderEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  PROJECT_PROVIDER?: 'fake' | 'supabase' | undefined;
  SUPABASE_PAT?: string | undefined;
  SUPABASE_ORG_SLUG?: string | undefined;
};

/**
 * `supabase` needs its token and organisation (a missing one is a named error, not an `undefined` that
 * reaches a request header). An unset selection means `fake` EXCEPT in production: the fake can never be
 * what runs there (T-09.2-59), so a production process that imports this module without
 * `PROJECT_PROVIDER=supabase` fails with a named error. `assertProductionEnv` refuses the explicit value at
 * boot; the unset case surfaces here, when the first module that needs a provider is loaded, so the expand
 * release (which names none) still boots.
 */
export function createProjectProviderFor(e: ProjectProviderEnv = env): ProjectProvider {
  const selected = e.PROJECT_PROVIDER ?? 'fake';
  if (selected === 'fake') {
    if (e.NODE_ENV === 'production') {
      throw new Error(
        'PROJECT_PROVIDER=supabase is required in production (the fake provider cannot run there)',
      );
    }
    return createFakeProjectProvider();
  }
  if (!e.SUPABASE_PAT) {
    throw new Error(
      'SUPABASE_PAT is required by PROJECT_PROVIDER=supabase (see assertProductionEnv)',
    );
  }
  if (!e.SUPABASE_ORG_SLUG) {
    throw new Error(
      'SUPABASE_ORG_SLUG is required by PROJECT_PROVIDER=supabase (see assertProductionEnv)',
    );
  }
  return createSupabaseProjectProvider({ pat: e.SUPABASE_PAT, orgSlug: e.SUPABASE_ORG_SLUG });
}

/** The fake here has no targets: tests and the bootstrap tests build their own with targets. */
export const projectProvider: ProjectProvider = createProjectProviderFor(env);

export {
  BOOTSTRAP_REASONS,
  BOOTSTRAP_STEPS,
  type BootstrapReason,
  type BootstrapStep,
  reasonOf,
  STEP_REASON,
} from './reasons';
export type {
  ApiKey,
  EnsuredKeys,
  PoolerConfig,
  ProjectDescription,
  ProjectHealth,
  ProjectProvider,
  ProjectProviderErrorKind,
  SigningKey,
} from './types';
export { ProjectProviderError } from './types';
