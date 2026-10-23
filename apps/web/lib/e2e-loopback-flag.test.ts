import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tusEndpointFor } from '@/lib/upload';

/**
 * Quick 261023-ssq. The production-build PWA e2e talks to the local http Supabase stack, so the
 * build-time flag NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS is on there and nowhere else.
 */

const FLAG = 'NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS';
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(WEB_ROOT, '..', '..');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the call that failed in CI', () => {
  afterEach(() => vi.unstubAllEnvs());

  const loopbackSigned = 'http://127.0.0.1:54321/storage/v1/object/upload/sign/media/x?token=t';
  const hostedSigned = 'https://abcd.supabase.co/storage/v1/object/upload/sign/media/x';

  it('resolves the loopback TUS endpoint in a production build with the flag on', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(FLAG, '1');
    expect(tusEndpointFor(loopbackSigned)).toBe(
      'http://127.0.0.1:54321/storage/v1/upload/resumable/sign',
    );
  });

  it('still refuses the loopback origin with the flag off', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(FLAG, undefined);
    expect(() => tusEndpointFor(loopbackSigned)).toThrow(
      'upload: the signed URL origin is refused',
    );
  });

  it('resolves a hosted signed URL under both settings', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const value of ['1', undefined]) {
      vi.stubEnv(FLAG, value);
      expect(tusEndpointFor(hostedSigned)).toBe(
        'https://abcd.supabase.co/storage/v1/upload/resumable/sign',
      );
    }
  });
});

// A run of object-body text that holds no brace of its own, template literals (which may hold `${...}`) included.
const BODY = '(?:[^{}`]|`[^`]*`)*';
/** The webServer object whose command runs `next build` then `next start`, and whose env sets the flag. */
const PWA_ENTRY_WITH_FLAG = new RegExp(
  `\\{${BODY}command:\\s*\`[^\`]*next build[^\`]*next start[^\`]*\`${BODY}env:\\s*\\{[^{}]*${FLAG}:\\s*'1'[^{}]*\\}${BODY}\\}`,
);

describe('the PWA e2e config carries the flag and nothing else does', () => {
  const pwaConfig = stripComments(readFileSync(join(WEB_ROOT, 'playwright.pwa.config.ts'), 'utf8'));

  it('sets the flag to "1" in the env of the next build and next start entry', () => {
    expect(PWA_ENTRY_WITH_FLAG.test(pwaConfig)).toBe(true);
  });

  it('the pattern rejects a copy where the env sits on another object', () => {
    const wrong = pwaConfig
      .replace(new RegExp(`\\s*env:\\s*\\{[^{}]*${FLAG}[^{}]*\\},?`), '')
      .replace('webServer: [', `webServer: [{ env: { ${FLAG}: '1' } },`);
    expect(wrong).toContain(FLAG);
    expect(PWA_ENTRY_WITH_FLAG.test(wrong)).toBe(false);
  });

  it('the base Playwright config and ci.yml never name the flag', () => {
    for (const file of [
      join(WEB_ROOT, 'playwright.config.ts'),
      join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
    ]) {
      expect(readFileSync(file, 'utf8').includes(FLAG), file).toBe(false);
    }
  });
});
