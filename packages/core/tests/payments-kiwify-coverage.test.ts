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

  it('every fixture says whether it was observed or is only documented, and when (PAY-33)', () => {
    for (const row of adapterRows) {
      const file = fixtureFile(row.capability);
      const header = String(
        (JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as { _fixture?: unknown })._fixture,
      );
      expect(header, file).toMatch(
        /^(real-capture \(redacted\) \d{4}-\d{2}-\d{2}|documented-example \(synthetic\))/,
      );
    }
  });

  it('exactly the six triggers of the 2026-10-21 capture are real-capture; every other fixture stays documented-example', () => {
    const real = adapterRows
      .map((row) => fixtureFile(row.capability))
      .filter((file) =>
        String(
          (JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as { _fixture?: unknown })
            ._fixture,
        ).startsWith('real-capture (redacted)'),
      )
      .sort();
    expect(real).toEqual(
      [
        'trigger-chargeback.json',
        'trigger-compra_aprovada.json',
        'trigger-compra_recusada.json',
        'trigger-compra_reembolsada.json',
        'trigger-subscription_canceled.json',
        'trigger-subscription_late.json',
      ].sort(),
    );
  });

  it('CAPTURE.md records the results of the capture, answered, not answerable and owed', () => {
    const capture = readFileSync(join(FIXTURES, 'CAPTURE.md'), 'utf8');
    expect(capture).toMatch(/^## Results/m);
    expect(capture).toMatch(/Not answerable/i);
    expect(capture).toMatch(/Owed/i);
  });

  it('no fixture file is left without a row in the matrix', () => {
    const named = new Set(adapterRows.map((row) => fixtureFile(row.capability)));
    const onDisk = readdirSync(FIXTURES).filter((name) => name.endsWith('.json'));
    expect(onDisk.length).toBeGreaterThanOrEqual(14);
    expect(onDisk.filter((name) => !named.has(name))).toEqual([]);
  });
});
