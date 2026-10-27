import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 09.4-06 (D-566, Pitfall 2, T-09.4-19): the grep gate on the platform token. Exactly three files of the kernel
 * may name the platform-token variable: the env schema, the env-selected provider singleton, and the platform
 * branch of the allow-list adapter choice. Everything else resolves a provider PER PROJECT, so a customer
 * project can never be handed the platform token by a code path that forgot to ask whose project it is.
 *
 * The variable name is assembled so this file does not name it itself (the scan skips tests anyway).
 */

const ROOT = join(import.meta.dirname, '..', 'server');
const VARIABLE = ['SUPABASE', 'PAT'].join('_');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('the readers of the platform token (09.4-06)', () => {
  it('are exactly env.ts, projects/index.ts and domains/index.ts', () => {
    const readers = sourceFiles(ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes(VARIABLE))
      .map((file) => relative(ROOT, file).split('\\').join('/'))
      .sort();
    expect(readers, `unexpected readers: ${readers.join(', ')}`).toEqual([
      'domains/index.ts',
      'env.ts',
      'projects/index.ts',
    ]);
  });
});
