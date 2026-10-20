import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { SetState } from '../src/score.js';
import { advanceSet, createSet, gamePoints, setRanking } from '../src/score.js';
import type { PlayerIndex } from '../src/types.js';

const newSet = (config = DEFAULT_RULE_CONFIG, startSeat: PlayerIndex = 0): SetState => {
  const created = createSet(config, 2026, startSeat);
  if (!created.ok) throw new Error(`セットを開始できない：${JSON.stringify(created.error)}`);
  return created.value;
};

/** ゲームが決着した状態をでっち上げる（advanceSet の単体テスト用）。 */
const withFinishedGame = (set: SetState, ranking: readonly PlayerIndex[]): SetState => ({
  ...set,
  game: { ...set.game, phase: 'finished', ranking },
});

const next = (set: SetState, ranking: readonly PlayerIndex[]): SetState => {
  const advanced = advanceSet(withFinishedGame(set, ranking));
  if (!advanced.ok) throw new Error(`進められない：${JSON.stringify(advanced.error)}`);
  return advanced.value;
};

describe('2.10 1ゲームの得点', () => {
  it('大富豪6・富豪4・貧民2・大貧民0', () => {
    expect(gamePoints([2, 0, 3, 1], DEFAULT_RULE_CONFIG, false)).toEqual({
      0: 4,
      1: 0,
      2: 6,
      3: 2,
    });
  });

  it('セット最終ゲームのみ大富豪に+2', () => {
    expect(gamePoints([2, 0, 3, 1], DEFAULT_RULE_CONFIG, true)).toEqual({
      0: 4,
      1: 0,
      2: 8,
      3: 2,
    });
  });
});

describe('2.10 セットの進行', () => {
  it('最初のゲームは階級なし・交換なしで、スターターは席順で決める', () => {
    const set = newSet(DEFAULT_RULE_CONFIG, 2);
    expect(set.gameNumber).toBe(1);
    expect(set.game.phase).toBe('playing');
    expect(set.game.exchange).toBeUndefined();
    expect(set.game.turn).toBe(2);
    expect(set.totals).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
    expect(set.results).toEqual([]);
  });

  it('決着していないゲームは進められない', () => {
    const result = advanceSet(newSet());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('gameNotFinished');
  });

  it('2ゲーム目以降は前ゲームの大貧民がスターターで、カード交換から始まる', () => {
    const set = next(newSet(), [1, 2, 3, 0]);
    expect(set.gameNumber).toBe(2);
    expect(set.game.phase).toBe('exchange');
    expect(set.game.turn).toBe(0);
    expect(set.game.previousTopSeat).toBe(1);
    expect(set.game.exchange?.pairs).toEqual([
      { upper: 1, lower: 0, count: 3 },
      { upper: 2, lower: 3, count: 2 },
    ]);
  });

  it('得点が累積し、4ゲームでセットが終わる', () => {
    let set = newSet();
    set = next(set, [0, 1, 2, 3]);
    expect(set.totals).toEqual({ 0: 6, 1: 4, 2: 2, 3: 0 });

    set = next(set, [0, 1, 2, 3]);
    set = next(set, [0, 1, 2, 3]);
    expect(set.gameNumber).toBe(4);
    expect(set.phase).toBe('playing');

    // 4ゲーム目は最終ゲームなので大富豪に+2。
    set = next(set, [0, 1, 2, 3]);
    expect(set.phase).toBe('finished');
    expect(set.results).toHaveLength(4);
    expect(set.totals).toEqual({ 0: 26, 1: 16, 2: 8, 3: 0 });
  });

  it('終わったセットはそれ以上進められない', () => {
    let set = newSet();
    for (let game = 0; game < 4; game += 1) set = next(set, [0, 1, 2, 3]);
    const result = advanceSet(withFinishedGame(set, [0, 1, 2, 3]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('setFinished');
  });

  it('短縮セット（2ゲーム）でも成立する', () => {
    const shortSet = { ...DEFAULT_RULE_CONFIG, gamesPerSet: 2 };
    let set = newSet(shortSet);
    set = next(set, [0, 1, 2, 3]);
    expect(set.phase).toBe('playing');
    set = next(set, [0, 1, 2, 3]);
    expect(set.phase).toBe('finished');
    // 2ゲーム目が最終ゲーム。
    expect(set.totals).toEqual({ 0: 14, 1: 8, 2: 4, 3: 0 });
  });

  it('同じシードなら同じセットになる', () => {
    expect(createSet(DEFAULT_RULE_CONFIG, 55)).toEqual(createSet(DEFAULT_RULE_CONFIG, 55));
    expect(createSet(DEFAULT_RULE_CONFIG, 55)).not.toEqual(createSet(DEFAULT_RULE_CONFIG, 56));
  });
});

describe('2.10 セット順位', () => {
  it('累計点の高い順', () => {
    let set = newSet();
    set = next(set, [0, 1, 2, 3]);
    set = next(set, [0, 1, 2, 3]);
    expect(setRanking(set)).toEqual([0, 1, 2, 3]);
  });

  it('同点は最終ゲームの順位が上の人が上', () => {
    let set = newSet();
    set = next(set, [0, 1, 2, 3]); // 0:6 1:4 2:2 3:0
    set = next(set, [3, 2, 1, 0]); // 0:6 1:6 2:6 3:6
    expect(set.totals).toEqual({ 0: 6, 1: 6, 2: 6, 3: 6 });
    // 最終ゲームの順位は [3,2,1,0]。
    expect(setRanking(set)).toEqual([3, 2, 1, 0]);
  });
});
