/**
 * シード付き乱数（CLAUDE.md「ルールエンジンの設計原則」）。
 *
 * `Math.random()` は使わない。状態はイミュータブルで、関数は必ず
 * 「値と次の状態」を返す。同じシードなら必ず同じ結果になるので、
 * 配札の再現・リプレイ・自動対戦のテストに使える。
 */

export type RngState = {
  /** 32bit の内部カウンタ。 */
  readonly seed: number;
};

/** mulberry32。32bitカウンタを進めるだけなので状態が小さく、再現性がある。 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

export function createRng(seed: number): RngState {
  return { seed: seed | 0 };
}

/** 0 以上 2^32 未満の整数と次の状態。 */
export function nextUint32(state: RngState): readonly [number, RngState] {
  const nextSeed = (state.seed + 0x6d2b79f5) | 0;
  return [mulberry32(state.seed), { seed: nextSeed }];
}

/** 0 以上 1 未満の小数と次の状態。 */
export function nextFloat(state: RngState): readonly [number, RngState] {
  const [value, next] = nextUint32(state);
  return [value / 0x1_0000_0000, next];
}

/**
 * 0 以上 `maxExclusive` 未満の整数と次の状態。
 * 剰余バイアスを避けるため、範囲外の値は捨てて引き直す。
 * `maxExclusive` が 1 以下なら必ず 0 を返す。
 */
export function nextInt(state: RngState, maxExclusive: number): readonly [number, RngState] {
  if (maxExclusive <= 1) return [0, state];
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let current = state;
  for (;;) {
    const [value, next] = nextUint32(current);
    current = next;
    if (value < limit) return [value % maxExclusive, current];
  }
}

/** Fisher–Yates。元の配列は変更しない。 */
export function shuffle<T>(
  items: readonly T[],
  state: RngState,
): readonly [readonly T[], RngState] {
  const result = [...items];
  let current = state;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const [j, next] = nextInt(current, i + 1);
    current = next;
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return [result, current];
}

/** 一様に1つ選ぶ。空配列なら `undefined`。CPUのランダム打ちで使う。 */
export function pick<T>(items: readonly T[], state: RngState): readonly [T | undefined, RngState] {
  if (items.length === 0) return [undefined, state];
  const [index, next] = nextInt(state, items.length);
  return [items[index], next];
}
