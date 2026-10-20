import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { GameAction, GameState } from '../src/game.js';
import { applyAction, classOf, classesOf } from '../src/game.js';
import { checkIllegalFinish } from '../src/play.js';
import { PLAYER_INDEXES } from '../src/types.js';
import { cards, ctx, gameWith, makePlay } from './helpers.js';

const step = (state: GameState, action: GameAction): GameState => {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`行動できない：${JSON.stringify(result.error)}`);
  return result.value;
};

const playOf = (seat: 0 | 1 | 2 | 3, ...ids: readonly string[]): GameAction => ({
  type: 'play',
  seat,
  cards: cards(...ids),
});

const pass = (seat: 0 | 1 | 2 | 3): GameAction => ({ type: 'pass', seat });

/** 最終手だけを持った席0と、普通の手札を持った他3人。 */
const lastHand = (ids: readonly string[], revolution = false) =>
  gameWith({
    hands: { 0: ids, 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
    turn: 0,
    revolution,
  });

describe('2.7 反則上がりの判定', () => {
  it('通常時は2を含む最終手が反則上がり', () => {
    expect(checkIllegalFinish(makePlay(['S2a']), ctx())).toBe('two');
    expect(checkIllegalFinish(makePlay(['S2a', 'H2a']), ctx())).toBe('two');
    expect(checkIllegalFinish(makePlay(['S5a']), ctx())).toBeUndefined();
  });

  it('革命時は3を含む最終手が反則上がりで、2は反則にならない', () => {
    expect(checkIllegalFinish(makePlay(['S3a'], { revolution: true }), ctx(true))).toBe('three');
    expect(checkIllegalFinish(makePlay(['S2a'], { revolution: true }), ctx(true))).toBeUndefined();
  });

  it('8切りが成立する最終手は反則上がり', () => {
    expect(checkIllegalFinish(makePlay(['S8a']), ctx())).toBe('eightCut');
    expect(checkIllegalFinish(makePlay(['S8a', 'H8a']), ctx())).toBe('eightCut');
    // 8を含む階段では8切りが成立しないので反則にならない。
    expect(checkIllegalFinish(makePlay(['S7a', 'S8a', 'S9a']), ctx())).toBeUndefined();
  });

  it('ジョーカーを1枚でも含む最終手は反則上がり', () => {
    expect(checkIllegalFinish(makePlay(['JK1']), ctx())).toBe('joker');
    expect(checkIllegalFinish(makePlay(['S5a', 'JK1']), ctx())).toBe('joker');
  });

  it('♠3を1枚だけ出す最終手は反則上がり。2枚出しなら反則ではない', () => {
    expect(checkIllegalFinish(makePlay(['S3a']), ctx())).toBe('spade3Single');
    expect(checkIllegalFinish(makePlay(['S3a', 'S3b']), ctx())).toBeUndefined();
    // ♠以外の3の単体は反則ではない。
    expect(checkIllegalFinish(makePlay(['H3a']), ctx())).toBeUndefined();
  });

  it('その手で革命が起きても判定は出す直前の状態で行う', () => {
    // 通常時に2を5枚＝革命が起きるが、判定は通常時なので「2を含む」で反則。
    const play = makePlay(['S2a', 'S2b', 'H2a', 'H2b', 'D2a']);
    expect(checkIllegalFinish(play, ctx(false))).toBe('two');
  });
});

describe('2.7 反則上がりの処理', () => {
  it('反則上がりは上がり順に入らず、反則上がり順に入る', () => {
    const state = step(lastHand(['S2a']), playOf(0, 'S2a'));
    expect(state.players[0].finished).toBe(true);
    expect(state.finishOrder).toEqual([]);
    expect(state.illegalFinishOrder).toEqual([0]);
    expect(state.phase).toBe('playing');
  });

  it('反則上がりの手でも場流しは発生する', () => {
    const state = step(lastHand(['S8a']), playOf(0, 'S8a'));
    expect(state.illegalFinishOrder).toEqual([0]);
    expect(state.lastFlush).toBe('eightCut');
    expect(state.field).toBeUndefined();
    // リードは退場済みなので左隣から。
    expect(state.turn).toBe(1);
  });

  it('反則上がりの手でも革命は発生する', () => {
    const twos = ['S2a', 'S2b', 'H2a', 'H2b', 'D2a'] as const;
    const state = step(lastHand([...twos]), playOf(0, ...twos));
    expect(state.illegalFinishOrder).toEqual([0]);
    expect(state.revolution).toBe(true);
  });

  it('革命時に2で上がるのは有効な上がり', () => {
    const state = step(lastHand(['S2a'], true), playOf(0, 'S2a'));
    expect(state.finishOrder).toEqual([0]);
    expect(state.illegalFinishOrder).toEqual([]);
  });

  it('反則上がりの1人目は大貧民になる', () => {
    let state = gameWith({
      hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S2a'));
    // 場に2が残るので誰も上回れない。
    state = step(state, pass(1));
    state = step(state, pass(2));
    state = step(state, pass(3));
    expect(state.turn).toBe(1);

    state = step(state, playOf(1, 'H6a'));
    state = step(state, playOf(2, 'H7a'));

    expect(state.phase).toBe('finished');
    expect(state.ranking).toEqual([1, 2, 3, 0]);
    expect(classOf(state.ranking ?? [], 0)).toBe('daihinmin');
    expect(classOf(state.ranking ?? [], 1)).toBe('daifugo');
  });
});

describe('2.8 都落ち', () => {
  it('他の誰かが最初に有効に上がった時点で前ゲームの大富豪が退場する', () => {
    const state = step(
      gameWith({
        hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a', 'H9a'], 3: ['HQa'] },
        turn: 0,
        previousTopSeat: 2,
      }),
      playOf(0, 'S5a'),
    );
    expect(state.finishOrder).toEqual([0]);
    expect(state.fallenSeat).toBe(2);
    expect(state.players[2].finished).toBe(true);
    expect(state.players[2].hand).toHaveLength(2);
    expect(state.phase).toBe('playing');
  });

  it('都落ちは大貧民。反則上がりがいなければ最下位', () => {
    let state = gameWith({
      hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a', 'H9a'], 3: ['HQa'] },
      turn: 0,
      previousTopSeat: 2,
    });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'H6a'));

    expect(state.phase).toBe('finished');
    expect(state.ranking).toEqual([0, 1, 3, 2]);
    expect(classOf(state.ranking ?? [], 2)).toBe('daihinmin');
  });

  it('反則上がりは都落ちの引き金にならない', () => {
    const state = step(
      gameWith({
        hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a', 'H9a'], 3: ['HQa'] },
        turn: 0,
        previousTopSeat: 2,
      }),
      playOf(0, 'S2a'),
    );
    expect(state.illegalFinishOrder).toEqual([0]);
    expect(state.fallenSeat).toBeUndefined();
    expect(state.players[2].finished).toBe(false);
  });

  it('都落ちと反則上がりが両方いると、反則上がりが下位で都落ちが繰り上がる', () => {
    let state = gameWith({
      hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a', 'H10a'], 3: ['HQa', 'HKa'] },
      turn: 0,
      previousTopSeat: 3,
    });
    state = step(state, playOf(0, 'S2a'));
    state = step(state, pass(1));
    state = step(state, pass(2));
    state = step(state, pass(3));
    state = step(state, playOf(1, 'H6a'));

    expect(state.fallenSeat).toBe(3);
    expect(state.phase).toBe('finished');
    // 1 が大富豪、2 が富豪、都落ちの3 が貧民、反則上がりの0 が大貧民。
    expect(state.ranking).toEqual([1, 2, 3, 0]);
    expect(classesOf(state)).toEqual({
      0: 'daihinmin',
      1: 'daifugo',
      2: 'fugo',
      3: 'hinmin',
    });
  });

  it('前ゲームの大富豪自身が反則上がりしたら、都落ちではなく反則上がりとして扱う', () => {
    const state = step(
      gameWith({
        hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
        turn: 0,
        previousTopSeat: 0,
      }),
      playOf(0, 'S2a'),
    );
    expect(state.illegalFinishOrder).toEqual([0]);
    expect(state.fallenSeat).toBeUndefined();
  });

  it('前ゲームの大富豪が最初に有効に上がれば都落ちしない', () => {
    const state = step(
      gameWith({
        hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
        turn: 0,
        previousTopSeat: 0,
      }),
      playOf(0, 'S5a'),
    );
    expect(state.finishOrder).toEqual([0]);
    expect(state.fallenSeat).toBeUndefined();
  });
});

describe('2.8 順位', () => {
  it('有効に上がった順に上位から確定する', () => {
    let state = gameWith({
      hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'H6a'));
    state = step(state, playOf(2, 'H7a'));

    expect(state.ranking).toEqual([0, 1, 2, 3]);
    expect(classesOf(state)).toEqual({
      0: 'daifugo',
      1: 'fugo',
      2: 'hinmin',
      3: 'daihinmin',
    });
  });

  it('決着するまで順位は確定しない', () => {
    const state = gameWith({ hands: { 0: ['S5a', 'S6a'] }, turn: 0 });
    expect(state.ranking).toBeUndefined();
    expect(classesOf(state)).toBeUndefined();
  });

  it('順位は4人が1回ずつ現れる', () => {
    let state = gameWith({
      hands: { 0: ['S2a'], 1: ['H6a'], 2: ['H7a', 'H10a'], 3: ['HQa', 'HKa'] },
      turn: 0,
      previousTopSeat: 3,
    });
    state = step(state, playOf(0, 'S2a'));
    state = step(state, pass(1));
    state = step(state, pass(2));
    state = step(state, pass(3));
    state = step(state, playOf(1, 'H6a'));

    const ranking = state.ranking ?? [];
    expect(ranking).toHaveLength(PLAYER_INDEXES.length);
    expect([...ranking].sort()).toEqual([...PLAYER_INDEXES]);
  });
});

describe('ルール設定の既定値との整合', () => {
  it('8切りを切ると8での上がりは反則上がりにならない', () => {
    const noEightCut = { ...DEFAULT_RULE_CONFIG, eightCut: false };
    expect(
      checkIllegalFinish(makePlay(['S8a'], { config: noEightCut }), {
        config: noEightCut,
        revolution: false,
      }),
    ).toBeUndefined();
  });
});
