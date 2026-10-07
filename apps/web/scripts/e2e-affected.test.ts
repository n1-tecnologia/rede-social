import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type AffectedMap,
  buildInventory,
  buildMatrix,
  findUnmappedSpecs,
  formatGithubOutput,
  globToRegExp,
  loadInventory,
  loadMap,
  matchesGlob,
  type Plan,
  planAffected,
  resolveChangedFiles,
  runSelector,
} from './e2e-affected';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const e2eDir = join(repoRoot, 'apps', 'web', 'e2e');
const map = loadMap(repoRoot);
const inventory = loadInventory(repoRoot);
const realSpecs = readdirSync(e2eDir).filter((name) => name.endsWith('.spec.ts'));

function plan(...changed: string[]): Plan {
  return planAffected(changed, map, inventory);
}

const ZEROS = '0'.repeat(40);

describe('globToRegExp', () => {
  it('lets ** span directories, including none, and * stop at a slash', () => {
    expect(matchesGlob('.github/workflows/ci.yml', '.github/**')).toBe(true);
    expect(matchesGlob('README.md', '**/*.md')).toBe(true);
    expect(matchesGlob('docs/deploy/ci.md', '**/*.md')).toBe(true);
    expect(matchesGlob('a/b/c.ts', 'a/**/c.ts')).toBe(true);
    expect(matchesGlob('a/c.ts', 'a/**/c.ts')).toBe(true);
    expect(matchesGlob('a/b/c.ts', 'a/*.ts')).toBe(false);
  });

  it('treats ? as one non-slash character and { } as alternatives', () => {
    expect(matchesGlob('a/x.ts', 'a/?.ts')).toBe(true);
    expect(matchesGlob('a//.ts', 'a/?.ts')).toBe(false);
    expect(matchesGlob('apps/web/lib/stories.ts', 'apps/web/lib/{stories,story-view}.ts')).toBe(
      true,
    );
    expect(matchesGlob('apps/web/lib/event-address.ts', 'apps/web/lib/{event*,viacep}.ts')).toBe(
      true,
    );
    expect(matchesGlob('apps/web/lib/other.ts', 'apps/web/lib/{event*,viacep}.ts')).toBe(false);
  });

  it('keeps ( ) [ ] literal so route groups and [id] segments match as written', () => {
    const glob = 'apps/web/app/(app)/inicio/**';
    expect(matchesGlob('apps/web/app/(app)/inicio/page.tsx', glob)).toBe(true);
    expect(matchesGlob('apps/web/app/(app)/inicio-x/page.tsx', glob)).toBe(false);
    expect(matchesGlob('apps/web/app/app/inicio/page.tsx', glob)).toBe(false);
    expect(
      matchesGlob(
        'apps/web/app/(app)/membros/[membershipId]/page.tsx',
        'apps/web/app/(app)/membros/[membershipId]/*.tsx',
      ),
    ).toBe(true);
    expect(globToRegExp('a[b]').test('ab')).toBe(false);
  });
});

describe('affected-map.json guard', () => {
  it('lists every e2e spec in at least one group', () => {
    const missing = findUnmappedSpecs(realSpecs, map);
    expect(
      missing,
      `Add ${missing.join(', ')} to a group's "specs" in apps/web/e2e/affected-map.json (see docs/deploy/ci.md).`,
    ).toEqual([]);
  });

  it('bites: a new spec that no group lists is reported (negative control)', () => {
    expect(findUnmappedSpecs([...realSpecs, 'zz-new.spec.ts'], map)).toEqual(['zz-new.spec.ts']);
  });

  it('only names specs that exist, without whitespace (CI passes them unquoted)', () => {
    for (const group of map.groups) {
      for (const spec of group.specs) {
        expect(realSpecs, `group ${group.id} lists ${spec}`).toContain(spec);
        expect(spec).not.toMatch(/\s/);
      }
    }
  });

  it('has no group glob that matches nothing and no glob listed twice', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((line) => line !== '');
    for (const group of map.groups) {
      expect(new Set(group.globs).size, `group ${group.id} repeats a glob`).toBe(
        group.globs.length,
      );
      for (const glob of group.globs) {
        expect(
          files.some((file) => matchesGlob(file, glob)),
          `group ${group.id}: glob ${glob} matches no file`,
        ).toBe(true);
      }
    }
    expect(new Set(map.shared).size).toBe(map.shared.length);
    expect(new Set(map.ignored).size).toBe(map.ignored.length);
  });
});

describe('planAffected on the real map', () => {
  it('prints none for docs, .planning and unit-test-only diffs', () => {
    expect(plan('docs/DEPLOY.md', '.planning/STATE.md').mode).toBe('none');
    expect(plan('packages/core/tests/x.test.ts').mode).toBe('none');
    expect(plan('apps/web/lib/feed.test.ts').mode).toBe('none');
  });

  it.each([
    '.github/workflows/ci.yml',
    'packages/core/server/auth/context.ts',
    'packages/ui/src/index.ts',
    'apps/web/proxy.ts',
    'apps/web/lib/csp.ts',
    'apps/web/app/(auth)/entrar/page.tsx',
    'supabase/config.toml',
    'supabase/migrations/20260101000000_x.sql',
    'pnpm-lock.yaml',
    'apps/web/e2e/affected-map.json',
    'apps/web/scripts/e2e-affected.ts',
    'apps/web/lib/relative-time.ts',
    'apps/api/src/routes/me.ts',
  ])('prints all for %s', (path) => {
    expect(plan(path).mode).toBe('all');
  });

  it('prints some for a localized module change, as e2e/<name>.spec.ts paths', () => {
    const result = plan('packages/modules/events/server/service.ts');
    expect(result.mode).toBe('some');
    expect(result.specs).toContain('e2e/events.spec.ts');
    expect(result.specs).toContain('e2e/phase6-smoke.spec.ts');
    expect(result.specs).not.toContain('e2e/feed.spec.ts');
    for (const spec of result.specs) expect(spec).toMatch(/^e2e\/[A-Za-z0-9-]+\.spec\.ts$/);
  });

  it('unions the specs of two groups and ignores a doc next to a code file', () => {
    const events = plan('packages/modules/events/server/service.ts');
    const chat = plan('packages/modules/chat/server/service.ts');
    const both = plan(
      'packages/modules/events/server/service.ts',
      'packages/modules/chat/server/service.ts',
    );
    expect(both.mode).toBe('some');
    expect(new Set(both.specs)).toEqual(new Set([...events.specs, ...chat.specs]));
    expect(plan('docs/DEPLOY.md', 'packages/modules/events/server/service.ts').specs).toEqual(
      events.specs,
    );
  });

  it('selects a changed spec by itself, anchored so members does not pull admin-members', () => {
    const result = plan('apps/web/e2e/members.spec.ts');
    expect(result).toMatchObject({ mode: 'some', specs: ['e2e/members.spec.ts'] });
    expect(plan('apps/web/e2e/deleted-spec.spec.ts').mode).toBe('none');
  });

  it('resolves a helper to the specs that import it, transitively', () => {
    const result = plan('apps/web/e2e/chat-admin.ts');
    expect(result.mode).toBe('some');
    expect(result.specs).toEqual(
      expect.arrayContaining([
        'e2e/chat.spec.ts',
        'e2e/notifications.spec.ts',
        'e2e/phase7-smoke.spec.ts',
      ]),
    );
    expect(result.specs).not.toContain('e2e/feed.spec.ts');
    expect(plan('apps/web/e2e/fixtures.ts').mode).toBe('all');
    expect(plan('apps/web/e2e/hosts.ts').mode).toBe('all');
  });

  it('selects the specs that mention a media fixture by name', () => {
    const mentioning = realSpecs.filter((name) =>
      (inventory.sources[name] ?? '').includes('sample.mp4'),
    );
    expect(mentioning.length).toBeGreaterThan(0);
    const result = plan('apps/web/e2e/fixtures/sample.mp4');
    expect(result.mode).toBe('some');
    expect(result.specs).toEqual(mentioning.map((name) => `e2e/${name}`).sort());
  });

  it('resolves an e2e file that nobody mentions to all', () => {
    expect(plan('apps/web/e2e/fixtures/unreferenced.bin').mode).toBe('all');
  });
});

describe('weight valve', () => {
  const sources: Record<string, string> = {
    'a.spec.ts': `${'x\n'.repeat(39)}x`,
    'b.spec.ts': `${'x\n'.repeat(29)}x`,
    'c.spec.ts': `${'x\n'.repeat(29)}x`,
  };
  const synthetic = buildInventory(sources);
  const mk = (maxSomeShare: number): AffectedMap => ({
    version: 1,
    maxSomeShare,
    shared: [],
    ignored: [],
    groups: [{ id: 'g', why: 'test', globs: ['src/**'], specs: ['a.spec.ts'] }],
  });

  it('promotes a selection above maxSomeShare to all and names the share', () => {
    const result = planAffected(['src/x.ts'], mk(0.3), synthetic);
    expect(result.mode).toBe('all');
    expect(result.reasons.join('\n')).toMatch(/promoted to all/);
    expect(result.reasons.join('\n')).toMatch(/40\.0%/);
  });

  it('keeps a selection at or below maxSomeShare as some', () => {
    const atLimit = planAffected(['src/x.ts'], mk(0.4), synthetic);
    expect(atLimit.mode).toBe('some');
    expect(atLimit.specs).toEqual(['e2e/a.spec.ts']);
  });
});

describe('fallbacks and real git ranges', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'e2e-affected-'));
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8' },
    ).trim();

  const repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'apps', 'web'), { recursive: true });
  cpSync(e2eDir, join(repo, 'apps', 'web', 'e2e'), {
    recursive: true,
    filter: (source) => !/e2e\/fixtures(\/|$)/.test(source),
  });
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'note.md'), 'changed\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'docs only');
  const docsHead = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, 'packages', 'modules', 'events', 'server'), { recursive: true });
  writeFileSync(
    join(repo, 'packages', 'modules', 'events', 'server', 'service.ts'),
    'export {};\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'events module');
  const eventsHead = git(repo, 'rev-parse', 'HEAD');

  const run = (overrides: Partial<Parameters<typeof runSelector>[0]>) =>
    runSelector({ event: 'push', base, head: docsHead, repoRoot: repo, ...overrides });

  it('answers none for a docs-only range and some for an events-only range', () => {
    expect(run({}).plan.mode).toBe('none');
    const events = run({ head: eventsHead, base: docsHead }).plan;
    expect(events.mode).toBe('some');
    expect(events.specs).toContain('e2e/events.spec.ts');
  });

  it('adds both commits when the range spans them', () => {
    const result = run({ head: eventsHead });
    expect(result.changedCount).toBe(2);
    expect(result.plan.mode).toBe('some');
  });

  it.each([
    ['an empty base', { base: '' }],
    ['forty zeros', { base: ZEROS }],
    ['a well-formed sha that is absent', { base: 'a'.repeat(40) }],
    ['a malformed value', { base: ';rm -rf' }],
    ['an option-looking value', { base: '--output=/tmp/x' }],
    ['an empty head', { head: '' }],
    ['a workflow_dispatch event', { event: 'workflow_dispatch' }],
    ['a missing event', { event: undefined }],
    ['--force-all', { forceAll: true }],
  ])('falls back to all for %s, with a reason and no throw', (_label, overrides) => {
    const result = run(overrides);
    expect(result.plan.mode).toBe('all');
    expect(result.plan.reasons.length).toBeGreaterThan(0);
    expect(result.matrix.include).toHaveLength(4);
  });

  it('turns an error inside planning into all (never none)', () => {
    const bare = join(sandbox, 'bare');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '-q');
    writeFileSync(join(bare, 'a.txt'), '1\n');
    git(bare, 'add', '-A');
    git(bare, 'commit', '-q', '-m', 'one');
    const first = git(bare, 'rev-parse', 'HEAD');
    writeFileSync(join(bare, 'a.txt'), '2\n');
    git(bare, 'add', '-A');
    git(bare, 'commit', '-q', '-m', 'two');
    const second = git(bare, 'rev-parse', 'HEAD');
    const result = runSelector({ event: 'push', base: first, head: second, repoRoot: bare });
    expect(result.plan.mode).toBe('all');
    expect(result.plan.reasons.join('\n')).toMatch(/selector error/);
  });

  it('reads the changed files from a list, NUL or newline separated', () => {
    const list = join(sandbox, 'files.txt');
    writeFileSync(list, 'docs/a.md\0packages/modules/chat/server/service.ts\0');
    const nul = resolveChangedFiles({ filesFrom: list, repoRoot: repo });
    expect(nul).toEqual({
      files: ['docs/a.md', 'packages/modules/chat/server/service.ts'],
      range: 'files-from',
    });
    writeFileSync(list, 'docs/a.md\npackages/modules/chat/server/service.ts\n');
    expect(resolveChangedFiles({ filesFrom: list, repoRoot: repo })).toEqual(nul);
  });
});

describe('matrix and GITHUB_OUTPUT', () => {
  it('fans out four shards for all and one inert entry for some and none', () => {
    expect(buildMatrix('all').include).toEqual([1, 2, 3, 4].map((shard) => ({ shard, total: 4 })));
    expect(buildMatrix('some').include).toEqual([{ shard: 1, total: 1 }]);
    expect(buildMatrix('none').include).toEqual([{ shard: 1, total: 1 }]);
  });

  it('writes exactly three single-line keys and keeps specs empty unless some', () => {
    const some = formatGithubOutput({
      mode: 'some',
      specs: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
      share: 0.1,
      reasons: [],
    });
    const lines = some.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('mode=some');
    expect(lines[1]).toBe('specs=e2e/a.spec.ts e2e/b.spec.ts');
    expect(JSON.parse((lines[2] as string).slice('matrix='.length))).toEqual({
      include: [{ shard: 1, total: 1 }],
    });
    for (const mode of ['all', 'none'] as const) {
      const out = formatGithubOutput({ mode, specs: ['e2e/a.spec.ts'], share: 1, reasons: [] });
      expect(out.split('\n')[1]).toBe('specs=');
    }
  });
});
