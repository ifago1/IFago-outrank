/**
 * Tiny pool that runs `tasks` with at most `concurrency` in flight at any
 * time. Returns results in the same order as `inputs`. Each input gets a
 * settled-style result so one bad URL doesn't sink the whole batch.
 *
 * Inlined here so we don't take a dependency on `p-limit`/`p-map`.
 */
export type SettledResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function mapWithConcurrency<I, O>(
  inputs: readonly I[],
  concurrency: number,
  fn: (input: I, index: number) => Promise<O>,
): Promise<SettledResult<O>[]> {
  const limit = Math.max(1, Math.trunc(concurrency));
  const results: SettledResult<O>[] = new Array(inputs.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, inputs.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= inputs.length) return;
        try {
          const value = await fn(inputs[i]!, i);
          results[i] = { status: "fulfilled", value };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}
