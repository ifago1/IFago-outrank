/**
 * Weighted-random A/B variant selection.
 *
 * Pure function so it's trivial to test deterministically (pass a fixed
 * `random` argument). Returns null when there are no variants.
 */
export interface Weighted<T> {
  item: T;
  weight: number;
}

export function pickWeighted<T>(
  items: readonly Weighted<T>[],
  random: () => number = Math.random,
): T | null {
  if (items.length === 0) return null;
  const total = items.reduce(
    (s, w) => s + Math.max(0, w.weight),
    0,
  );
  if (total <= 0) return items[0]?.item ?? null;

  const target = random() * total;
  let acc = 0;
  for (const w of items) {
    acc += Math.max(0, w.weight);
    if (target < acc) return w.item;
  }
  return items[items.length - 1]?.item ?? null;
}
