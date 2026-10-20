import { describe, expect, it } from 'vitest';

import { applyAction } from '../src/game.js';
import { getLegalActions, getLegalPlays, mustPass } from '../src/legal.js';
import { gameWith } from './helpers.js';

const idsOf = (plays: readonly { readonly cards: readonly { readonly id: string }[] }[]) =>
  plays.map((legal) => legal.cards.map((card) => card.id).join(',')).sort();

describe('合法手の列挙（場が空）', () => {
  const state = () =>
    gameWith({
      hands: { 0: ['S5a', 'S5b', 'S6a', 'JK1'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });

  it('同ランク出しと階段の代表手を列挙する', () => {
    expect(idsOf(getLegalPlays(state(), 0))).toEqual([
      'JK1',
      'S5a',
      'S5a,JK1',
      'S5a,S5b',
      'S5a,S5b,JK1',
      'S5a,S6a,JK1',
      'S6a',
      'S6a,JK1',
    ]);
  });

  it('場が空のときパスは含まれない', () => {
    expect(getLegalActions(state(), 0).some((action) => action.type === 'pass')).toBe(false);
  });

  it('階段はジョーカーで隙間を埋めた形で出てくる', () => {
    const plays = getLegalPlays(state(), 0);
    const sequence = plays.find((legal) => legal.play.kind === 'sequence');
    expect(sequence?.cards.map((card) => card.id)).toEqual(['S5a', 'S6a', 'JK1']);
    // ♠5 ♠6 ＋JK の最強解釈は 5-6-7。
    expect(sequence?.play.value).toBe(5);
  });
});

describe('合法手の列挙（場にカードがある）', () => {
  it('同じ種類・同じ枚数で上回る手だけを列挙し、パスを含む', () => {
    const state = gameWith({
      hands: { 0: ['S5a', 'S5b', 'S6a', 'JK1'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['S4a', 'H4a'], leader: 3 },
      turn: 0,
    });

    expect(idsOf(getLegalPlays(state, 0))).toEqual(['S5a,JK1', 'S5a,S5b', 'S6a,JK1']);
    const actions = getLegalActions(state, 0);
    expect(actions).toHaveLength(4);
    expect(actions.some((action) => action.type === 'pass')).toBe(true);
  });

  it('場が階段なら階段しか出せない', () => {
    const state = gameWith({
      hands: { 0: ['S5a', 'S6a', 'S7a', 'H9a', 'H9b'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['C3a', 'C4a', 'C5a'], leader: 3 },
      turn: 0,
    });
    const plays = getLegalPlays(state, 0);
    expect(plays.every((legal) => legal.play.kind === 'sequence')).toBe(true);
    expect(idsOf(plays)).toEqual(['S5a,S6a,S7a']);
  });

  it('縛り中は縛りスートを満たす手だけを列挙する', () => {
    const state = gameWith({
      hands: { 0: ['S5a', 'S5b', 'H6a', 'JK1'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['S4a', 'H4a'], leader: 3 },
      lockedSuit: 'H',
      turn: 0,
    });
    expect(idsOf(getLegalPlays(state, 0))).toEqual(['H6a,JK1']);
  });

  it('シングルのジョーカーに対してスペ3返しが候補に入る', () => {
    const state = gameWith({
      hands: { 0: ['S3a', 'D5a'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['JK1'], leader: 3 },
      turn: 0,
    });
    const plays = getLegalPlays(state, 0);
    expect(idsOf(plays)).toEqual(['S3a']);
    expect(plays[0]?.spade3Return).toBe(true);
  });
});

describe('合法手の列挙（対象外）', () => {
  it('手番でなければ行動は空', () => {
    const state = gameWith({
      hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 1,
    });
    expect(getLegalActions(state, 0)).toEqual([]);
    // 出せる手の列挙そのものは手番を見ない。
    expect(getLegalPlays(state, 0)).not.toEqual([]);
  });

  it('退場済み・パス済みの席は出せる手がない', () => {
    const finishedState = gameWith({
      hands: { 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      finished: [0],
      turn: 1,
    });
    expect(getLegalPlays(finishedState, 0)).toEqual([]);

    const passedState = gameWith({
      hands: { 0: ['S9a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['C4a'], leader: 3 },
      passed: [0],
      turn: 1,
    });
    expect(getLegalPlays(passedState, 0)).toEqual([]);
  });
});

describe('自動パスの判定', () => {
  it('出せる手が1つも無ければ mustPass が true', () => {
    const state = gameWith({
      hands: { 0: ['S4a', 'S5a'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['C2a'], leader: 3 },
      turn: 0,
    });
    expect(getLegalPlays(state, 0)).toEqual([]);
    expect(mustPass(state, 0)).toBe(true);
  });

  it('出せる手があれば false', () => {
    const state = gameWith({
      hands: { 0: ['S4a', 'JK1'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['C2a'], leader: 3 },
      turn: 0,
    });
    expect(mustPass(state, 0)).toBe(false);
  });

  it('場が空のときとパスできない場面では false（パスは選べない）', () => {
    const lead = gameWith({
      hands: { 0: ['S4a'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      turn: 0,
    });
    expect(mustPass(lead, 0)).toBe(false);

    const notMyTurn = gameWith({
      hands: { 0: ['S4a'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['C2a'], leader: 3 },
      turn: 1,
    });
    expect(mustPass(notMyTurn, 0)).toBe(false);
  });
});

describe('反則上がりの注記', () => {
  it('その手で上がると反則上がりになる手には理由が付く', () => {
    const state = gameWith({
      hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    const plays = getLegalPlays(state, 0);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.illegalFinish).toBe('two');
  });

  it('手札が残る手には理由が付かない', () => {
    const state = gameWith({
      hands: { 0: ['S2a', 'S9a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    const two = getLegalPlays(state, 0).find((legal) => legal.cards[0]?.id === 'S2a');
    expect(two?.illegalFinish).toBeUndefined();
  });
});

describe('列挙した手はすべて実際に出せる', () => {
  const states = [
    gameWith({
      hands: { 0: ['S5a', 'S5b', 'S6a', 'S7a', 'JK1', 'JK2'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    }),
    gameWith({
      hands: { 0: ['S5a', 'S5b', 'S6a', 'JK1'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['S4a', 'H4a'], leader: 3 },
      turn: 0,
    }),
    gameWith({
      hands: { 0: ['S3a', 'S4a', 'S5a', 'JK1'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['JK2'], leader: 3 },
      turn: 0,
    }),
    gameWith({
      hands: { 0: ['S5a', 'S5b', 'H6a', 'JK1'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      field: { ids: ['S4a', 'H4a'], leader: 3 },
      lockedSuit: 'H',
      turn: 0,
    }),
    gameWith({
      hands: { 0: ['S3a', 'S4a', 'S5a', 'S6a'], 1: ['H7a'], 2: ['H8a'], 3: ['HQa'] },
      revolution: true,
      turn: 0,
    }),
  ];

  it('applyAction がすべて成功する', () => {
    for (const state of states) {
      const actions = getLegalActions(state, 0);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(
            `列挙した手が出せない：${JSON.stringify(action)} → ${JSON.stringify(result.error)}`,
          );
        }
      }
    }
  });
});
