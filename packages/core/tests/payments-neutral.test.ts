import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PAY-02 / D-486 (09.1-05): the neutral layer carries no gateway brand name. Tables, columns, queue
 * and job names, contracts, routes, logs and member-facing strings speak of "a gateway"; only an
 * ADAPTER and the adapter list may name one (the real gateway's adapter file arrives with plan 08). The
 * admin copy reaches the gateway's display name only through the `{gateway}` placeholder (A-UI-8).
 *
 * The rule is a text rule enforced by a walk over the neutral paths, so a future edit that sneaks the
 * name into a column, a log field or a catalogue string fails here, in the unit suite, not in review.
 *
 * The brand is assembled from pieces so that THIS file does not itself contain the literal (and a
 * repository-wide grep for the brand finds the adapters, the planning documents and nothing else).
 */

const BRAND = ['ki', 'wify'].join('');
/** The match is deliberately blunt: the brand anywhere, in any case, including `<brand>_…` prefixes. */
const BRAND_PATTERN = new RegExp(BRAND, 'i');

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The ONLY files allowed to name a gateway: the adapter list and the real adapter (plan 08). */
const EXEMPT = new Set([
  'packages/core/server/payments/adapters.ts',
  `packages/core/server/payments/${BRAND}.ts`,
]);

const rel = (file: string) => relative(ROOT, file).split('\\').join('/');

function listDir(dir: string, keep: (name: string) => boolean): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter(keep)
    .map((name) => join(full, name))
    .filter((file) => statSync(file).isFile());
}

function walk(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(join(ROOT, path));
  }
  return out;
}

/** The neutral layer, grouped so an empty glob cannot pass silently. */
function neutralFiles() {
  return {
    schema: [
      ...listDir('packages/core/db/schema', (n) => /^payment-.*\.ts$/.test(n)),
      ...listDir('packages/core/db/schema', (n) => n === 'access-grants.ts'),
    ],
    server: listDir('packages/core/server/payments', (n) => n.endsWith('.ts')),
    contracts: listDir('packages/contracts/src', (n) => n === 'payments.ts'),
    route: listDir('apps/api/src/routes/webhooks', (n) => n === 'payments.ts'),
    migrations: listDir(
      'supabase/migrations',
      (n) => /(payments|access)/.test(n) && n.endsWith('.sql'),
    ),
    module: walk('packages/modules/payments'),
    messages: listDir('apps/web/messages/pt-BR', (n) => n.endsWith('.json')),
  };
}

/** Pure: the files whose text names the brand, minus the exempt ones. */
function offenders(files: string[], read: (file: string) => string, exempt = EXEMPT): string[] {
  return files
    .filter((file) => !exempt.has(rel(file)))
    .filter((file) => BRAND_PATTERN.test(read(file)))
    .map(rel);
}

describe('the matcher', () => {
  it('flags the brand in any case, as a prefix and inside an identifier, and nothing else', () => {
    const read = (file: string) => file;
    expect(offenders([`/x/${BRAND}.ts`], read, new Set())).toHaveLength(1);
    expect(offenders([`/x/${BRAND.toUpperCase()}_orders.sql`], read, new Set())).toHaveLength(1);
    expect(offenders([`/x/my_${BRAND}_ref.ts`], read, new Set())).toHaveLength(1);
    expect(offenders(['/x/payments.ts', '/x/gateway_orders.sql'], read, new Set())).toHaveLength(0);
  });

  it('honours the exemption list by repository-relative path', () => {
    const adapters = join(ROOT, 'packages/core/server/payments/adapters.ts');
    expect(offenders([adapters], () => BRAND)).toHaveLength(0);
    expect(offenders([adapters], () => BRAND, new Set())).toHaveLength(1);
  });
});

/**
 * Phase 10.1-15 (EP-34, EP-35, TICK-20): the files the paid-event work added, and the catalogs read as
 * DATA. The first walk above matches the migrations named for payments and access only and reads the
 * catalogs as raw text; a ticket migration, the ticket pgTAP file, the new e2e spec and the web ticket
 * library are scanned here, and every catalog VALUE is matched after `JSON.parse`, so a value spelled
 * with a unicode escape cannot hide the brand from a raw-text scan.
 */
const TICKET_MIGRATION = /(event_ticket|event_gateway|event_courtesy)/;

/** Every string VALUE of a parsed catalog (keys are not copy), at any depth. */
function catalogValues(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(catalogValues);
  if (node !== null && typeof node === 'object') {
    return Object.values(node).flatMap(catalogValues);
  }
  return [];
}

/** Pure: the values of a catalog text that name the brand (empty and bare `{gateway}` never do). */
function catalogHits(text: string): string[] {
  return catalogValues(JSON.parse(text) as unknown).filter((value) => BRAND_PATTERN.test(value));
}

describe('the matcher over parsed catalog values (EP-35)', () => {
  it('catches a value spelled with a unicode escape that a raw-text scan misses', () => {
    // `ki` + the escape of `w` + `ify`: the raw text never contains the brand, the parsed value does.
    const escaped = `{"a":{"b":"Venda pelo ${BRAND.slice(0, 2)}\\u0077${BRAND.slice(3)}."}}`;
    expect(BRAND_PATTERN.test(escaped)).toBe(false);
    expect(catalogHits(escaped)).toHaveLength(1);
  });

  it('catches the brand in any case, and in a nested array or object', () => {
    const text = JSON.stringify({ a: [{ b: BRAND.toUpperCase() }], c: { d: `x ${BRAND} y` } });
    expect(catalogHits(text)).toHaveLength(2);
  });

  it('is not a hit for an empty value, a bare {gateway} placeholder or neutral copy', () => {
    const text = JSON.stringify({
      empty: '',
      slot: '{gateway}',
      copy: 'Venda este evento pelo {gateway}: o ID fica no painel do {gateway}.',
      count: { one: '# ingresso', other: '# ingressos' },
    });
    expect(catalogHits(text)).toEqual([]);
  });
});

describe('the files of the paid-event work name no gateway (EP-34, TICK-20)', () => {
  const ticketFiles = () => ({
    migrations: listDir(
      'supabase/migrations',
      (n) => TICKET_MIGRATION.test(n) && n.endsWith('.sql'),
    ),
    pgtap: listDir('supabase/tests', (n) => n === '233-event-tickets.sql'),
    e2e: listDir('apps/web/e2e', (n) => n === 'events-tickets.spec.ts'),
    web: listDir('apps/web/lib', (n) => n === 'event-ticket.ts'),
  });

  it('walked the eleven ticket migrations, the ticket pgTAP file, the spec and the web library', () => {
    const groups = ticketFiles();
    expect(groups.migrations.length).toBeGreaterThanOrEqual(11);
    expect(groups.pgtap).toHaveLength(1);
    expect(groups.e2e).toHaveLength(1);
    expect(groups.web).toHaveLength(1);
  });

  for (const [name, files] of Object.entries(ticketFiles())) {
    it(`${name}: no file names the brand`, () => {
      expect(offenders(files, (file) => readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('every value of every pt-BR catalog, parsed, names no brand', () => {
    const catalogs = listDir('apps/web/messages/pt-BR', (n) => n.endsWith('.json'));
    expect(catalogs.length).toBeGreaterThanOrEqual(30);
    const hits = catalogs
      .filter((file) => catalogHits(readFileSync(file, 'utf8')).length > 0)
      .map(rel);
    expect(hits).toEqual([]);
  });
});

/**
 * Phase 10.2-16 (OPEN-25; EP-55 to EP-58): the files the opening of the sale added, scanned beside the
 * ticket files. The migrations whose names contain `event_opening`, its pgTAP file, the browser spec (only
 * when it exists), the two web libraries and the components of the events folder; the catalogs are read as
 * DATA (the 10.1 walk above runs over the new keys too, because it reads every parsed value). The scanned
 * list and the hit report are SORTED, so two runs print the same thing.
 */
const OPENING_MIGRATION = /event_opening/;

function openingFiles() {
  return {
    migrations: listDir(
      'supabase/migrations',
      (n) => OPENING_MIGRATION.test(n) && n.endsWith('.sql'),
    ).sort(),
    pgtap: listDir('supabase/tests', (n) => n === '234-event-opening.sql'),
    // Optional by design: a checkout without the browser spec still scans everything else.
    e2e: listDir('apps/web/e2e', (n) => n === 'events-opening.spec.ts'),
    web: listDir(
      'apps/web/lib',
      (n) => n === 'event-countdown.ts' || n === 'event-opening-form.ts',
    ).sort(),
    components: listDir('apps/web/components/events', (n) => /\.(ts|tsx)$/.test(n)).sort(),
  };
}

/** Pure and ordered: the offending files of a group, sorted, whatever order the walk produced. */
function sortedOffenders(files: string[], read: (file: string) => string): string[] {
  return offenders(files, read).sort();
}

describe('the files of the opening work name no gateway (OPEN-25)', () => {
  it('walked the three opening migrations, the pgTAP file, the web libraries and the events components', () => {
    const groups = openingFiles();
    expect(groups.migrations).toHaveLength(3);
    expect(groups.pgtap).toHaveLength(1);
    expect(groups.web).toHaveLength(2);
    expect(groups.components.length).toBeGreaterThanOrEqual(8);
  });

  for (const [name, files] of Object.entries(openingFiles())) {
    it(`${name}: no file names the brand`, () => {
      expect(sortedOffenders(files, (file) => readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the browser spec is scanned when it exists, and names no brand', () => {
    const spec = join(ROOT, 'apps/web/e2e/events-opening.spec.ts');
    if (!existsSync(spec)) return;
    expect(offenders([spec], (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('every parsed value of the events and payments catalogs, the new Em breve keys included, names no brand', () => {
    for (const name of ['events.json', 'payments.json']) {
      const text = readFileSync(join(ROOT, 'apps/web/messages/pt-BR', name), 'utf8');
      expect(catalogHits(text), name).toEqual([]);
    }
    const events = readFileSync(join(ROOT, 'apps/web/messages/pt-BR/events.json'), 'utf8');
    // The walk is not vacuous: the new copy is among the values it just read.
    expect(catalogValues(JSON.parse(events) as unknown)).toContain('Em breve');
  });
});

describe('the matcher, the edge cases of the opening work (EP-55 to EP-58)', () => {
  it('EP-55: words around {gateway}, and a longer word that only shares letters with the brand, are not hits', () => {
    const text = JSON.stringify({
      around: 'Venda pelo {gateway}, depois confira no {gateway} e volte.',
      shares: 'kiwi wifi kiosk ki wi fy',
      longer: `${BRAND.slice(0, 3)} ${BRAND.slice(3)}`,
    });
    expect(catalogHits(text)).toEqual([]);
    // ...while the whole word inside a longer one stays a hit.
    expect(catalogHits(JSON.stringify({ a: `pre${BRAND}post` }))).toHaveLength(1);
  });

  it('EP-56: an empty value and a bare {gateway} placeholder are not hits, alone or nested', () => {
    expect(catalogHits(JSON.stringify({ a: '' }))).toEqual([]);
    expect(catalogHits(JSON.stringify({ a: '{gateway}' }))).toEqual([]);
    expect(catalogHits(JSON.stringify({ a: [{ b: '' }, { c: '{gateway}' }] }))).toEqual([]);
    expect(catalogHits('{}')).toEqual([]);
  });

  it('EP-57: a value spelled with a unicode escape of the brand is caught on the parsed text, in any case', () => {
    const escaped = `{"soon":{"hint":"Abre pelo ${BRAND.slice(0, 2).toUpperCase()}\\u0057${BRAND.slice(3)}."}}`;
    expect(BRAND_PATTERN.test(escaped)).toBe(false);
    expect(catalogHits(escaped)).toHaveLength(1);
  });

  it('EP-58: the scanned list and the hit report are sorted, so two scans print the same', () => {
    const first = openingFiles();
    const second = openingFiles();
    expect(second).toEqual(first);
    for (const files of [first.migrations, first.web, first.components]) {
      expect(files).toEqual([...files].sort());
    }
    // A report over a shuffled list is the same, sorted, report.
    const files = ['/x/b.ts', '/x/a.ts', '/x/c.ts'];
    const read = () => BRAND;
    const forward = sortedOffenders(files, read);
    const backward = sortedOffenders([...files].reverse(), read);
    expect(forward).toEqual(backward);
    expect(forward).toEqual([...forward].sort());
  });
});

describe('the neutral layer names no gateway (PAY-02)', () => {
  const groups = neutralFiles();

  it('walked at least the expected files (an empty glob cannot pass)', () => {
    expect(groups.schema.length).toBeGreaterThanOrEqual(4);
    expect(groups.server.length).toBeGreaterThanOrEqual(7);
    expect(groups.contracts).toHaveLength(1);
    expect(groups.route).toHaveLength(1);
    expect(groups.migrations.length).toBeGreaterThanOrEqual(6);
    expect(groups.messages.length).toBeGreaterThanOrEqual(30);
  });

  for (const [name, files] of Object.entries(groups)) {
    it(`${name}: no file names the brand outside the two exempt files`, () => {
      expect(offenders(files, (file) => readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the exempt files are the only files of the kernel payments folder that may match', () => {
    const matching = groups.server
      .filter((file) => BRAND_PATTERN.test(readFileSync(file, 'utf8')))
      .map(rel);
    for (const file of matching) expect(EXEMPT.has(file)).toBe(true);
  });

  it('the route segment is the provider name from the path, never a literal', () => {
    const route = readFileSync(join(ROOT, 'apps/api/src/routes/webhooks/payments.ts'), 'utf8');
    expect(route).toContain("'/:provider/:integrationId'");
  });
});
