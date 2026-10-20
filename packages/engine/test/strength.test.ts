import { describe, expect, it } from 'vitest';

import { createDeck, indexById, makeJoker, makeNormalCard } from '../src/cards.js';
import {
  cardValue,
  compareCards,
  rankValue,
  sortByStrength,
  sortByStrengthDesc,
  strongestCard,
  weakestCard,
} from '../src/strength.js';
import { JOKER_VALUE, RANKS } from '../src/types.js';

const byId = indexById(createDeck());
const card = (id: string) => byId.get(id)!;

describe('2.2 カードの強さ', () => {
  it('通常時は 3 < 4 < … < A < 2', () => {
    const ascending = [...RANKS];
    for (let i = 1; i < ascending.length; i += 1) {
      const weak = makeNormalCard('S', ascending[i - 1]!, 'a');
      const strong = makeNormalCard('S', ascending[i]!, 'a');
      expect(compareCards(strong, weak, false)).toBeGreaterThan(0);
    }
  });

  it('革命時は強弱が反転して 2 < A < K < … < 3', () => {
    const ascending = [...RANKS];
    for (let i = 1; i < ascending.length; i += 1) {
      const strongNormally = makeNormalCard('S', ascending[i]!, 'a');
      const weakNormally = makeNormalCard('S', ascending[i - 1]!, 'a');
      expect(compareCards(weakNormally, strongNormally, true)).toBeGreaterThan(0);
    }
  });

  it('革命で反転しても強さの段数は13通りのまま', () => {
    const values = RANKS.map((rank) => rankValue(rank, true));
    expect(new Set(values).size).toBe(RANKS.length);
    expect(Math.min(...values)).toBe(3);
    expect(Math.max(...values)).toBe(15);
  });

  it('ジョーカーは通常時も革命時も最強', () => {
    const joker = makeJoker(1);
    expect(cardValue(joker, false)).toBe(JOKER_VALUE);
    expect(cardValue(joker, true)).toBe(JOKER_VALUE);
    for (const rank of RANKS) {
      const normal = makeNormalCard('S', rank, 'a');
      expect(compareCards(joker, normal, false)).toBeGreaterThan(0);
      expect(compareCards(joker, normal, true)).toBeGreaterThan(0);
    }
  });

  it('スートに強弱はない（同ランクは同じ強さ）', () => {
    expect(compareCards(card('S5a'), card('H5a'), false)).toBe(0);
    expect(compareCards(card('H5a'), card('H5b'), false)).toBe(0);
  });

  it('同じ手札なら必ず同じ並びになる', () => {
    const hand = [card('JK2'), card('S3a'), card('D2a'), card('H3b'), card('H3a'), card('CAa')];
    const sorted = sortByStrength(hand, false).map((item) => item.id);
    expect(sorted).toEqual(['S3a', 'H3a', 'H3b', 'CAa', 'D2a', 'JK2']);
    expect(sortByStrength([...hand].reverse(), false).map((item) => item.id)).toEqual(sorted);
  });

  it('革命中の並びは逆順（ジョーカーは最後）', () => {
    const hand = [card('S3a'), card('D2a'), card('CAa'), card('JK2')];
    expect(sortByStrength(hand, true).map((item) => item.id)).toEqual(['D2a', 'CAa', 'S3a', 'JK2']);
  });

  it('強い順・最強・最弱', () => {
    const hand = [card('S3a'), card('D2a'), card('CAa'), card('JK2')];
    expect(sortByStrengthDesc(hand, false)[0]!.id).toBe('JK2');
    expect(strongestCard(hand, false)!.id).toBe('JK2');
    expect(weakestCard(hand, false)!.id).toBe('S3a');
    expect(weakestCard(hand, true)!.id).toBe('D2a');
    expect(strongestCard([], false)).toBeUndefined();
  });
});
