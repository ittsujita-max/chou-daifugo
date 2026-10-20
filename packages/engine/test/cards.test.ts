import { describe, expect, it } from 'vitest';

import {
  JOKER_COUNT,
  NORMAL_CARD_COUNT,
  TOTAL_CARD_COUNT,
  countJokers,
  createDeck,
  formatCard,
  formatCards,
  indexById,
  jokersOf,
  normalCardsOf,
} from '../src/cards.js';
import { RANKS, SUITS } from '../src/types.js';

describe('2.1 カード構成', () => {
  const deck = createDeck();

  it('108枚ある', () => {
    expect(deck).toHaveLength(TOTAL_CARD_COUNT);
    expect(TOTAL_CARD_COUNT).toBe(108);
  });

  it('通常札104枚＋ジョーカー4枚', () => {
    expect(normalCardsOf(deck)).toHaveLength(NORMAL_CARD_COUNT);
    expect(normalCardsOf(deck)).toHaveLength(104);
    expect(jokersOf(deck)).toHaveLength(JOKER_COUNT);
    expect(countJokers(deck)).toBe(4);
  });

  it('同スート同ランクが2枚ずつある', () => {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const same = normalCardsOf(deck).filter((card) => card.suit === suit && card.rank === rank);
        expect(same.map((card) => card.copy).sort()).toEqual(['a', 'b']);
      }
    }
  });

  it('カードIDが108通りすべて一意', () => {
    expect(indexById(deck).size).toBe(TOTAL_CARD_COUNT);
  });

  it('カードIDはデッキ番号込みの形式（H5a / H5b / JK1〜JK4）', () => {
    const ids = deck.map((card) => card.id);
    expect(ids).toContain('H5a');
    expect(ids).toContain('H5b');
    expect(ids).toContain('S10a');
    expect(ids).toContain('CAa');
    expect(ids).toContain('D2b');
    expect(jokersOf(deck).map((joker) => joker.id)).toEqual(['JK1', 'JK2', 'JK3', 'JK4']);
  });

  it('表示用の書式', () => {
    const ids = indexById(deck);
    expect(formatCard(ids.get('H5a')!)).toBe('♥5a');
    expect(formatCard(ids.get('S2b')!)).toBe('♠2b');
    expect(formatCard(ids.get('JK3')!)).toBe('JK3');
    expect(formatCards([ids.get('H5a')!, ids.get('JK1')!])).toBe('♥5a JK1');
  });
});
