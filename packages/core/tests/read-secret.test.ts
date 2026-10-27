import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

/**
 * 09.4-01 (CTK-06, D-567, T-09.4-01): the hidden terminal prompt. A fake terminal drives it; the output stream
 * must receive the label and NOT ONE character of the secret. The module lives in the repo's `scripts/lib/`,
 * outside this package, so it is loaded by URL (like `probe-management-api.test.ts`).
 */

type FakeStdin = EventEmitter & {
  isTTY: boolean;
  rawModeCalls: boolean[];
  paused: boolean;
  setRawMode(on: boolean): void;
  resume(): void;
  pause(): void;
  setEncoding(encoding: string): void;
};

type SecretModule = {
  readSecret: (label: string, io?: unknown) => Promise<string>;
  NoTerminalError: new () => Error;
  SecretAbortError: new () => Error;
};
const { readSecret, NoTerminalError, SecretAbortError } = (await import(
  /* @vite-ignore */ new URL('../../../scripts/lib/read-secret.ts', import.meta.url).href
)) as SecretModule;

function fakeTerminal(isTTY = true) {
  const stdin = new EventEmitter() as FakeStdin;
  stdin.isTTY = isTTY;
  stdin.rawModeCalls = [];
  stdin.paused = true;
  stdin.setRawMode = (on) => {
    stdin.rawModeCalls.push(on);
  };
  stdin.resume = () => {
    stdin.paused = false;
  };
  stdin.pause = () => {
    stdin.paused = true;
  };
  stdin.setEncoding = () => {};
  const written: string[] = [];
  const stderr = {
    write(chunk: unknown) {
      written.push(String(chunk));
      return true;
    },
  };
  return { stdin, stderr, io: { stdin, stderr }, output: () => written.join('') };
}

const type = (stdin: EventEmitter, ...chunks: string[]) => {
  for (const chunk of chunks) stdin.emit('data', chunk);
};

const LABEL = 'Cole o token (nada aparece na tela): ';

describe('readSecret (hidden prompt, D-567)', () => {
  it('refuses a stdin that is not a terminal and writes nothing', async () => {
    const term = fakeTerminal(false);
    await expect(readSecret(LABEL, term.io)).rejects.toBeInstanceOf(NoTerminalError);
    expect(term.output()).toBe('');
    expect(term.stdin.rawModeCalls).toEqual([]);
  });

  it('types abc, Backspace, d, Enter -> abd, echoes nothing, and restores the terminal', async () => {
    const term = fakeTerminal();
    const pending = readSecret(LABEL, term.io);
    type(term.stdin, 'a', 'b', 'c', '\u007f', 'd', '\r');
    await expect(pending).resolves.toBe('abd');
    // The label and the closing newline only: not one character of the secret reached the output stream.
    expect(term.output()).toBe(`${LABEL}\n`);
    expect(term.stdin.rawModeCalls).toEqual([true, false]);
    expect(term.stdin.paused).toBe(true);
    expect(term.stdin.listenerCount('data')).toBe(0);
  });

  it('takes a pasted chunk, strips the bracketed-paste wrapper and trims', async () => {
    const term = fakeTerminal();
    const pending = readSecret(LABEL, term.io);
    type(term.stdin, '\u001b[200~  pasted-value-123 \u001b[201~\n');
    await expect(pending).resolves.toBe('pasted-value-123');
    expect(term.output()).toBe(`${LABEL}\n`);
  });

  it('Ctrl-C rejects with SecretAbortError after restoring the terminal', async () => {
    const term = fakeTerminal();
    const pending = readSecret(LABEL, term.io);
    type(term.stdin, 'x', 'y', '\u0003');
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecretAbortError);
    // The error carries a fixed message and nothing that was typed.
    expect((error as Error).message).not.toContain('xy');
    expect(term.stdin.rawModeCalls).toEqual([true, false]);
    expect(term.stdin.paused).toBe(true);
    expect(term.stdin.listenerCount('data')).toBe(0);
    expect(term.output()).not.toContain('x');
  });

  it('Ctrl-D on an empty buffer aborts like Ctrl-C', async () => {
    const term = fakeTerminal();
    const pending = readSecret(LABEL, term.io);
    type(term.stdin, '\u0004');
    await expect(pending).rejects.toBeInstanceOf(SecretAbortError);
    expect(term.stdin.rawModeCalls).toEqual([true, false]);
  });
});
