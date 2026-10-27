import type { ProjectRecord } from '../tenancy/project-registry';
import { getProjectProvider } from './provider-access';
import type { ProjectProvider } from './types';

/** Skeleton for the RED commit of 09.4-06: resolves nothing per project yet. */
export type ProviderProject = Pick<
  ProjectRecord,
  'id' | 'ref' | 'provider' | 'credentialVersion'
> &
  Partial<Pick<ProjectRecord, 'owner' | 'orgSlug' | 'mgmtTokenSealed'>>;

export const PROVIDER_CACHE_MAX = 64;

export async function getProjectProviderFor(_project: ProviderProject): Promise<ProjectProvider> {
  return getProjectProvider();
}

export async function createRequestTokenProvider(_input: {
  token: string;
  orgSlug?: string;
}): Promise<ProjectProvider> {
  return getProjectProvider();
}

export function dropProjectProvider(_projectId: string): void {}
