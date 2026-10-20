/**
 * カード交換（docs/spec.md 2.9）。
 *
 * 前ゲームの順位に基づき、ゲーム開始時に同時交換する。
 * - 大富豪⇔大貧民は `exchange.top` 枚、富豪⇔貧民は `exchange.second` 枚
 * - 下位者は**強い順**に渡す（選べない）。革命はゲーム開始時に解除済みなので通常時の順
 * - 上位者は任意のカードを渡す
 * - セットの最初のゲームは交換なし
 */

import type { Card, CardId, PlayerIndex } from './types.js';
import { PLAYER_INDEXES } from './types.js';
import type { RuleConfig } from './config.js';
import { sortByStrength, sortByStrengthDesc } from './strength.js';

export type ExchangePair = {
  readonly upper: PlayerIndex;
  readonly lower: PlayerIndex;
  readonly count: number;
};

export type ExchangeSubmission = {
  readonly upper: PlayerIndex;
  readonly cards: readonly Card[];
};

export type ExchangeState = {
  readonly pairs: readonly ExchangePair[];
  /** 上位者が渡すカード。全組そろうと交換が実行される。 */
  readonly submissions: readonly ExchangeSubmission[];
};

export type Hands = Readonly<Record<PlayerIndex, readonly Card[]>>;

/** 前ゲームの順位（上位から）から交換の組を作る。枚数0の組は作らない。 */
export function exchangePairs(
  ranking: readonly PlayerIndex[],
  config: RuleConfig,
): readonly ExchangePair[] {
  const [top, second, third, bottom] = ranking;
  const pairs: ExchangePair[] = [];
  if (top !== undefined && bottom !== undefined && config.exchange.top > 0) {
    pairs.push({ upper: top, lower: bottom, count: config.exchange.top });
  }
  if (second !== undefined && third !== undefined && config.exchange.second > 0) {
    pairs.push({ upper: second, lower: third, count: config.exchange.second });
  }
  return pairs;
}

/** 下位者が渡すカード。強い順に決まるので選べない（spec 2.9）。 */
export function forcedExchangeCards(hand: readonly Card[], count: number): readonly Card[] {
  return sortByStrengthDesc(hand, false).slice(0, count);
}

/**
 * 上位者の既定の選択（弱い順）。仕様上は任意なので、CPUと持ち時間切れの
 * 自動処理のための既定値として使う。
 */
export function defaultExchangeCards(hand: readonly Card[], count: number): readonly Card[] {
  return sortByStrength(hand, false).slice(0, count);
}

function withoutCards(hand: readonly Card[], removed: readonly Card[]): readonly Card[] {
  const ids = new Set<CardId>(removed.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

/**
 * 交換を実行して新しい手札を返す。同時交換なので、渡すカードはすべて交換前の手札から選ぶ。
 * 返る手札は通常時の強さの昇順。
 */
export function swapHands(
  hands: Hands,
  pairs: readonly ExchangePair[],
  submissions: readonly ExchangeSubmission[],
): Hands {
  const given = new Map<PlayerIndex, readonly Card[]>();
  const received = new Map<PlayerIndex, readonly Card[]>();

  for (const pair of pairs) {
    const fromUpper = submissions.find((entry) => entry.upper === pair.upper)?.cards ?? [];
    const fromLower = forcedExchangeCards(hands[pair.lower], pair.count);
    given.set(pair.upper, fromUpper);
    given.set(pair.lower, fromLower);
    received.set(pair.upper, fromLower);
    received.set(pair.lower, fromUpper);
  }

  return Object.fromEntries(
    PLAYER_INDEXES.map((seat) => [
      seat,
      sortByStrength(
        [...withoutCards(hands[seat], given.get(seat) ?? []), ...(received.get(seat) ?? [])],
        false,
      ),
    ]),
  ) as Record<PlayerIndex, readonly Card[]>;
}
