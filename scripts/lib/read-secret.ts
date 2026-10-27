/**
 * Hidden terminal prompt for a secret (Phase 09.4-01, D-567). Skeleton: the behaviour lands with the GREEN commit.
 */
export type SecretIo = {
  stdin: NodeJS.ReadStream & { isTTY?: boolean; setRawMode?(on: boolean): unknown };
  stderr: NodeJS.WritableStream;
};

export class NoTerminalError extends Error {
  constructor() {
    super('readSecret: stdin is not a terminal');
    this.name = 'NoTerminalError';
  }
}

export class SecretAbortError extends Error {
  constructor() {
    super('readSecret: aborted');
    this.name = 'SecretAbortError';
  }
}

export async function readSecret(_label: string, _io?: SecretIo): Promise<string> {
  throw new Error('readSecret: not implemented');
}
