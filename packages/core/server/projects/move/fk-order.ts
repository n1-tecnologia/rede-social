import { MoveError } from './types';

/**
 * Foreign-key ordering of the copy (09.2-22, D-534, RESEARCH Pitfall 8). Pure functions: the edges come from
 * `pg_constraint` of the SOURCE at run time, never from a hand-written table list.
 *
 *  - an acyclic graph is a plain topological order, ties broken by table name so two runs agree;
 *  - a strongly connected group of more than one table is allowed ONLY when every constraint between its
 *    members is DEFERRABLE: it becomes ONE group, copied in one transaction under `set constraints all
 *    deferred` (`events` <-> `event_secrets`);
 *  - a self reference is allowed only for a table named in `SELF_REF_ORDER`, which names the column whose
 *    ascending order puts every parent before its children (`feed_comments.parent_depth`);
 *  - anything else cannot be sorted and fails the plan with the names of the tables involved.
 */

/** A foreign key: `child` holds a column referencing `parent`. */
export type FkEdge = { child: string; parent: string; deferrable: boolean };

/**
 * Self-referencing tables and the column that orders their rows parent-first. `feed_comments_parent_fk` is
 * `(parent_id, parent_depth, parent_target_kind) -> (id, depth, target_kind)` and is NOT deferrable: a reply's
 * `parent_depth` equals its parent's `depth`, so ascending `parent_depth` (roots, which have none, first)
 * inserts every parent before its replies.
 */
export const SELF_REF_ORDER: Readonly<Record<string, string>> = {
  feed_comments: 'parent_depth',
};

export type OrderOptions = { selfRefOrder?: Readonly<Record<string, string>> };

export type OrderResult = {
  /** Groups in copy order. A group of one table is the normal case; more than one is a deferrable cycle. */
  order: string[][];
  /** The tables whose rows are inserted by their order column (`table -> column`). */
  selfReference: Record<string, string>;
};

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Tarjan's strongly connected components over `adjacency` (parent -> children). Components come out sorted. */
function components(nodes: string[], adjacency: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: string[][] = [];

  const visit = (start: string): void => {
    // Iterative Tarjan: 50-odd tables is nothing, but a recursion limit must never decide a move.
    const work: { node: string; next: string[]; i: number }[] = [];
    const enter = (node: string): void => {
      index.set(node, counter);
      low.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);
      work.push({ node, next: [...(adjacency.get(node) ?? [])].sort(byName), i: 0 });
    };
    enter(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const child = frame.next[frame.i];
      if (child !== undefined) {
        frame.i += 1;
        if (!index.has(child)) {
          enter(child);
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(child) ?? 0));
        }
        continue;
      }
      work.pop();
      const parentFrame = work[work.length - 1];
      if (parentFrame) {
        low.set(
          parentFrame.node,
          Math.min(low.get(parentFrame.node) ?? 0, low.get(frame.node) ?? 0),
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const top = stack.pop();
          if (top === undefined) break;
          onStack.delete(top);
          component.push(top);
          if (top === frame.node) break;
        }
        found.push(component.sort(byName));
      }
    }
  };

  for (const node of nodes) if (!index.has(node)) visit(node);
  return found;
}

/**
 * Orders `tables` so every table comes after the tables it references. Edges to or from a table outside
 * `tables` are ignored (the engine handles `tenants` and `users` itself, and checks separately that nothing
 * else is referenced).
 */
export function orderTables(
  edges: readonly FkEdge[],
  tables: readonly string[],
  options: OrderOptions = {},
): OrderResult {
  const selfRefOrder = options.selfRefOrder ?? SELF_REF_ORDER;
  const nodes = [...new Set(tables)].sort(byName);
  const inSet = new Set(nodes);

  const selfReference: Record<string, string> = {};
  const selfRefused: string[] = [];
  // adjacency: parent -> children (a child must come after its parent)
  const adjacency = new Map<string, Set<string>>(nodes.map((node) => [node, new Set<string>()]));
  const pairs: FkEdge[] = [];

  for (const edge of edges) {
    if (!inSet.has(edge.child) || !inSet.has(edge.parent)) continue;
    if (edge.child === edge.parent) {
      const column = selfRefOrder[edge.child];
      if (column) selfReference[edge.child] = column;
      else selfRefused.push(edge.child);
      continue;
    }
    adjacency.get(edge.parent)?.add(edge.child);
    pairs.push(edge);
  }
  if (selfRefused.length > 0)
    throw new MoveError('unsortable_tables', [...new Set(selfRefused)].sort(byName));

  const groups = components(nodes, adjacency);

  // A cycle is acceptable only when every constraint between its members can be deferred.
  const refused: string[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const members = new Set(group);
    const hard = pairs.some(
      (edge) => members.has(edge.child) && members.has(edge.parent) && !edge.deferrable,
    );
    if (hard) refused.push(...group);
  }
  if (refused.length > 0)
    throw new MoveError('unsortable_tables', [...new Set(refused)].sort(byName));

  // Kahn over the condensed graph, ties by the group's first table name.
  const groupOf = new Map<string, number>();
  groups.forEach((group, i) => {
    for (const table of group) groupOf.set(table, i);
  });
  const indegree = groups.map(() => 0);
  const out = groups.map(() => new Set<number>());
  for (const edge of pairs) {
    const from = groupOf.get(edge.parent);
    const to = groupOf.get(edge.child);
    if (from === undefined || to === undefined || from === to) continue;
    if (!out[from]?.has(to)) {
      out[from]?.add(to);
      indegree[to] = (indegree[to] ?? 0) + 1;
    }
  }

  const key = (i: number): string => groups[i]?.[0] ?? '';
  const ready = groups
    .map((_, i) => i)
    .filter((i) => indegree[i] === 0)
    .sort((a, b) => byName(key(a), key(b)));
  const order: string[][] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    order.push(groups[next] ?? []);
    for (const to of out[next] ?? []) {
      indegree[to] = (indegree[to] ?? 0) - 1;
      if (indegree[to] === 0) {
        ready.push(to);
        ready.sort((a, b) => byName(key(a), key(b)));
      }
    }
  }

  // Unreachable for a condensed graph (it is acyclic by construction); kept as the fail-closed guard.
  if (order.length !== groups.length) throw new MoveError('unsortable_tables', nodes);

  return { order, selfReference };
}
