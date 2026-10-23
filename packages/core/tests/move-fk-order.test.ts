import { describe, expect, it } from 'vitest';
import { type FkEdge, orderTables, SELF_REF_ORDER } from '../server/projects/move/fk-order';
import { MoveError } from '../server/projects/move/types';

/**
 * 09.2-22: the foreign-key order of the copy, on synthetic graphs. The real catalog (157 constraints, one
 * self reference, one deferrable two-table cycle) is exercised by `move-copy.test.ts`.
 */

const fk = (child: string, parent: string, deferrable = false): FkEdge => ({
  child,
  parent,
  deferrable,
});

const flat = (groups: string[][]): string[] => groups.flat();

describe('orderTables (D-534, Pitfall 8)', () => {
  it('orders a chain parent-first', () => {
    const { order } = orderTables([fk('c', 'b'), fk('b', 'a')], ['c', 'a', 'b']);
    expect(order).toEqual([['a'], ['b'], ['c']]);
  });

  it('orders a diamond with every parent before its children', () => {
    const edges = [fk('b', 'a'), fk('c', 'a'), fk('d', 'b'), fk('d', 'c')];
    const flatOrder = flat(orderTables(edges, ['d', 'c', 'b', 'a']).order);
    expect(flatOrder.indexOf('a')).toBe(0);
    expect(flatOrder.indexOf('d')).toBe(3);
    expect(flatOrder.indexOf('b')).toBeLessThan(flatOrder.indexOf('d'));
    expect(flatOrder.indexOf('c')).toBeLessThan(flatOrder.indexOf('d'));
  });

  it('makes the deferrable two-table cycle one group, placed after its parents and before its children', () => {
    const edges = [
      fk('event_secrets', 'events', true),
      fk('events', 'event_secrets', true),
      fk('events', 'communities'),
      fk('event_attendances', 'events'),
    ];
    const { order } = orderTables(edges, [
      'event_attendances',
      'events',
      'event_secrets',
      'communities',
    ]);
    expect(order).toEqual([['communities'], ['event_secrets', 'events'], ['event_attendances']]);
  });

  it('accepts the self reference with its order column and reports the rule', () => {
    const edges = [fk('feed_comments', 'feed_comments'), fk('feed_comments', 'feed_posts')];
    const result = orderTables(edges, ['feed_comments', 'feed_posts']);
    expect(result.order).toEqual([['feed_posts'], ['feed_comments']]);
    expect(result.selfReference).toEqual({ feed_comments: 'parent_depth' });
    expect(SELF_REF_ORDER.feed_comments).toBe('parent_depth');
  });

  it('refuses a cycle with a non-deferrable constraint and names its tables', () => {
    const edges = [fk('a', 'b', true), fk('b', 'a', false), fk('c', 'a')];
    let caught: unknown;
    try {
      orderTables(edges, ['a', 'b', 'c']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoveError);
    expect((caught as MoveError).code).toBe('unsortable_tables');
    expect((caught as MoveError).tables).toEqual(['a', 'b']);
  });

  it('refuses a self reference that has no order rule', () => {
    expect(() => orderTables([fk('tree', 'tree')], ['tree'])).toThrowError(
      /unsortable_tables: tree/,
    );
  });

  it('breaks ties by table name so two runs give the same order', () => {
    const tables = ['zeta', 'alpha', 'mid'];
    const first = orderTables([], tables).order;
    const second = orderTables([], [...tables].reverse()).order;
    expect(first).toEqual([['alpha'], ['mid'], ['zeta']]);
    expect(second).toEqual(first);
  });

  it('ignores edges to or from a table outside the copy set (tenants, users, excluded tables)', () => {
    const edges = [fk('a', 'tenants'), fk('a', 'users'), fk('b', 'a'), fk('tenant_domains', 'a')];
    expect(orderTables(edges, ['b', 'a']).order).toEqual([['a'], ['b']]);
  });

  it('keeps a three-table deferrable ring together and still sorts the rest around it', () => {
    const edges = [
      fk('x', 'y', true),
      fk('y', 'z', true),
      fk('z', 'x', true),
      fk('x', 'root'),
      fk('leaf', 'z'),
    ];
    const { order } = orderTables(edges, ['leaf', 'z', 'y', 'x', 'root']);
    expect(order).toEqual([['root'], ['x', 'y', 'z'], ['leaf']]);
  });

  it('is not fooled by duplicate edges (composite keys produce one constraint, but two FKs may link a pair)', () => {
    const edges = [fk('b', 'a'), fk('b', 'a'), fk('b', 'a', true)];
    expect(orderTables(edges, ['b', 'a']).order).toEqual([['a'], ['b']]);
  });
});
