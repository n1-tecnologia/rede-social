/**
 * A bounded parallel map (quick 261006-fs9): `fn` runs over `items` with at most `limit` calls in
 * flight, and the results come back IN INPUT ORDER. `limit` is clamped to an integer between 1 and
 * `items.length`; an empty list resolves `[]` without calling `fn`.
 *
 * It starts `limit` runners; each claims the next unclaimed index, awaits `fn(item, index)` and writes
 * the result at that index, until none is left. A rejection from `fn` rejects the whole call (the other
 * runners finish their current item, then stop claiming). The push send job's `fn` never rejects: a
 * thrown send is already mapped to a `retry` outcome inside it.
 *
 * No dependency on purpose: the repo has no p-limit / p-map, and this is all the job needs.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const bound = Math.floor(limit);
  const runners = Math.min(Math.max(Number.isNaN(bound) ? 1 : bound, 1), items.length);
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const run = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: runners }, run));
  return results;
}
