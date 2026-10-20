import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { CpuLevel } from '../src/cpu.js';
import { chooseAction, chooseExchangeCards, handWeakness, urgencyOf } from '../src/cpu.js';
import type { GameAction, GameState } from '../src/game.js';
import { applyAction, pendingExchangeSeats } from '../src/game.js';
import { advanceSet, createSet } from '../src/score.js';
import { createRng } from '../src/rng.js';
import type { PlayerIndex } from '../src/types.js';
import { PLAYER_INDEXES } from '../src/types.js';
import { cards, gameWith } from './helpers.js';

const rng = () => createRng(1);

const decide = (state: GameState, seat: PlayerIndex, level: CpuLevel = 'advanced'): GameAction => {
  const decision = chooseAction(state, seat, level, rng());
  if (decision === undefined) throw new Error('CPUが手を選べない');
  return decision.action;
};

const playedIds = (action: GameAction): readonly string[] =>
  action.type === 'play' ? action.cards.map((card) => card.id) : [];

/**
 * 相手には普通の枚数を持たせる。相手の手札が少ないとCPUが「急ぐ」判断に入るので、
 * 基本方針のテストでは枚数で揺らがないようにする。
 */
const calm = {
  1: ['H3a', 'H4a', 'H5a', 'H6a', 'H7a', 'H9a', 'H10a', 'HJa'],
  2: ['D3a', 'D4a', 'D5a', 'D6a', 'D7a', 'D9a', 'D10a', 'DJa'],
  3: ['C3a', 'C6a', 'C7a', 'C9a', 'C10a', 'CJa', 'CQa', 'CKa'],
} as const;

describe('CPUの基本方針', () => {
  it('上がれる手があれば上がる', () => {
    const state = gameWith({ hands: { ...calm, 0: ['S5a', 'S5b'] }, turn: 0 });
    expect(playedIds(decide(state, 0))).toEqual(['S5a', 'S5b']);
  });

  it('反則上がりになる手は避けてパスする', () => {
    // ジョーカー1枚だけで上がると反則上がり（spec 2.7）。場があるのでパスできる。
    const state = gameWith({
      hands: { ...calm, 0: ['JK1'] },
      field: { ids: ['C4a'], leader: 3 },
      turn: 0,
    });
    expect(decide(state, 0).type).toBe('pass');
  });

  it('パスできない場面では反則上がりでも出す', () => {
    const state = gameWith({ hands: { ...calm, 0: ['JK1'] }, turn: 0 });
    const action = decide(state, 0);
    expect(action.type).toBe('play');
    expect(playedIds(action)).toEqual(['JK1']);
  });

  it('場が空なら弱いカードから出す', () => {
    const state = gameWith({ hands: { ...calm, 0: ['S4a', 'SQa'] }, turn: 0 });
    expect(playedIds(decide(state, 0))).toEqual(['S4a']);
  });

  it('最後に残せない2は早めに手放す', () => {
    // ♠4を先に出すと最後が2だけになり反則上がりになる。2から出すのが正しい。
    const state = gameWith({ hands: { ...calm, 0: ['S4a', 'S2a'] }, turn: 0 });
    expect(playedIds(decide(state, 0))).toEqual(['S2a']);
  });

  it('ジョーカーを1枚使うだけの場面ではパスして温存する', () => {
    const state = gameWith({
      hands: { ...calm, 0: ['JK1', 'S6a', 'S7a'] },
      field: { ids: ['C2a'], leader: 3 },
      turn: 0,
    });
    expect(decide(state, 0).type).toBe('pass');
  });

  it('8切りで場を流せる手は選ばれやすい', () => {
    const state = gameWith({
      hands: { ...calm, 0: ['S8a', 'SQa', 'S9a', 'S4a'] },
      field: { ids: ['C5a'], leader: 3 },
      turn: 0,
    });
    expect(playedIds(decide(state, 0))).toEqual(['S8a']);
  });

  it('同じ状態・同じシードなら同じ手を選ぶ', () => {
    const state = gameWith({
      hands: { ...calm, 0: ['S4a', 'S5a', 'S6a', 'JK1'] },
      turn: 0,
    });
    expect(decide(state, 0, 'beginner')).toEqual(decide(state, 0, 'beginner'));
  });

  it('手番でない席・退場した席は手を返さない', () => {
    const state = gameWith({ hands: { ...calm, 0: ['S5a'] }, turn: 1 });
    expect(chooseAction(state, 0, 'advanced', rng())).toBeUndefined();
  });
});

describe('CPUの状況判断', () => {
  it('手札の弱さを0〜1で返す', () => {
    expect(handWeakness(cards('S3a', 'S4a', 'S5a'), false)).toBe(1);
    expect(handWeakness(cards('S2a', 'SAa', 'SKa'), false)).toBe(0);
    expect(handWeakness([], false)).toBe(0);
    // 革命中は高いランクが弱い。
    expect(handWeakness(cards('S2a', 'SAa'), true)).toBe(1);
  });

  it('前ゲームの大富豪でまだ誰も上がっていなければ急ぐ', () => {
    const base = { hands: { ...calm, 0: ['S5a', 'S6a', 'S7a'] }, turn: 0 } as const;
    expect(urgencyOf(gameWith({ ...base, previousTopSeat: 0 }), 0)).toBe(1);
    expect(urgencyOf(gameWith(base), 0)).toBe(0);
    // 誰かが有効に上がっていれば都落ちはもう決まっているので急がない。
    expect(urgencyOf(gameWith({ ...base, previousTopSeat: 0, finishOrder: [1] }), 0)).toBe(0);
  });

  it('相手の手札が少なければ急ぐ', () => {
    const few = gameWith({
      hands: { 0: ['S5a', 'S6a', 'S7a', 'S8a', 'S9a'], 1: ['H6a'], 2: ['H7a', 'H8a'], 3: ['HQa'] },
      turn: 0,
    });
    expect(urgencyOf(few, 0)).toBe(1);

    const some = gameWith({
      hands: {
        0: ['S5a', 'S6a', 'S7a'],
        1: ['H3a', 'H4a', 'H5a', 'H6a', 'H7a'],
        2: ['D3a', 'D4a', 'D5a', 'D6a', 'D7a', 'D9a'],
        3: ['C3a', 'C6a', 'C7a', 'C9a', 'C10a', 'CJa'],
      },
      turn: 0,
    });
    expect(urgencyOf(some, 0)).toBe(0.5);
  });
});

describe('CPUの交換', () => {
  it('組にならない弱いカードから渡す', () => {
    // ♠4のペアは崩さず、単体の♠5を渡す。
    const chosen = chooseExchangeCards(cards('S4a', 'H4a', 'S5a'), 1, 'advanced', rng());
    expect(chosen.cards.map((card) => card.id)).toEqual(['S5a']);
  });

  it('強いカードは渡さない', () => {
    const chosen = chooseExchangeCards(cards('S4a', 'S5a', 'D2a', 'JK1'), 2, 'advanced', rng());
    const given = chosen.cards.map((card) => card.id);
    expect(given).not.toContain('JK1');
    expect(given).not.toContain('D2a');
  });

  it('交換フェーズでは提出の手を返す', () => {
    const created = createSet(DEFAULT_RULE_CONFIG, 5);
    if (!created.ok) throw new Error('セットを開始できない');
    // 1ゲーム目は交換なしなので、2ゲーム目を作るために1ゲーム目を飛ばす。
    const finishedGame: GameState = {
      ...created.value.game,
      phase: 'finished',
      ranking: [0, 1, 2, 3],
    };
    const advanced = advanceSet({ ...created.value, game: finishedGame });
    if (!advanced.ok) throw new Error('進められない');

    const state = advanced.value.game;
    expect(state.phase).toBe('exchange');
    for (const seat of pendingExchangeSeats(state)) {
      const decision = chooseAction(state, seat, 'advanced', rng());
      expect(decision?.action.type).toBe('exchange');
      if (decision === undefined) continue;
      expect(applyAction(state, decision.action).ok).toBe(true);
    }
  });
});

describe('CPUの強さ', () => {
  /** 席ごとに頭脳を割り当ててセットを1つ通す。 */
  const runSet = (seed: number, seating: Readonly<Record<PlayerIndex, CpuLevel>>) => {
    const created = createSet(DEFAULT_RULE_CONFIG, seed);
    if (!created.ok) throw new Error('セットを開始できない');
    let set = created.value;
    let state = createRng(seed ^ 0x2545f491);

    for (;;) {
      let game = set.game;
      for (const seat of pendingExchangeSeats(game)) {
        const decision = chooseAction(game, seat, seating[seat], state);
        if (decision === undefined) throw new Error('交換の手がない');
        state = decision.rng;
        const result = applyAction(game, decision.action);
        if (!result.ok) throw new Error(`交換できない：${JSON.stringify(result.error)}`);
        game = result.value;
      }

      let guard = 0;
      while (game.phase === 'playing') {
        guard += 1;
        if (guard > 2000) throw new Error('終わらない');
        const decision = chooseAction(game, game.turn, seating[game.turn], state);
        if (decision === undefined) throw new Error('手が選べない');
        state = decision.rng;
        const result = applyAction(game, decision.action);
        if (!result.ok) throw new Error(`出せない：${JSON.stringify(result.error)}`);
        game = result.value;
      }

      const next = advanceSet({ ...set, game });
      if (!next.ok) throw new Error(`進められない：${JSON.stringify(next.error)}`);
      set = next.value;
      if (set.phase === 'finished') return set;
    }
  };

  it('上級は初級より明確に強い（30セット）', () => {
    let advancedPoints = 0;
    let beginnerPoints = 0;

    for (let seed = 0; seed < 30; seed += 1) {
      // 席順の有利を打ち消すため、上級の席をセットごとにずらす。
      const seating = Object.fromEntries(
        PLAYER_INDEXES.map((seat) => [seat, seat % 2 === seed % 2 ? 'advanced' : 'beginner']),
      ) as Record<PlayerIndex, CpuLevel>;

      const set = runSet(seed, seating);
      for (const seat of PLAYER_INDEXES) {
        if (seating[seat] === 'advanced') advancedPoints += set.totals[seat];
        else beginnerPoints += set.totals[seat];
      }
    }

    expect(advancedPoints).toBeGreaterThan(beginnerPoints * 1.2);
  });
});
