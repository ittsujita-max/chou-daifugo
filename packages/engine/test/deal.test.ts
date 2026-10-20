import { describe, expect, it } from 'vitest';

import { TOTAL_CARD_COUNT, countJokers, createDeck } from '../src/cards.js';
import { BLIND_FOUR_RULE_CONFIG, DEFAULT_RULE_CONFIG, handSize } from '../src/config.js';
import { allDealtCards, deal, handsAreEqualSize } from '../src/deal.js';
import { createRng } from '../src/rng.js';
import { compareForDisplay } from '../src/strength.js';
import { PLAYER_INDEXES } from '../src/types.js';

const dealt = (seed: number, config = DEFAULT_RULE_CONFIG) => {
  const result = deal(config, createRng(seed));
  if (!result.ok) throw new Error(`配札に失敗：${result.error.code}`);
  return result.value;
};

describe('2.1 配札', () => {
  it('4人に27枚ずつ配り、伏せ札はない', () => {
    const outcome = dealt(1);
    for (const seat of PLAYER_INDEXES) {
      expect(outcome.hands[seat]).toHaveLength(27);
    }
    expect(outcome.blind).toHaveLength(0);
    expect(handsAreEqualSize(outcome)).toBe(true);
  });

  it('108枚を重複なく配り切る', () => {
    const outcome = dealt(2);
    const ids = allDealtCards(outcome).map((card) => card.id);
    expect(ids).toHaveLength(TOTAL_CARD_COUNT);
    expect(new Set(ids).size).toBe(TOTAL_CARD_COUNT);
    expect(new Set(ids)).toEqual(new Set(createDeck().map((card) => card.id)));
  });

  it('ジョーカー4枚はすべて手札に入る', () => {
    const outcome = dealt(3);
    const inHands = PLAYER_INDEXES.reduce<number>(
      (total, seat) => total + countJokers(outcome.hands[seat]),
      0,
    );
    expect(inHands).toBe(4);
  });

  it('手札は通常時の強さの昇順に並ぶ', () => {
    const outcome = dealt(4);
    for (const seat of PLAYER_INDEXES) {
      const hand = outcome.hands[seat];
      for (let i = 1; i < hand.length; i += 1) {
        expect(compareForDisplay(hand[i - 1]!, hand[i]!, false)).toBeLessThan(0);
      }
    }
  });

  it('同じシードなら同じ配札、違うシードなら別の配札', () => {
    const idsOf = (seed: number) =>
      PLAYER_INDEXES.map((seat) => dealt(seed).hands[seat].map((card) => card.id));
    expect(idsOf(777)).toEqual(idsOf(777));
    expect(idsOf(777)).not.toEqual(idsOf(778));
  });

  it('配札後のRNG状態は進んでいる', () => {
    expect(dealt(5).rng).not.toEqual(createRng(5));
  });

  it('伏せ札4枚のときは手札26枚で、伏せ札にジョーカーは入らない', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const outcome = dealt(seed, BLIND_FOUR_RULE_CONFIG);
      expect(outcome.blind).toHaveLength(4);
      expect(countJokers(outcome.blind)).toBe(0);
      for (const seat of PLAYER_INDEXES) {
        expect(outcome.hands[seat]).toHaveLength(handSize(BLIND_FOUR_RULE_CONFIG));
      }
      expect(allDealtCards(outcome)).toHaveLength(TOTAL_CARD_COUNT);
    }
  });

  it('不正なルール設定では配らずエラーを返す（例外を投げない）', () => {
    const result = deal({ ...DEFAULT_RULE_CONFIG, blindCards: 3 }, createRng(1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalidConfig');
      expect(result.error.error.code).toBe('blindCardsNotDivisible');
    }
  });
});
