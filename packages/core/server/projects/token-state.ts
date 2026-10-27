import type { TokenState } from '@rede-social/contracts/projects';

/** Skeleton: replaced by the implementation in the next commit. */
export function tokenStateOf(_input: {
  owner: string;
  tokenCheck: string | null;
  expiresAt: string | null;
  today?: string;
}): TokenState | null {
  return null;
}

export function tokenChangeFields(
  _projectId: string,
  _from: TokenState | null,
  _to: TokenState | null,
): Record<string, unknown> {
  return {};
}
