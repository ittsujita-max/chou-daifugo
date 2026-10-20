/**
 * 108枚のカード構成（docs/spec.md 2.1）。
 *
 * 通常札104枚（4スート × 13ランク × 2デッキ）＋ ジョーカー4枚。
 */

import type {
  Card,
  CardCopy,
  CardId,
  JokerCard,
  JokerIndex,
  NormalCard,
  Rank,
  Suit,
} from './types.js';
import { RANKS, RANK_LABELS, SUITS, SUIT_LABELS, isJoker } from './types.js';

/** 通常札の枚数（4 × 13 × 2）。 */
export const NORMAL_CARD_COUNT = 104;
/** ジョーカーの枚数。 */
export const JOKER_COUNT = 4;
/** デッキ全体の枚数。 */
export const TOTAL_CARD_COUNT = NORMAL_CARD_COUNT + JOKER_COUNT;

const CARD_COPIES: readonly CardCopy[] = ['a', 'b'];
const JOKER_INDEXES: readonly JokerIndex[] = [1, 2, 3, 4];

export function normalCardId(suit: Suit, rank: Rank, copy: CardCopy): CardId {
  return `${suit}${RANK_LABELS[rank]}${copy}`;
}

export function jokerId(index: JokerIndex): CardId {
  return `JK${String(index)}`;
}

export function makeNormalCard(suit: Suit, rank: Rank, copy: CardCopy): NormalCard {
  return { kind: 'normal', id: normalCardId(suit, rank, copy), suit, rank, copy };
}

export function makeJoker(index: JokerIndex): JokerCard {
  return { kind: 'joker', id: jokerId(index), index };
}

/**
 * 108枚の新しいデッキを決まった順で返す（シャッフルはしない）。
 * 配札は `deal()` がシード付きRNGでシャッフルして行う。
 */
export function createDeck(): readonly Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      for (const copy of CARD_COPIES) {
        cards.push(makeNormalCard(suit, rank, copy));
      }
    }
  }
  for (const index of JOKER_INDEXES) {
    cards.push(makeJoker(index));
  }
  return cards;
}

/** 通常札だけを返す。ブラインドカードにジョーカーを含めない処理で使う（spec 2.1）。 */
export function normalCardsOf(cards: readonly Card[]): readonly NormalCard[] {
  return cards.filter((card): card is NormalCard => card.kind === 'normal');
}

export function jokersOf(cards: readonly Card[]): readonly JokerCard[] {
  return cards.filter(isJoker);
}

export function countJokers(cards: readonly Card[]): number {
  return cards.reduce((total, card) => (isJoker(card) ? total + 1 : total), 0);
}

export function indexById(cards: readonly Card[]): ReadonlyMap<CardId, Card> {
  return new Map(cards.map((card) => [card.id, card]));
}

/** ログ・テストの可読性のための表示（例：`♥5a`、`JK1`）。 */
export function formatCard(card: Card): string {
  return isJoker(card) ? card.id : `${SUIT_LABELS[card.suit]}${RANK_LABELS[card.rank]}${card.copy}`;
}

export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(' ');
}
