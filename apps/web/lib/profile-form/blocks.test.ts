import type { MemberQuestion } from '@rede-social/contracts/profile-form';
import { PROFILE_FORM_CHAIN_FIXTURE } from '@rede-social/contracts/profile-form-branches';
import { describe, expect, it } from 'vitest';
import { type BlockNode, blocksOf } from './blocks';
import { branch, clinicForm, clinicId, form, question } from './test-fixtures';

/**
 * 12.2-14 (D-641, D-644, UI-D-679, PFORM-59): the pure grouping of a screen's questions into nested blocks. The
 * clinic fixture is the parity table's own tree: Q1 opens B1 (Q2, Q3) and B4 (Q7); Q2 opens B2 (Q4, Q5); Q5 opens
 * B3 (Q6). The server stores the form in tree order, so the tests list the questions that way.
 */

const KEYS = new Map<string, string>(
  [...PROFILE_FORM_CHAIN_FIXTURE.questions, ...PROFILE_FORM_CHAIN_FIXTURE.branches].map((item) => [
    item.id,
    item.key,
  ]),
);
const keyOf = (id: string) => KEYS.get(id) ?? id;

type Shape = string | Shape[];

/** `Q1`, `['B1', 'Q2', ['B2', 'Q4', ...]]`: a block is an array whose first item is its branch key. */
function shape(nodes: BlockNode[]): Shape[] {
  return nodes.map((node) =>
    node.kind === 'field'
      ? keyOf(node.question.id)
      : [keyOf(node.branchId), ...shape(node.children)],
  );
}

const TREE_ORDER = ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3', 'Q7'];

function clinic(stored: Record<string, unknown> = {}) {
  const read = clinicForm(stored);
  const questions = TREE_ORDER.map(
    (key) => read.questions.find((q) => q.id === clinicId(key)) as MemberQuestion,
  );
  return { questions, branches: read.branches ?? [] };
}

const all = (questions: readonly { id: string }[]) => new Set(questions.map((q) => q.id));

describe('blocksOf: nesting, adjacency and the root', () => {
  it('nests the clinic tree: Q1, [B1: Q2, [B2: Q4, Q5, [B3: Q6]], Q3], [B4: Q7]', () => {
    const { questions, branches } = clinic();
    expect(shape(blocksOf(questions, branches, all(questions)))).toEqual([
      'Q1',
      ['B1', 'Q2', ['B2', 'Q4', 'Q5', ['B3', 'Q6']], 'Q3'],
      ['B4', 'Q7'],
    ]);
  });

  it('two branches of one opener stay two blocks and never merge', () => {
    const { questions, branches } = clinic();
    const nodes = blocksOf(questions, branches, all(questions));
    const blocks = nodes.filter((node) => node.kind === 'block');
    expect(blocks.map((node) => (node.kind === 'block' ? keyOf(node.branchId) : null))).toEqual([
      'B1',
      'B4',
    ]);
  });

  it('a root question closes every open block', () => {
    const { questions, branches } = clinic();
    const root = question('short_text', { title: 'Raiz' });
    // Q1, Q2, Q4, then a root question, then Q5, Q6, Q3, Q7: the chain restarts after the root.
    const mixed = [...questions.slice(0, 3), root, ...questions.slice(3)];
    expect(shape(blocksOf(mixed, branches, all(mixed)))).toEqual([
      'Q1',
      ['B1', 'Q2', ['B2', 'Q4']],
      root.id,
      ['B1', ['B2', 'Q5', ['B3', 'Q6']], 'Q3'],
      ['B4', 'Q7'],
    ]);
  });

  it('a block whose opener is outside the list is still a block when the universe is given', () => {
    const { questions, branches } = clinic();
    const onScreen = questions.filter((q) => ['Q4', 'Q5', 'Q6'].includes(keyOf(q.id)));
    expect(shape(blocksOf(onScreen, branches, all(onScreen), questions))).toEqual([
      ['B1', ['B2', 'Q4', 'Q5', ['B3', 'Q6']]],
    ]);
  });

  it('a question with an unknown branch is a plain field', () => {
    const lost = question('short_text', { branchId: branch().id });
    const nodes = blocksOf([lost], [], new Set());
    expect(nodes).toEqual([{ kind: 'field', question: lost }]);
  });

  it('the empty list is the empty result', () => {
    expect(blocksOf([], [], new Set())).toEqual([]);
  });

  it('keeps the form when there is no branch at all', () => {
    const a = question('short_text');
    const b = question('short_text');
    const read = form([a, b]);
    expect(shape(blocksOf(read.questions, [], all(read.questions))).length).toBe(2);
  });
});

describe('blocksOf: the show flag', () => {
  const key = (node: BlockNode | undefined) => (node?.kind === 'block' ? node.show : null);

  it('a block is shown while any question inside it is visible, nested ones included', () => {
    const { questions, branches } = clinic();
    const visible = new Set([clinicId('Q1'), clinicId('Q2'), clinicId('Q3')]);
    const nodes = blocksOf(questions, branches, visible);
    const b1 = nodes[1];
    expect(key(b1)).toBe(true);
    expect(key(nodes[2])).toBe(false);
    const inner = b1?.kind === 'block' ? b1.children.find((c) => c.kind === 'block') : undefined;
    expect(key(inner)).toBe(false);
  });

  it('an outer block stays shown while only a deep question is visible', () => {
    const { questions, branches } = clinic();
    const nodes = blocksOf(questions, branches, new Set([clinicId('Q6')]));
    expect(key(nodes[1])).toBe(true);
  });

  it('nothing visible closes every block', () => {
    const { questions, branches } = clinic();
    const nodes = blocksOf(questions, branches, new Set([clinicId('Q1')]));
    expect(
      nodes.filter((n) => n.kind === 'block').every((n) => n.kind === 'block' && !n.show),
    ).toBe(true);
  });
});
