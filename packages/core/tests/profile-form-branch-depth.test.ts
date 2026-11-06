import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import { defaultMigrationDir } from '../server/migrations/sets';

/**
 * Phase 12.2-06 (D-644, T-12.2-07; Pitfall 9): the hand-written SQL of the branches carries the depth limit as a
 * LITERAL (a trigger cannot import the TypeScript constant the way a Drizzle CHECK does). This test parses the
 * migration text and pins the literal to `PROFILE_FORM_LIMITS.branchDepth`: the gate unrolls exactly that many
 * branch levels, the depth test of PF008 one more. Raising the limit is then a new migration plus a failing test
 * that says so. It also pins the shape every guard of the file must keep (codes, order, hardening).
 */

const dir = defaultMigrationDir('tenant');
const files = readdirSync(dir).filter((name) =>
  /^\d{14}_profile_form_branches_functions\.sql$/.test(name),
);
const raw = files[0] ? readFileSync(join(dir, files[0]), 'utf8') : '';

/** The file without `--` line comments, so a comment never counts as code. */
const code = raw
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/** The text of one `create or replace function app.<name>(` up to the line that closes its `$$`. */
function functionText(name: string): string {
  const start = code.indexOf(`create or replace function app.${name}(`);
  if (start < 0) return '';
  const end = code.indexOf('\n$$;', start);
  return end < 0 ? code.slice(start) : code.slice(start, end + 4);
}

/** The distinct `b<digit>` branch aliases of a piece of SQL, as numbers, ascending. */
function branchAliases(text: string): number[] {
  return [...new Set([...text.matchAll(/\bb(\d+)\b/g)].map((match) => Number(match[1])))].sort(
    (a, b) => a - b,
  );
}

const upTo = (n: number): number[] => Array.from({ length: n }, (_, index) => index + 1);

describe('12.2-06 the depth literal of the migration follows PROFILE_FORM_LIMITS.branchDepth', () => {
  it('finds exactly one functions file for the branches', () => {
    expect(files).toHaveLength(1);
    expect(raw.length).toBeGreaterThan(0);
  });

  it('the gate joins exactly branchDepth branch levels, b1 to b<branchDepth>', () => {
    const gate = functionText('profile_form_missing');
    expect(gate).not.toBe('');
    expect(branchAliases(gate)).toEqual(upTo(PROFILE_FORM_LIMITS.branchDepth));
    expect(gate.match(/public\.profile_form_branches b\d+/g)?.length).toBe(
      PROFILE_FORM_LIMITS.branchDepth,
    );
  });

  it('the purge joins the same branchDepth levels as the gate', () => {
    const purge = functionText('profile_form_purge_closed');
    expect(purge).not.toBe('');
    expect(branchAliases(purge)).toEqual(upTo(PROFILE_FORM_LIMITS.branchDepth));
  });

  it('the PF008 depth test joins branchDepth + 1 branch levels (a cycle satisfies it too)', () => {
    const guard = functionText('profile_form_tree_guard');
    const cut = guard.indexOf("errcode = 'PF008'");
    expect(cut).toBeGreaterThan(0);
    expect(branchAliases(guard.slice(0, cut))).toEqual(upTo(PROFILE_FORM_LIMITS.branchDepth + 1));
  });
});

describe('12.2-06 the codes, the order and the hardening of the file', () => {
  it('raises PF008, PF009 and PF010 exactly once each and every one of PF001 to PF010 at least once', () => {
    for (const code10 of ['PF008', 'PF009', 'PF010']) {
      expect(code.split(`errcode = '${code10}'`).length - 1, code10).toBe(1);
    }
    for (let n = 1; n <= 10; n += 1) {
      const id = `PF${String(n).padStart(3, '0')}`;
      expect(code.includes(`errcode = '${id}'`), id).toBe(true);
    }
  });

  it('puts PF007 before PF001 in the question guard and PF006 after PF005', () => {
    const guard = functionText('profile_form_question_guard');
    expect(guard).not.toBe('');
    const at = (id: string) => guard.indexOf(`errcode = '${id}'`);
    expect(at('PF007')).toBeGreaterThan(0);
    expect(at('PF007')).toBeLessThan(at('PF001'));
    expect(at('PF005')).toBeLessThan(at('PF006'));
  });

  it('runs the conversion before the question guard is replaced and installs the legacy guard last', () => {
    const doAt = code.search(/^do \$\$/m);
    const guardAt = code.indexOf('create or replace function app.profile_form_question_guard(');
    expect(doAt).toBeGreaterThan(0);
    expect(doAt).toBeLessThan(guardAt);

    const triggers = [...code.matchAll(/create trigger (\w+)/g)].map((match) => match[1]);
    expect(triggers.at(-1)).toBe('profile_form_questions_legacy_condition_guard');
  });

  it('gives every function of the file an empty search_path', () => {
    const functions = code.match(/create or replace function app\./g)?.length ?? 0;
    const hardened = code.match(/set search_path = ''/g)?.length ?? 0;
    expect(functions).toBeGreaterThanOrEqual(8);
    expect(hardened).toBe(functions);
  });

  it('reads no archive state in the purge (an archived answer is kept, D-588)', () => {
    expect(functionText('profile_form_purge_closed')).not.toBe('');
    expect(functionText('profile_form_purge_closed')).not.toMatch(/archived_at/);
  });
});
