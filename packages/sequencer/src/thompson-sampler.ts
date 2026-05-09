/**
 * Thompson sampling for A/B variant selection. Each variant maintains a
 * Beta(α, β) posterior over its reply-rate, where α = replies + prior_α
 * and β = sends − replies + prior_β. On each call we sample from each
 * posterior and pick the variant with the highest sample — variants
 * with strong evidence converge, weak ones keep being explored.
 *
 * The default uniform prior (α₀ = β₀ = 1) gives untested variants a
 * 50% expected reply-rate with high variance, so they get exploration
 * without the cold-start trap of weighted-random.
 */
export interface VariantStats {
  /** Count of sends for this variant. */
  sends: number;
  /** Count of replies attributed to this variant. */
  replies: number;
}

export interface ThompsonItem<T> {
  item: T;
  stats: VariantStats;
}

export interface ThompsonOptions {
  random?: () => number;
  /** Pseudo-counts added to all variants. Default 1, 1 (uniform prior). */
  priorAlpha?: number;
  priorBeta?: number;
}

/**
 * Pick the item whose sampled reply-rate is highest. Returns null only
 * when the input list is empty.
 */
export function pickThompson<T>(
  items: readonly ThompsonItem<T>[],
  opts: ThompsonOptions = {},
): T | null {
  if (items.length === 0) return null;
  const random = opts.random ?? Math.random;
  const pa = opts.priorAlpha ?? 1;
  const pb = opts.priorBeta ?? 1;

  let bestSample = -Infinity;
  let bestItem: T | null = items[0]?.item ?? null;
  for (const it of items) {
    const alpha = it.stats.replies + pa;
    const beta = Math.max(0, it.stats.sends - it.stats.replies) + pb;
    const sample = sampleBeta(alpha, beta, random);
    if (sample > bestSample) {
      bestSample = sample;
      bestItem = it.item;
    }
  }
  return bestItem;
}

/**
 * Sample from Beta(α, β) using the gamma-ratio method:
 *   X ~ Beta(α, β)  ↔  X = G_α / (G_α + G_β),  G_k ~ Gamma(k, 1).
 *
 * Pure function. `random` only needs to return [0, 1) — typical Math.random
 * shape — and uniformity. Determinism in tests = pass a seeded generator.
 */
export function sampleBeta(
  alpha: number,
  beta: number,
  random: () => number = Math.random,
): number {
  const x = sampleGamma(alpha, random);
  const y = sampleGamma(beta, random);
  const total = x + y;
  if (total <= 0) return 0.5;
  return x / total;
}

/**
 * Sample from Gamma(shape, 1) via Marsaglia-Tsang for shape ≥ 1 and the
 * boost trick (G_α = U^{1/α} · G_{α+1}) for shape < 1.
 */
export function sampleGamma(
  shape: number,
  random: () => number = Math.random,
): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const u = random();
    const safeU = u <= 0 ? Number.EPSILON : u;
    return sampleGamma(shape + 1, random) * Math.pow(safeU, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Loop until the squeeze accepts. In practice ≤ 2 iterations.
  for (let i = 0; i < 1000; i++) {
    let v = -1;
    let z = 0;
    while (v <= 0) {
      z = sampleStandardNormal(random);
      v = 1 + c * z;
    }
    const v3 = v * v * v;
    const u = random();
    const z2 = z * z;
    if (u < 1 - 0.0331 * z2 * z2) return d * v3;
    if (Math.log(u) < 0.5 * z2 + d * (1 - v3 + Math.log(v3))) return d * v3;
  }
  // Extremely unlikely fallthrough — return a sane default.
  return d;
}

/** Box-Muller standard normal. Pure. */
export function sampleStandardNormal(
  random: () => number = Math.random,
): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
