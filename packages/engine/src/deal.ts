/**
 * 配札（docs/spec.md 2.1）。
 *
 * 108枚を4人に配り切る。伏せ札を使う場合はジョーカーを含めないので、
 * 先に通常札だけをシャッフルして伏せ札を抜き、残り全部を配る。
 */

import type { Card, PlayerIndex } from './types.js';
import { PLAYER_COUNT, PLAYER_INDEXES } from './types.js';
import { createDeck, jokersOf, normalCardsOf } from './cards.js';
import type { RuleConfig, RuleConfigError } from './config.js';
import { handSize, validateRuleConfig } from './config.js';
import type { RngState } from './rng.js';
import { shuffle } from './rng.js';
import { sortByStrength } from './strength.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type DealOutcome = {
  /** 席順の手札。各手札は通常時の強さの昇順に並ぶ。 */
  readonly hands: Readonly<Record<PlayerIndex, readonly Card[]>>;
  /** 伏せ札。既定のルールでは空（spec 2.1）。 */
  readonly blind: readonly Card[];
  /** 配札後のRNG状態。以降の乱数はここから続ける。 */
  readonly rng: RngState;
};

export type DealError = { readonly code: 'invalidConfig'; readonly error: RuleConfigError };

export function deal(config: RuleConfig, rng: RngState): Result<DealOutcome, DealError> {
  const validated = validateRuleConfig(config);
  if (!validated.ok) {
    return err({ code: 'invalidConfig', error: validated.error });
  }

  const deck = createDeck();
  const perPlayer = handSize(config);

  // 伏せ札はジョーカー以外から取る（spec 2.1）。
  const [shuffledNormals, afterNormals] = shuffle(normalCardsOf(deck), rng);
  const blind = shuffledNormals.slice(0, config.blindCards);
  const remaining: readonly Card[] = [
    ...shuffledNormals.slice(config.blindCards),
    ...jokersOf(deck),
  ];

  const [shuffled, afterAll] = shuffle(remaining, afterNormals);

  const hands = Object.fromEntries(
    PLAYER_INDEXES.map((seat) => [
      seat,
      sortByStrength(shuffled.slice(seat * perPlayer, (seat + 1) * perPlayer), false),
    ]),
  ) as Record<PlayerIndex, readonly Card[]>;

  return ok({ hands, blind, rng: afterAll });
}

/** 配札結果の全カードを席順に連結する。テスト・検算用。 */
export function allDealtCards(outcome: DealOutcome): readonly Card[] {
  return [...PLAYER_INDEXES.flatMap((seat) => outcome.hands[seat]), ...outcome.blind];
}

export function handsAreEqualSize(outcome: DealOutcome): boolean {
  const sizes = PLAYER_INDEXES.map((seat) => outcome.hands[seat].length);
  return sizes.every((size) => size === sizes[0]) && sizes.length === PLAYER_COUNT;
}
