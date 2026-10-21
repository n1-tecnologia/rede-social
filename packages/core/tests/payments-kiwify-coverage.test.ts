import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kiwifyGateway } from '../server/payments/kiwify';

/**
 * PAY-33 (09.1-08): the capability matrix of the phase (`COVERAGE.md`) pinned to fixtures and to the
 * adapter, so the matrix cannot drift from the code. Every `trigger:` and `payload:` row must have a
 * fixture file named after it (the colon becomes a hyphen) and the adapter's output for that fixture must
 * match the row's decision; a new row without a fixture, or a fixture without a row, fails here.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MATRIX = join(ROOT, '.planning/phases/09.1-acesso-por-gateway-de-pagamento/COVERAGE.md');
const FIXTURES = join(ROOT, 'packages/core/tests/fixtures/payments/kiwify');

type Row = { capability: string; decision: string; reason: string };

/** The markdown table rows of the matrix: `| capability | decision | reason |`. */
function parseMatrix(markdown: string): Row[] {
  const rows: Row[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const [capability = '', decision = '', ...rest] = cells;
    if (capability === 'capability' || /^-+$/.test(capability)) continue;
    rows.push({ capability, decision, reason: rest.join('|').trim() });
  }
  return rows;
}

const rows = parseMatrix(readFileSync(MATRIX, 'utf8'));
const adapterRows = rows.filter(
  (row) => row.capability.startsWith('trigger:') || row.capability.startsWith('payload:'),
);
/** The two payload rows that are not a purchase fact at all: they must read as other / none. */
const UNREADABLE = new Set(['payload:scheduled_installment_other', 'payload:unknown_shape']);

const fixtureFile = (capability: string) => `${capability.replace(':', '-')}.json`;

describe('the matrix parser', () => {
  it('reads the rows of the real file (an unreadable file cannot pass)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(23);
    expect(adapterRows.length).toBeGreaterThanOrEqual(14);
    expect(adapterRows.filter((row) => row.capability.startsWith('trigger:'))).toHaveLength(10);
  });

  it('parses a table and skips the header and the separator', () => {
    const parsed = parseMatrix(
      [
        '| capability | decision | reason |',
        '|---|---|---|',
        '| trigger:x | OPT-OUT | a | b |',
      ].join('\n'),
    );
    expect(parsed).toEqual([{ capability: 'trigger:x', decision: 'OPT-OUT', reason: 'a|b' }]);
  });
});

describe('every row of COVERAGE.md has a decision and a reason', () => {
  for (const row of rows) {
    it(`${row.capability} is INTEGRATE or OPT-OUT and says why`, () => {
      expect(['INTEGRATE', 'OPT-OUT']).toContain(row.decision);
      expect(row.reason.length).toBeGreaterThan(0);
    });
  }
});

describe('every trigger and payload row has a fixture and the adapter honours its decision', () => {
  for (const row of adapterRows) {
    const file = fixtureFile(row.capability);

    it(`${row.capability} has the fixture ${file}`, () => {
      expect(existsSync(join(FIXTURES, file))).toBe(true);
    });

    it(`${row.capability} (${row.decision}) is mapped as the matrix says`, () => {
      const event = kiwifyGateway.normalise(readFileSync(join(FIXTURES, file)));
      if (UNREADABLE.has(row.capability)) {
        expect(event).toMatchObject({ type: 'other', effect: 'none' });
      } else if (row.decision === 'INTEGRATE') {
        expect(event.type).not.toBe('other');
        expect(event.effect).not.toBe('none');
      } else {
        // OPT-OUT triggers are still recorded: a real neutral type, no effect on access.
        expect(event.type).not.toBe('other');
        expect(event.effect).toBe('none');
      }
    });
  }

  it('no fixture file is left without a row in the matrix', () => {
    const named = new Set(adapterRows.map((row) => fixtureFile(row.capability)));
    const onDisk = readdirSync(FIXTURES).filter((name) => name.endsWith('.json'));
    expect(onDisk.length).toBeGreaterThanOrEqual(14);
    expect(onDisk.filter((name) => !named.has(name))).toEqual([]);
  });
});
