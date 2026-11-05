import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

/**
 * The temporary directory that holds the unsealed files (13-29, T-13-50). It is created fresh, used, and deleted
 * in a `finally`; a step that throws still removes it, and a second removal is a no-op.
 */

export const TEMP_PREFIX = 'app-release-';

/** The directory CI gives a job (`$RUNNER_TEMP`), else the machine's temp directory. */
// biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the CI runner, not by the repository
export const defaultTempBase = (): string => process.env.RUNNER_TEMP || tmpdir();

export async function createTempDirectory(base: string = defaultTempBase()): Promise<string> {
  return fs.mkdtemp(join(base, TEMP_PREFIX));
}

/**
 * Only a directory this command made (an absolute, normalised path whose last segment starts with `app-release-`)
 * may be removed: a wrong argument can never delete `/`, the home folder or a shared temp folder.
 */
export function assertOwnTemporaryDirectory(dir: string): void {
  if (!isAbsolute(dir) || normalize(dir) !== dir || !basename(dir).startsWith(TEMP_PREFIX)) {
    throw new Error('cleanup_refused');
  }
}

/** True when `dir` is a directory this command could have made directly under `base` (what `--secrets-dir` must be). */
export function isOwnSecretsDirectory(dir: string, base: string): boolean {
  try {
    assertOwnTemporaryDirectory(dir);
  } catch {
    return false;
  }
  return dirname(dir) === resolve(base);
}

export async function cleanupDirectory(dir: string): Promise<void> {
  assertOwnTemporaryDirectory(dir);
  await fs.rm(dir, { recursive: true, force: true });
}

/** Runs `fn` with a fresh directory and always removes it. */
export async function withTempDirectory<T>(
  base: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await createTempDirectory(base);
  try {
    return await fn(dir);
  } finally {
    await cleanupDirectory(dir);
  }
}
