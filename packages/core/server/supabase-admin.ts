import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { open } from './secrets/sealed';
import type { ProjectRecord } from './tenancy/project-registry';

/**
 * Service-key client of PROJECT 0 for server-side admin calls (seed, sign-up), built from the environment.
 * Kernel-only import (Biome rule). It stays exported for the sites that have not moved to
 * `supabaseAdminFor(project)` yet (09.2-04, D-539); a site that talks to a tenant's own project must not use it.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ClientOptions = { auth: { persistSession: false; autoRefreshToken: false } };

export type SupabaseAdminRegistryOptions = {
  /** Builds a client; injected so a test opens no socket. */
  create: (url: string, key: string, options: ClientOptions) => SupabaseClient;
  /** The project 0 client (`credential_source = 'env'`). */
  central: () => SupabaseClient;
  /** Opens a sealed column (AAD binds it to its row). */
  open: (sealed: string, aad: string) => string;
  /** How many project clients are memoised at once (default 64). */
  capacity?: number;
};

/** Thrown when a sealed project has no service key to open. Names no project and no value. */
export class ProjectServiceKeyMissingError extends Error {
  constructor() {
    super('project service key unavailable');
    this.name = 'ProjectServiceKeyMissingError';
  }
}

/**
 * The service-key Supabase client of ONE project (D-539), opened on demand and memoised by
 * `${projectId}:${credentialVersion}` in a bounded map: a rotated credential is a new key and so a new client,
 * the oldest client is dropped past the capacity, and two projects can never share a client because the id is
 * part of the key. The sealed key is opened with AAD `<projectId>:service_key`, so a value sealed for another
 * row is unreadable here. The kind of key (`sb_secret_` or the legacy `service_role` JWT) makes no difference
 * to the client (assumption A-04-1: the registry stores whichever kind the bootstrap obtains; research spike S2
 * settles it on a real project). The key never appears in a log or an error.
 */
export function createSupabaseAdminRegistry(options: SupabaseAdminRegistryOptions) {
  const capacity = options.capacity ?? 64;
  const clients = new Map<string, SupabaseClient>();

  function forProject(
    project: Pick<
      ProjectRecord,
      'id' | 'credentialSource' | 'credentialVersion' | 'apiUrl' | 'serviceKeySealed'
    >,
  ): SupabaseClient {
    if (project.credentialSource === 'env') return options.central();
    const key = `${project.id}:${project.credentialVersion}`;
    const hit = clients.get(key);
    if (hit) return hit;
    if (!project.serviceKeySealed) throw new ProjectServiceKeyMissingError();
    const serviceKey = options.open(project.serviceKeySealed, `${project.id}:service_key`);
    const client = options.create(project.apiUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    while (clients.size >= capacity) {
      const oldest = clients.keys().next().value;
      if (oldest === undefined) break;
      clients.delete(oldest);
    }
    clients.set(key, client);
    return client;
  }

  return {
    forProject,
    /** Test seam: how many clients are held. */
    get size() {
      return clients.size;
    },
  };
}

const registry = createSupabaseAdminRegistry({
  create: (url, key, clientOptions) => createClient(url, key, clientOptions),
  central: () => supabaseAdmin,
  open,
});

/** The service-key client of `project` (project 0 from the environment, any other from its sealed key). */
export const supabaseAdminFor = (
  project: Pick<
    ProjectRecord,
    'id' | 'credentialSource' | 'credentialVersion' | 'apiUrl' | 'serviceKeySealed'
  >,
): SupabaseClient => registry.forProject(project);
