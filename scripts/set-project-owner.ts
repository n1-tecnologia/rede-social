/**
 * Skeleton (09.4-11 RED): replaced by the real command in the GREEN commit.
 */
export type SetOwnerDeps = {
  readSecret: (label: string) => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
  afterChange?: (projectId: string) => unknown;
};

export type SetOwnerArgs = { error: string };

export function parseSetOwnerArgs(_argv: readonly string[]): SetOwnerArgs {
  return { error: 'not implemented' };
}

export async function main(
  _argv: readonly string[],
  _deps: Partial<SetOwnerDeps> = {},
): Promise<number> {
  return 99;
}
