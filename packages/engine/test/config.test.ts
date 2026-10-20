import { describe, expect, it } from 'vitest';

import {
  BLIND_FOUR_RULE_CONFIG,
  DEFAULT_RULE_CONFIG,
  handSize,
  validateRuleConfig,
} from '../src/config.js';

describe('ルール設定の既定値（spec 8 決定事項）', () => {
  it('革命は5枚以上（自動対戦で確定、spec 2.11）', () => {
    expect(DEFAULT_RULE_CONFIG.revolutionMinCount).toBe(5);
  });

  it('伏せ札なし＝手札27枚', () => {
    expect(DEFAULT_RULE_CONFIG.blindCards).toBe(0);
    expect(handSize(DEFAULT_RULE_CONFIG)).toBe(27);
  });

  it('カード交換は3枚／2枚', () => {
    expect(DEFAULT_RULE_CONFIG.exchange).toEqual({ top: 3, second: 2 });
  });

  it('同ランク出しは最大12枚、階段は3枚以上', () => {
    expect(DEFAULT_RULE_CONFIG.maxSameRankCount).toBe(12);
    expect(DEFAULT_RULE_CONFIG.sequenceMinLength).toBe(3);
  });

  it('得点は 6/4/2/0、最終ゲームの大富豪に+2', () => {
    expect(DEFAULT_RULE_CONFIG.classPoints).toEqual({
      daifugo: 6,
      fugo: 4,
      hinmin: 2,
      daihinmin: 0,
    });
    expect(DEFAULT_RULE_CONFIG.finalGameTopBonus).toBe(2);
    expect(DEFAULT_RULE_CONFIG.gamesPerSet).toBe(4);
  });

  it('持ち時間15秒＋予備30秒', () => {
    expect(DEFAULT_RULE_CONFIG.turnSeconds).toBe(15);
    expect(DEFAULT_RULE_CONFIG.reserveSecondsPerGame).toBe(30);
  });

  it('友人戦オプションの伏せ札4枚＝手札26枚', () => {
    expect(handSize(BLIND_FOUR_RULE_CONFIG)).toBe(26);
  });
});

describe('ルール設定の検証', () => {
  it('既定値と伏せ札4枚はどちらも妥当', () => {
    expect(validateRuleConfig(DEFAULT_RULE_CONFIG).ok).toBe(true);
    expect(validateRuleConfig(BLIND_FOUR_RULE_CONFIG).ok).toBe(true);
  });

  it('4人で割り切れない伏せ札を弾く', () => {
    const result = validateRuleConfig({ ...DEFAULT_RULE_CONFIG, blindCards: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('blindCardsNotDivisible');
  });

  it('伏せ札が通常札の枚数を超えたら弾く', () => {
    const result = validateRuleConfig({ ...DEFAULT_RULE_CONFIG, blindCards: 108 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('blindCardsOutOfRange');
  });

  it('革命枚数が上限超え・1枚以下なら弾く', () => {
    for (const revolutionMinCount of [1, 13]) {
      const result = validateRuleConfig({ ...DEFAULT_RULE_CONFIG, revolutionMinCount });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('revolutionMinCountOutOfRange');
    }
  });

  it('交換枚数が逆転・手札超えなら弾く', () => {
    for (const exchange of [
      { top: 1, second: 2 },
      { top: 28, second: 2 },
      { top: 3, second: -1 },
    ]) {
      const result = validateRuleConfig({ ...DEFAULT_RULE_CONFIG, exchange });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('exchangeOutOfRange');
    }
  });

  it('1セット0ゲームは弾く', () => {
    const result = validateRuleConfig({ ...DEFAULT_RULE_CONFIG, gamesPerSet: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('gamesPerSetOutOfRange');
  });
});
