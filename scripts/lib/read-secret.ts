/**
 * Hidden terminal prompt for a secret (Phase 09.4-01, D-567, T-09.4-01).
 *
 * `readSecret(label)` is the ONLY way an operator command receives a customer token: the token never travels
 * through `argv`, an environment variable, shell history or the process list. It
 *   - refuses a stdin that is not a terminal (a pipe or a here-string would leak into history),
 *   - writes the label to stderr, turns raw mode on and echoes NOTHING,
 *   - ends on Enter, edits on Backspace, aborts on Ctrl-C (and Ctrl-D on an empty buffer),
 *   - always restores the terminal in a `finally`.
 * The value is returned to the caller, which keeps it in memory for the call and drops the reference.
 *
 * Callers translate `NoTerminalError` to exit 2 and `SecretAbortError` to exit 130. Both errors carry a fixed
 * message and never anything that was typed. Only `node:` builtins are used; the streams are injectable so a
 * test drives a fake terminal and asserts the output stream received no secret character.
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

const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';

export async function readSecret(
  label: string,
  io: SecretIo = { stdin: process.stdin, stderr: process.stderr },
): Promise<string> {
  const { stdin, stderr } = io;
  // Before anything is written: a non-terminal stdin must not even see the label.
  if (stdin.isTTY !== true) throw new NoTerminalError();

  stderr.write(label);
  let buffer = '';
  let onData: ((chunk: Buffer | string) => void) | null = null;
  try {
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    return await new Promise<string>((resolve, reject) => {
      onData = (chunk) => {
        const text = (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
          .split(PASTE_START)
          .join('')
          .split(PASTE_END)
          .join('');
        for (const char of text) {
          if (char === '\r' || char === '\n') {
            resolve(buffer.trim());
            return;
          }
          if (char === '\u0003' || (char === '\u0004' && buffer === '')) {
            reject(new SecretAbortError());
            return;
          }
          if (char === '\u007f' || char === '\b') {
            buffer = Array.from(buffer).slice(0, -1).join('');
            continue;
          }
          // Any other control character (arrows, escape sequences) is ignored, never stored.
          if (char < ' ') continue;
          buffer += char;
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    if (onData) stdin.removeListener('data', onData);
    if (stdin.setRawMode) stdin.setRawMode(false);
    stdin.pause();
    // One newline so the shell prompt starts on a fresh line; never the secret.
    stderr.write('\n');
    buffer = '';
  }
}
