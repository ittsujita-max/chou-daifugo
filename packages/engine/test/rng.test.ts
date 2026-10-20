import { describe, expect, it } from 'vitest';

import { createRng, nextFloat, nextInt, nextUint32, pick, shuffle } from '../src/rng.js';

describe('シード付きRNG', () => {
  it('同じシードなら同じ列になる', () => {
    const take = (seed: number, count: number) => {
      let state = createRng(seed);
      const values: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const [value, next] = nextUint32(state);
        values.push(value);
        state = next;
      }
      return values;
    };
    expect(take(12345, 20)).toEqual(take(12345, 20));
    expect(take(12345, 20)).not.toEqual(take(12346, 20));
  });

  it('状態を変更しない（同じ状態からは同じ値）', () => {
    const state = createRng(7);
    expect(nextUint32(state)[0]).toBe(nextUint32(state)[0]);
    expect(state).toEqual(createRng(7));
  });

  it('nextFloat は 0 以上 1 未満', () => {
    let state = createRng(99);
    for (let i = 0; i < 2000; i += 1) {
      const [value, next] = nextFloat(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it('nextInt は範囲内に収まり、全ての値が出る', () => {
    let state = createRng(2026);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      const [value, next] = nextInt(state, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
      state = next;
    }
    expect(seen.size).toBe(6);
  });

  it('nextInt(1以下) は常に0で状態も進めない', () => {
    const state = createRng(5);
    expect(nextInt(state, 1)).toEqual([0, state]);
    expect(nextInt(state, 0)).toEqual([0, state]);
  });

  it('shuffle は要素を保ち、元の配列を変更しない', () => {
    const items = Object.freeze([...Array(50).keys()]);
    const [shuffled] = shuffle(items, createRng(42));
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...items]);
    expect(items).toEqual([...Array(50).keys()]);
  });

  it('shuffle は同じシードなら同じ並び、違うシードなら別の並び', () => {
    const items = [...Array(50).keys()];
    const [a] = shuffle(items, createRng(42));
    const [b] = shuffle(items, createRng(42));
    const [c] = shuffle(items, createRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).not.toEqual(items);
  });

  it('pick は空配列で undefined', () => {
    const state = createRng(1);
    expect(pick([], state)).toEqual([undefined, state]);
    expect(pick(['x'], state)[0]).toBe('x');
  });
});
