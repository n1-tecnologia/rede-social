import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from '../../src/modules/registry';

/**
 * MOD-05 / D-347 (RESEARCH Pattern 8): every module's README documents its public interface, and
 * this file keeps that document true. It is a unit test rather than a root script because this
 * suite already loads every manifest under placeholder env (`registry.test.ts` does too); it runs in
 * `pnpm turbo test`, CI's static job and `pnpm verify`.
 *
 * What a README must list is read from the CODE, never restated here: the manifest (flag key,
 * `requires`, consumed events, notification sources and retractions, nav href, jobs, sweep
 * functions), the module's `server/**` (every event it emits) and every file of the package (every
 * `@rede-social/core/...` specifier it imports). An event the README claims the module emits, or
 * consumes, that the code no longer does is drift too.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const MODULES_DIR = join(REPO, 'packages/modules');

/** The fixed headings, in order (D-347). The kernel README drops `## Flag key`. */
const MODULE_HEADINGS = [
  'Contracts',
  'Events emitted',
  'Events consumed',
  'Flag key',
  'Kernel dependencies',
  'Navigation',
  'Jobs',
  'Reuse',
] as const;
const KERNEL_HEADINGS = MODULE_HEADINGS.filter((heading) => heading !== 'Flag key');

/** The part of a manifest a README documents (a real `ModuleManifest` satisfies it structurally). */
type ReadmeManifest = {
  key: string;
  nav?: { href: string };
  requires?: readonly string[];
  events?: readonly { event: string }[];
  notificationSources?: readonly { event: string }[];
  notificationRetractions?: readonly { event: string }[];
  jobs?: readonly { name: string }[];
  sweepFunctions?: readonly string[];
};

/** `## Heading` -> its body, up to the next `## `. */
function readmeSections(readme: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let body: string[] = [];
  for (const line of readme.split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      if (current !== null) sections.set(current, body.join('\n'));
      current = heading[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    }
  }
  if (current !== null) sections.set(current, body.join('\n'));
  return sections;
}

/** Every `backticked` token of a section. */
function codeSpans(text: string): Set<string> {
  return new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? ''));
}

/** Backticked domain-event names (`noun.verb`, lower snake case) of a section. */
function eventNamesIn(text: string): Set<string> {
  return new Set([...codeSpans(text)].filter((span) => /^[a-z_]+\.[a-z_]+$/.test(span)));
}

/**
 * The pure drift check. Returns one human-readable problem per mismatch; an empty list means the
 * README matches the manifest, the emitted events and the kernel imports.
 */
function checkReadme(
  manifest: ReadmeManifest,
  readme: string,
  emittedNames: Iterable<string>,
  kernelSpecifiers: Iterable<string>,
): string[] {
  const problems: string[] = [];
  const sections = readmeSections(readme);
  const headings = [...sections.keys()];
  const order = MODULE_HEADINGS.filter((heading) => headings.includes(heading));
  for (const heading of MODULE_HEADINGS) {
    if (!sections.has(heading)) problems.push(`missing heading "## ${heading}"`);
  }
  const seen = headings.filter((heading) =>
    (MODULE_HEADINGS as readonly string[]).includes(heading),
  );
  if (seen.join('|') !== order.join('|')) problems.push('headings are out of the fixed order');

  const flag = sections.get('Flag key') ?? '';
  const flagKey = /`([^`\n]+)`/.exec(flag)?.[1];
  if (flagKey !== manifest.key) {
    problems.push(
      `flag key: README says ${flagKey ? `"${flagKey}"` : 'nothing'}, manifest says "${manifest.key}"`,
    );
  }
  const flagSpans = codeSpans(flag);
  for (const required of manifest.requires ?? []) {
    if (!flagSpans.has(required)) problems.push(`flag key: requires "${required}" is not listed`);
  }

  const consumed = new Set([
    ...(manifest.events ?? []).map((entry) => entry.event),
    ...(manifest.notificationSources ?? []).map((entry) => entry.event),
    ...(manifest.notificationRetractions ?? []).map((entry) => entry.event),
  ]);
  const consumedListed = eventNamesIn(sections.get('Events consumed') ?? '');
  for (const event of consumed) {
    if (!consumedListed.has(event)) problems.push(`events consumed: "${event}" is not listed`);
  }
  for (const event of consumedListed) {
    if (!consumed.has(event))
      problems.push(`events consumed: "${event}" is listed but not consumed`);
  }

  const emitted = new Set(emittedNames);
  const emittedListed = eventNamesIn(sections.get('Events emitted') ?? '');
  for (const event of emitted) {
    if (!emittedListed.has(event)) problems.push(`events emitted: "${event}" is not listed`);
  }
  for (const event of emittedListed) {
    if (!emitted.has(event))
      problems.push(`events emitted: "${event}" is listed but never emitted`);
  }

  const kernelListed = codeSpans(sections.get('Kernel dependencies') ?? '');
  for (const specifier of kernelSpecifiers) {
    if (!kernelListed.has(specifier)) {
      problems.push(`kernel dependencies: "${specifier}" is not listed`);
    }
  }

  if (manifest.nav && !codeSpans(sections.get('Navigation') ?? '').has(manifest.nav.href)) {
    problems.push(`navigation: href "${manifest.nav.href}" is not listed`);
  }

  const jobsListed = codeSpans(sections.get('Jobs') ?? '');
  for (const name of [
    ...(manifest.jobs ?? []).map((job) => job.name),
    ...(manifest.sweepFunctions ?? []),
  ]) {
    if (!jobsListed.has(name)) problems.push(`jobs: "${name}" is not listed`);
  }

  if (!(sections.get('Reuse') ?? '').includes('packages/reuse-fixture')) {
    problems.push('reuse: does not point to packages/reuse-fixture');
  }
  return problems;
}

/** Every file under `dir` with one of `extensions`, skipping `node_modules`. */
function filesUnder(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(path);
  }
  return out;
}

/**
 * The event names a module emits: the literal names in the second argument of every
 * `emit(ctx, …)` call in `server/**`, so `emit(ctx, cancel ? 'event.cancelled' : 'event.reactivated',`
 * yields both.
 */
function emittedNamesIn(sources: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    for (const call of source.matchAll(/\bemit\(\s*[A-Za-z_$][\w$.]*\s*,\s*([^,]+),/g)) {
      for (const name of (call[1] ?? '').matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
        if (name[1]) names.add(name[1]);
      }
    }
  }
  return names;
}

/** Every distinct `@rede-social/core/...` import specifier (static `from '…'`). */
function kernelSpecifiersIn(sources: readonly string[]): Set<string> {
  const specifiers = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/from\s+'(@rede-social\/core\/[^']+)'/g)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return specifiers;
}

const read = (path: string) => readFileSync(path, 'utf8');

describe('module READMEs cannot drift (MOD-05, D-347)', () => {
  const entries = Object.entries(MODULE_REGISTRY);

  it('1. the registry holds every module package, so no README escapes the check', () => {
    const packages = readdirSync(MODULES_DIR).filter((entry) =>
      existsSync(join(MODULES_DIR, entry, 'module.ts')),
    );
    expect(entries.map(([key]) => key).sort()).toEqual(packages.sort());
  });

  it.each(entries)(
    '2. %s: README matches its manifest, its emits and its kernel imports',
    (key, manifest) => {
      const dir = join(MODULES_DIR, key);
      const readmePath = join(dir, 'README.md');
      expect(existsSync(readmePath), `${key}/README.md exists`).toBe(true);
      const emitted = emittedNamesIn(filesUnder(join(dir, 'server'), ['.ts']).map(read));
      const kernel = kernelSpecifiersIn(filesUnder(dir, ['.ts', '.tsx']).map(read));
      expect(checkReadme(manifest as ReadmeManifest, read(readmePath), emitted, kernel)).toEqual(
        [],
      );
    },
  );

  it('3. the kernel moderation README carries the headings and the public names', () => {
    const readme = read(join(REPO, 'packages/core/server/moderation/README.md'));
    const sections = readmeSections(readme);
    expect([...sections.keys()].filter((h) => (KERNEL_HEADINGS as string[]).includes(h))).toEqual(
      KERNEL_HEADINGS,
    );
    expect(sections.has('Flag key')).toBe(false);
    for (const name of [
      'recordModerationAction',
      'listModerationLog',
      'blockMembership',
      'unblockMembership',
      'setMembershipRole',
      'membership.blocked',
      'moderation.manage',
      'members.manage',
      'tenant.manage',
      '/v1/admin',
    ]) {
      expect(readme, name).toContain(name);
    }
  });
});

describe('checkReadme bites', () => {
  const manifest: ReadmeManifest = {
    key: 'events',
    nav: { href: '/eventos' },
    requires: ['feed'],
    events: [{ event: 'event.published' }],
    notificationSources: [{ event: 'event.reminder_due' }],
    notificationRetractions: [{ event: 'event.cancelled' }],
    jobs: [{ name: 'events.reminder' }],
    sweepFunctions: ['events_prune'],
  };
  const kernel = ['@rede-social/core/server/events/bus', '@rede-social/core/db/tenant-tx'];
  const good = [
    '# synthetic',
    '## Contracts',
    '`./contracts`',
    '## Events emitted',
    '- `event.published`',
    '## Events consumed',
    '- `event.published`, `event.reminder_due`, `event.cancelled`',
    '## Flag key',
    '`events`, requires `feed`',
    '## Kernel dependencies',
    '- `@rede-social/core/server/events/bus`',
    '- `@rede-social/core/db/tenant-tx`',
    '## Navigation',
    '`/eventos`',
    '## Jobs',
    '`events.reminder`, `events_prune`',
    '## Reuse',
    'See packages/reuse-fixture.',
  ].join('\n');
  const emitted = ['event.published'];

  it('1. a README that matches reports nothing', () => {
    expect(checkReadme(manifest, good, emitted, kernel)).toEqual([]);
  });

  it('2. an emitted event the README omits is reported', () => {
    expect(checkReadme(manifest, good, [...emitted, 'event.rsvp'], kernel)).toEqual([
      'events emitted: "event.rsvp" is not listed',
    ]);
  });

  it('3. an omitted consumed event, flag key and kernel specifier are each reported', () => {
    const drifted = good
      .replace(', `event.cancelled`', '')
      .replace('`events`, requires', '`eventos`, requires')
      .replace('- `@rede-social/core/db/tenant-tx`\n', '');
    expect(checkReadme(manifest, drifted, emitted, kernel)).toEqual([
      'flag key: README says "eventos", manifest says "events"',
      'events consumed: "event.cancelled" is not listed',
      'kernel dependencies: "@rede-social/core/db/tenant-tx" is not listed',
    ]);
  });

  it('4. a stale listing, a missing href, job, required key and heading are reported', () => {
    const drifted = good
      .replace(
        '- `event.published`\n## Events consumed',
        '- `event.published`, `event.gone`\n## Events consumed',
      )
      .replace('`/eventos`', '`/agenda`')
      .replace(', `events_prune`', '')
      .replace(', requires `feed`', '')
      .replace('## Reuse\nSee packages/reuse-fixture.', '');
    expect(checkReadme(manifest, drifted, emitted, kernel)).toEqual([
      'missing heading "## Reuse"',
      'flag key: requires "feed" is not listed',
      'events emitted: "event.gone" is listed but never emitted',
      'navigation: href "/eventos" is not listed',
      'jobs: "events_prune" is not listed',
      'reuse: does not point to packages/reuse-fixture',
    ]);
  });

  it('5. the scanners read ternary emits and kernel imports only', () => {
    expect(
      [
        ...emittedNamesIn([
          "emit(ctx, 'post.liked', {",
          "emit(\n  ctx,\n  cancel ? 'event.cancelled' : 'event.reactivated',\n  {",
          "emitLater(ctx, 'not.this', {",
        ]),
      ].sort(),
    ).toEqual(['event.cancelled', 'event.reactivated', 'post.liked']);
    expect(
      [
        ...kernelSpecifiersIn([
          "import { a } from '@rede-social/core/server/paging';",
          "import type { B } from '@rede-social/contracts';",
          "} from '@rede-social/core/ui';",
        ]),
      ].sort(),
    ).toEqual(['@rede-social/core/server/paging', '@rede-social/core/ui']);
  });
});
