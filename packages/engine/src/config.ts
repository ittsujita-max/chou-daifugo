/**
 * ルール設定（docs/spec.md 2章）。
 *
 * 2デッキ化で調整した値はすべてここに集約する。エンジン側でハードコードしない
 * （CLAUDE.md「ルールエンジンの設計原則」）。友人戦のルールオプション（spec 3）も
 * この型の差し替えで表現する。
 */

import type { PlayerClass } from './types.js';
import { PLAYER_COUNT } from './types.js';
import { NORMAL_CARD_COUNT, TOTAL_CARD_COUNT } from './cards.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type ExchangeConfig = {
  /** 大富豪⇔大貧民の交換枚数（spec 2.9）。 */
  readonly top: number;
  /** 富豪⇔貧民の交換枚数（spec 2.9）。 */
  readonly second: number;
};

export type RuleConfig = {
  /** 伏せ札の枚数。既定は0で108枚を配り切る（spec 2.1）。 */
  readonly blindCards: number;
  /** 革命が成立する同ランクの枚数（spec 2.6）。 */
  readonly revolutionMinCount: number;
  readonly exchange: ExchangeConfig;
  /** 8切り（spec 2.6）。 */
  readonly eightCut: boolean;
  /** 縛り（spec 2.6）。 */
  readonly suitLock: boolean;
  /** スペ3返し（spec 2.6）。 */
  readonly spade3Return: boolean;
  /** 同ランク出しの上限枚数。同ランク8枚＋ジョーカー4枚＝12（spec 2.3）。 */
  readonly maxSameRankCount: number;
  /** 階段の最小枚数（spec 2.3）。 */
  readonly sequenceMinLength: number;
  /** 1セットのゲーム数（spec 2.10）。 */
  readonly gamesPerSet: number;
  /** 階級ごとの得点（spec 2.10）。 */
  readonly classPoints: Readonly<Record<PlayerClass, number>>;
  /** セット最終ゲームの大富豪への加点（spec 2.10）。 */
  readonly finalGameTopBonus: number;
  /** 1手の持ち時間・秒（spec 2.10）。エンジンは参照しないがルール設定として保持する。 */
  readonly turnSeconds: number;
  /** 1ゲームの予備時間・秒（spec 2.10）。 */
  readonly reserveSecondsPerGame: number;
};

/**
 * spec 8「決定事項」の値。
 *
 * `revolutionMinCount` は自動対戦で確定した値（spec 2.11）。2デッキでは同ランクが
 * 8枚＋ジョーカー4枚あるため4枚だと1ゲーム7.4回も革命が起き、強弱の順序を前提にした
 * 読みが成立しなかった。5枚で1ゲーム2.5回に収まる。
 */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  blindCards: 0,
  revolutionMinCount: 5,
  exchange: { top: 3, second: 2 },
  eightCut: true,
  suitLock: true,
  spade3Return: true,
  maxSameRankCount: 12,
  sequenceMinLength: 3,
  gamesPerSet: 4,
  classPoints: { daifugo: 6, fugo: 4, hinmin: 2, daihinmin: 0 },
  finalGameTopBonus: 2,
  turnSeconds: 15,
  reserveSecondsPerGame: 30,
};

/** 友人戦オプション：伏せ札4枚＝手札26枚（spec 2.1）。 */
export const BLIND_FOUR_RULE_CONFIG: RuleConfig = {
  ...DEFAULT_RULE_CONFIG,
  blindCards: 4,
};

/** 1人あたりの手札枚数。伏せ札を除いた残りを4人で割る（spec 2.1）。 */
export function handSize(config: RuleConfig): number {
  return (TOTAL_CARD_COUNT - config.blindCards) / PLAYER_COUNT;
}

export type RuleConfigError =
  | { readonly code: 'blindCardsOutOfRange'; readonly blindCards: number }
  | { readonly code: 'blindCardsNotDivisible'; readonly blindCards: number }
  | { readonly code: 'revolutionMinCountOutOfRange'; readonly revolutionMinCount: number }
  | { readonly code: 'sequenceMinLengthOutOfRange'; readonly sequenceMinLength: number }
  | { readonly code: 'maxSameRankCountOutOfRange'; readonly maxSameRankCount: number }
  | { readonly code: 'exchangeOutOfRange'; readonly exchange: ExchangeConfig }
  | { readonly code: 'gamesPerSetOutOfRange'; readonly gamesPerSet: number };

/**
 * ルール設定の整合性を確認する。
 * 不正な設定は例外ではなく `Result` のエラーで返す。
 */
export function validateRuleConfig(config: RuleConfig): Result<RuleConfig, RuleConfigError> {
  const {
    blindCards,
    revolutionMinCount,
    sequenceMinLength,
    maxSameRankCount,
    exchange,
    gamesPerSet,
  } = config;

  // 伏せ札にジョーカーは含めないので、通常札の枚数を超えられない（spec 2.1）。
  if (!Number.isInteger(blindCards) || blindCards < 0 || blindCards > NORMAL_CARD_COUNT) {
    return err({ code: 'blindCardsOutOfRange', blindCards });
  }
  if ((TOTAL_CARD_COUNT - blindCards) % PLAYER_COUNT !== 0) {
    return err({ code: 'blindCardsNotDivisible', blindCards });
  }
  if (!Number.isInteger(maxSameRankCount) || maxSameRankCount < 2 || maxSameRankCount > 12) {
    return err({ code: 'maxSameRankCountOutOfRange', maxSameRankCount });
  }
  if (
    !Number.isInteger(revolutionMinCount) ||
    revolutionMinCount < 2 ||
    revolutionMinCount > maxSameRankCount
  ) {
    return err({ code: 'revolutionMinCountOutOfRange', revolutionMinCount });
  }
  if (!Number.isInteger(sequenceMinLength) || sequenceMinLength < 2) {
    return err({ code: 'sequenceMinLengthOutOfRange', sequenceMinLength });
  }
  if (
    !Number.isInteger(exchange.top) ||
    !Number.isInteger(exchange.second) ||
    exchange.second < 0 ||
    exchange.top < exchange.second ||
    exchange.top > handSize(config)
  ) {
    return err({ code: 'exchangeOutOfRange', exchange });
  }
  if (!Number.isInteger(gamesPerSet) || gamesPerSet < 1) {
    return err({ code: 'gamesPerSetOutOfRange', gamesPerSet });
  }

  return ok(config);
}
