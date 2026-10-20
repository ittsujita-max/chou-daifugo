/**
 * カードの強さ（docs/spec.md 2.2）。
 *
 * 通常時：`3 < 4 < … < A < 2 < JK`
 * 革命時：`2 < A < K < … < 4 < 3 < JK`（ジョーカーは革命中も最強）
 */

import type { Card, Rank, Suit } from './types.js';
import { JOKER_VALUE, MAX_RANK, MIN_RANK, SUITS } from './types.js';

/** 革命時のランク反転の軸。`REVOLUTION_PIVOT - rank` で強さが反転する。 */
const REVOLUTION_PIVOT = MIN_RANK + MAX_RANK;

/** ランクの強さ。ジョーカーを含まない。 */
export function rankValue(rank: Rank, revolution: boolean): number {
  return revolution ? REVOLUTION_PIVOT - rank : rank;
}

/** カード1枚の強さ。ジョーカーは通常時・革命時ともに最強。 */
export function cardValue(card: Card, revolution: boolean): number {
  return card.kind === 'joker' ? JOKER_VALUE : rankValue(card.rank, revolution);
}

/**
 * 強さからランクを逆算する。`rankValue` の逆関数。
 * 階段のスロットがジョーカー専用の最上段（2または3の上）なら `undefined`。
 */
export function rankFromValue(value: number, revolution: boolean): Rank | undefined {
  const rank = revolution ? REVOLUTION_PIVOT - value : value;
  return rank >= MIN_RANK && rank <= MAX_RANK ? (rank as Rank) : undefined;
}

/** `a` が強ければ正、弱ければ負、同じ強さなら0（同値禁止の判定に使う、spec 2.4）。 */
export function compareCards(a: Card, b: Card, revolution: boolean): number {
  return cardValue(a, revolution) - cardValue(b, revolution);
}

const SUIT_ORDER: Readonly<Record<Suit, number>> = Object.fromEntries(
  SUITS.map((suit, index) => [suit, index]),
) as Record<Suit, number>;

/**
 * 表示・テスト用の全順序。強さ → スート並び → デッキ番号 の順に比較するので、
 * 同じ手札なら必ず同じ並びになる（リプレイ・スナップショットの安定化）。
 */
export function compareForDisplay(a: Card, b: Card, revolution: boolean): number {
  const byValue = compareCards(a, b, revolution);
  if (byValue !== 0) return byValue;
  if (a.kind === 'joker' && b.kind === 'joker') return a.index - b.index;
  if (a.kind === 'joker') return 1;
  if (b.kind === 'joker') return -1;
  const bySuit = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  if (bySuit !== 0) return bySuit;
  return a.copy === b.copy ? 0 : a.copy === 'a' ? -1 : 1;
}

/** 弱い順に並べ替える（元の配列は変更しない）。 */
export function sortByStrength(cards: readonly Card[], revolution: boolean): readonly Card[] {
  return [...cards].sort((a, b) => compareForDisplay(a, b, revolution));
}

/** 強い順に並べ替える。カード交換で下位者が渡すカードの決定に使う（spec 2.9）。 */
export function sortByStrengthDesc(cards: readonly Card[], revolution: boolean): readonly Card[] {
  return [...cards].sort((a, b) => compareForDisplay(b, a, revolution));
}

export function strongestCard(cards: readonly Card[], revolution: boolean): Card | undefined {
  return sortByStrengthDesc(cards, revolution)[0];
}

export function weakestCard(cards: readonly Card[], revolution: boolean): Card | undefined {
  return sortByStrength(cards, revolution)[0];
}
