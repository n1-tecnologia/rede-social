import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../server/auth/context';
import { emit, flush, subscribe } from '../server/events/bus';

/**
 * The kernel's `EventMap` is empty by design (MOD-02), so the suite declares its own entries the
 * way a module does. This also proves the augmentation mechanism itself: without this block the
 * `emit` calls below would not typecheck.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'test.one': { value: number };
    'test.two': { value: number };
  }
}

const ctx = (): RequestContext => ({
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  role: 'member',
  requestId: 'test',
  events: [],
});

describe('domain event bus', () => {
  it('1. collects on emit and delivers only on flush (after-commit semantics)', async () => {
    const seen: number[] = [];
    const off = subscribe('test.one', async (p) => {
      seen.push(p.value);
    });
    const c = ctx();

    emit(c, 'test.one', { value: 1 });
    // Nothing delivered yet: the transaction that produced this has not necessarily committed.
    expect(seen).toEqual([]);
    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toMatchObject({ name: 'test.one', tenantId: c.tenantId });
    expect(typeof c.events[0]?.occurredAt).toBe('string');

    await flush(c);
    expect(seen).toEqual([1]);
    // The queue is drained, so a second flush is a no-op (no double delivery).
    await flush(c);
    expect(seen).toEqual([1]);
    off();
  });

  it('2. delivers to every subscriber of the same event', async () => {
    const seen: string[] = [];
    const offA = subscribe('test.one', async () => {
      seen.push('a');
    });
    const offB = subscribe('test.one', async () => {
      seen.push('b');
    });

    const c = ctx();
    emit(c, 'test.one', { value: 7 });
    await flush(c);

    expect(seen.sort()).toEqual(['a', 'b']);
    offA();
    offB();
  });

  it('3. a throwing subscriber neither blocks the next one nor fails the request', async () => {
    const seen: string[] = [];
    const offA = subscribe('test.one', async () => {
      throw new Error('boom');
    });
    const offB = subscribe('test.one', async () => {
      seen.push('second');
    });

    const c = ctx();
    emit(c, 'test.one', { value: 1 });
    await expect(flush(c)).resolves.toBeUndefined();
    expect(seen).toEqual(['second']);
    offA();
    offB();
  });

  it('4. unsubscribe removes the handler, and other events are untouched', async () => {
    const seen: string[] = [];
    const off = subscribe('test.one', async () => {
      seen.push('one');
    });
    const offTwo = subscribe('test.two', async () => {
      seen.push('two');
    });

    off();
    const c = ctx();
    emit(c, 'test.one', { value: 1 });
    emit(c, 'test.two', { value: 2 });
    await flush(c);

    expect(seen).toEqual(['two']);
    offTwo();
  });

  it('5. an event with no subscriber is dropped silently', async () => {
    const c = ctx();
    emit(c, 'test.two', { value: 42 });
    await expect(flush(c)).resolves.toBeUndefined();
    expect(c.events).toHaveLength(0);
  });
});
