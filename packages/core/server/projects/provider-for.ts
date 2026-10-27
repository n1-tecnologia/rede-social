import { env } from '../env';
import { open } from '../secrets/sealed';
import type { ProjectRecord } from '../tenancy/project-registry';
import type { FakeProjectProvider } from './fake';
import { createSupabaseProjectProvider } from './management-api';
import { getProjectProvider, peekProviderOverride } from './provider-access';
import type { ProjectProvider } from './types';

/**
 * Which management token a call uses is a property of the PROJECT (09.4-06, D-566, D-571, D-573, CTK-22/23).
 * `getProjectProviderFor` is the one resolver: a platform project gets the platform provider exactly as before
 * (`getProjectProvider`), a customer project gets a provider built from ITS OWN sealed token and registered
 * organisation pin, with a limiter of its own (the adapter builds it), cached by project id and credential
 * version with the same 64-entry least-recently-used bound as `authAllowListFor`.
 *
 * A customer project can NEVER reach the platform token: with no sealed token the resolver throws, it does not
 * return the platform provider (T-09.4-19). The cache key is `<project id>:<credential version>` and nothing
 * else, so no token, hash, prefix or length ever appears in a key, a log or an error (T-09.4-20). This module
 * does not log.
 *
 * Test seam: a token-aware override (the fake provider, which has `forToken`) gives every customer project a
 * view of itself for the opened token; a plain override is returned as is, exactly like for a platform project.
 */

/** The columns of a registry row the resolver is chosen from; the owner fields are optional for old callers. */
export type ProviderProject = Pick<ProjectRecord, 'id' | 'ref' | 'provider' | 'credentialVersion'> &
  Partial<Pick<ProjectRecord, 'owner' | 'orgSlug' | 'mgmtTokenSealed'>>;

export const PROVIDER_CACHE_MAX = 64;

type TokenAware = Pick<FakeProjectProvider, 'forToken'>;
const isTokenAware = (provider: ProjectProvider | undefined): provider is FakeProjectProvider =>
  typeof (provider as Partial<TokenAware> | undefined)?.forToken === 'function';

/** `source` is what the entry was built from (a token-aware base, or `undefined` for the real adapter). */
type Entry = { source: ProjectProvider | undefined; provider: ProjectProvider };
const cache = new Map<string, Entry>();

const keyOf = (project: ProviderProject): string => `${project.id}:${project.credentialVersion}`;

function remember(key: string, entry: Entry): void {
  if (cache.size >= PROVIDER_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, entry);
}

function openToken(project: ProviderProject): string {
  if (!project.mgmtTokenSealed) {
    throw new Error('customer project has no sealed management token');
  }
  return open(project.mgmtTokenSealed, `${project.id}:mgmt_token`);
}

/** The fake world a customer view is taken from: a token-aware override, or the env fake singleton. */
async function fakeBase(): Promise<ProjectProvider | undefined> {
  const pinned = peekProviderOverride();
  if (pinned) return pinned;
  const selection = env.PROJECT_PROVIDER ?? (env.NODE_ENV === 'production' ? 'supabase' : 'fake');
  if (selection !== 'fake') return undefined;
  return (await import('./index')).projectProvider;
}

type Choice =
  | { kind: 'plain'; provider: ProjectProvider }
  | { kind: 'view'; base: FakeProjectProvider }
  | { kind: 'real' };

function choose(base: ProjectProvider | undefined): Choice {
  if (isTokenAware(base)) return { kind: 'view', base };
  if (base) return { kind: 'plain', provider: base };
  return { kind: 'real' };
}

function build(choice: Choice, token: string, orgSlug: string | null | undefined): ProjectProvider {
  const pin = orgSlug || undefined;
  if (choice.kind === 'view') return choice.base.forToken(token, { orgSlug: pin });
  if (choice.kind === 'plain') return choice.provider;
  return createSupabaseProjectProvider({ pat: token, tokenKind: 'customer', orgSlug: pin });
}

function resolveCustomer(
  project: ProviderProject,
  base: ProjectProvider | undefined,
): ProjectProvider {
  const choice = choose(base);
  if (choice.kind === 'plain') return choice.provider;
  const key = keyOf(project);
  const source = choice.kind === 'view' ? choice.base : undefined;
  const hit = cache.get(key);
  if (hit && hit.source === source) {
    // Refresh recency: the entry moves to the end of the insertion order.
    cache.delete(key);
    cache.set(key, hit);
    return hit.provider;
  }
  cache.delete(key);
  const provider = build(choice, openToken(project), project.orgSlug);
  remember(key, { source, provider });
  return provider;
}

const isCustomer = (project: ProviderProject): boolean => project.owner === 'customer';

/** The provider for ONE project: the platform provider, or one built from the project's own sealed token. */
export async function getProjectProviderFor(project: ProviderProject): Promise<ProjectProvider> {
  if (!isCustomer(project)) return getProjectProvider();
  return resolveCustomer(project, await fakeBase());
}

/**
 * The synchronous form (the redirect allow-list adapter is chosen synchronously): the same selection without
 * the lazily imported fake singleton, sharing the cache. A token-aware override gives a view, a plain override
 * is returned as is, otherwise the real customer adapter.
 */
export function customerProviderFor(project: ProviderProject): ProjectProvider {
  return resolveCustomer(project, peekProviderOverride());
}

/**
 * A provider for a token that is not in the registry yet (the pre-check, an owner change, a move target). It is
 * NEVER cached and never stores the token beyond the adapter's own closure. Without `orgSlug` the adapter is in
 * learn mode: the first read teaches it the organisation of the project it was asked about.
 */
export async function createRequestTokenProvider(input: {
  token: string;
  orgSlug?: string;
}): Promise<ProjectProvider> {
  return build(choose(await fakeBase()), input.token, input.orgSlug);
}

/** Forgets every credential version of one project (D-575(a): after a replacement the next call rebuilds). */
export function dropProjectProvider(projectId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${projectId}:`)) cache.delete(key);
  }
}
