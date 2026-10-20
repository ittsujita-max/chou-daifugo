import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG, handSize } from '../src/config.js';
import type { GameAction, GameError, GameState } from '../src/game.js';
import { applyAction, createGame, getPlayerView } from '../src/game.js';
import type { Result } from '../src/result.js';
import { PLAYER_INDEXES } from '../src/types.js';
import type { GameOptions } from './helpers.js';
import { cards, gameWith } from './helpers.js';

const step = (state: GameState, action: GameAction): GameState => {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`行動できない：${JSON.stringify(result.error)}`);
  return result.value;
};

const failure = (result: Result<GameState, GameError>): GameError => {
  if (result.ok) throw new Error('エラーになるはずが成功した');
  return result.error;
};

const codeOf = (result: Result<GameState, GameError>): string => failure(result).code;

const playOf = (seat: 0 | 1 | 2 | 3, ...ids: readonly string[]): GameAction => ({
  type: 'play',
  seat,
  cards: cards(...ids),
});

const pass = (seat: 0 | 1 | 2 | 3): GameAction => ({ type: 'pass', seat });

describe('ゲームの開始', () => {
  it('4人に手札を配り、指定した席がスターターになる', () => {
    const created = createGame(DEFAULT_RULE_CONFIG, 1234, { starter: 2 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const state = created.value;

    for (const seat of PLAYER_INDEXES) {
      expect(state.players[seat].hand).toHaveLength(handSize(DEFAULT_RULE_CONFIG));
      expect(state.players[seat].passed).toBe(false);
      expect(state.players[seat].finished).toBe(false);
    }
    expect(state.turn).toBe(2);
    expect(state.field).toBeUndefined();
    expect(state.lockedSuit).toBeUndefined();
    expect(state.revolution).toBe(false);
    expect(state.phase).toBe('playing');
  });

  it('同じシードなら同じ初期状態になる', () => {
    const a = createGame(DEFAULT_RULE_CONFIG, 99);
    const b = createGame(DEFAULT_RULE_CONFIG, 99);
    expect(a).toEqual(b);
  });
});

describe('2.5 手番とパス', () => {
  const base = () =>
    gameWith({
      hands: { 0: ['S9a', 'SJa'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['C4a'], leader: 0 },
      turn: 1,
    });

  it('手番でない席は行動できない', () => {
    expect(codeOf(applyAction(base(), pass(2)))).toBe('notYourTurn');
  });

  it('場が空のときの先手はパスできない', () => {
    const lead = gameWith({ hands: { 0: ['S9a'] }, turn: 0 });
    expect(codeOf(applyAction(lead, pass(0)))).toBe('cannotPassAsStarter');
  });

  it('手札にないカードは出せない', () => {
    expect(codeOf(applyAction(base(), playOf(1, 'D10a')))).toBe('cardsNotInHand');
  });

  it('リード以外のアクティブプレイヤー全員がパスしたら場が流れ、リードがスターター', () => {
    let state = base();
    state = step(state, pass(1));
    expect(state.turn).toBe(2);
    state = step(state, pass(2));
    expect(state.turn).toBe(3);
    state = step(state, pass(3));

    expect(state.field).toBeUndefined();
    expect(state.lastFlush).toBe('allPassed');
    expect(state.turn).toBe(0);
    for (const seat of PLAYER_INDEXES) {
      expect(state.players[seat].passed).toBe(false);
    }
  });

  it('一度パスしたら、その場が流れるまで手番が回らない', () => {
    let state = base();
    state = step(state, pass(1));
    state = step(state, playOf(2, 'H7a'));
    expect(state.turn).toBe(3);
    state = step(state, playOf(3, 'HQa'));
    // 1 はパス済みなので飛ばされる。
    expect(state.turn).toBe(0);
    expect(state.players[1].passed).toBe(true);
  });

  it('リードが退場済みなら、左隣から最初のアクティブプレイヤーがスターター', () => {
    let state = gameWith({
      hands: { 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      finished: [0],
      field: { ids: ['C4a'], leader: 0 },
      turn: 1,
    });
    state = step(state, pass(1));
    state = step(state, pass(2));
    state = step(state, pass(3));

    expect(state.field).toBeUndefined();
    expect(state.lastFlush).toBe('allPassed');
    expect(state.turn).toBe(1);
  });
});

describe('2.5 即流し', () => {
  it('ジョーカー2枚のペアを出すと場が流れる', () => {
    const state = step(
      gameWith({
        hands: { 0: ['JK1', 'JK2', 'D9a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
        turn: 0,
      }),
      playOf(0, 'JK1', 'JK2'),
    );
    expect(state.lastFlush).toBe('unbeatable');
    expect(state.field).toBeUndefined();
    expect(state.turn).toBe(0);
  });

  it('上回れる手がある出しでは流れない', () => {
    const state = step(
      gameWith({
        hands: { 0: ['S2a', 'H2a', 'D9a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
        turn: 0,
      }),
      playOf(0, 'S2a', 'H2a'),
    );
    expect(state.lastFlush).toBeUndefined();
    expect(state.field?.play.count).toBe(2);
    expect(state.turn).toBe(1);
  });
});

describe('2.6 8切り', () => {
  const hands = { 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] };

  it('8だけの出しで場が流れ、出した人がスターター', () => {
    const state = step(
      gameWith({ hands: { ...hands, 0: ['S8a', 'S9a'] }, turn: 0 }),
      playOf(0, 'S8a'),
    );
    expect(state.lastFlush).toBe('eightCut');
    expect(state.field).toBeUndefined();
    expect(state.turn).toBe(0);
  });

  it('ジョーカーで8を補った出しでも発動する', () => {
    const state = step(
      gameWith({ hands: { ...hands, 0: ['S8a', 'JK1', 'D4a'] }, turn: 0 }),
      playOf(0, 'S8a', 'JK1'),
    );
    expect(state.lastFlush).toBe('eightCut');
  });

  it('8を含む階段では発動しない', () => {
    const state = step(
      gameWith({ hands: { ...hands, 0: ['S7a', 'S8a', 'S9a', 'D4a'] }, turn: 0 }),
      playOf(0, 'S7a', 'S8a', 'S9a'),
    );
    expect(state.lastFlush).toBeUndefined();
    expect(state.field?.play.kind).toBe('sequence');
    expect(state.turn).toBe(1);
  });

  it('8切りを切ると発動しない', () => {
    const state = step(
      gameWith({
        hands: { ...hands, 0: ['S8a', 'S9a'] },
        turn: 0,
        config: { ...DEFAULT_RULE_CONFIG, eightCut: false },
      }),
      playOf(0, 'S8a'),
    );
    expect(state.lastFlush).toBeUndefined();
    expect(state.field?.play.value).toBe(8);
  });
});

describe('2.6 スペ3返し', () => {
  const base = (overrides: Partial<GameOptions> = {}) =>
    gameWith({
      hands: { 1: ['S3a', 'D5a'], 2: ['H7a'], 3: ['HQa'] },
      field: { ids: ['JK1'], leader: 0 },
      turn: 1,
      ...overrides,
    });

  it('シングルのジョーカーに♠3を出すと場が流れ、出した人がスターター', () => {
    const state = step(base({ hands: { 1: ['S3a', 'D5a'] } }), playOf(1, 'S3a'));
    expect(state.lastFlush).toBe('spade3Return');
    expect(state.field).toBeUndefined();
    expect(state.turn).toBe(1);
  });

  it('♠3は2枚あるのでどちらでも返せる', () => {
    const state = step(base({ hands: { 1: ['S3b', 'D5a'] } }), playOf(1, 'S3b'));
    expect(state.lastFlush).toBe('spade3Return');
  });

  it('縛り中でも有効', () => {
    const state = step(base({ lockedSuit: 'H' }), playOf(1, 'S3a'));
    expect(state.lastFlush).toBe('spade3Return');
    expect(state.lockedSuit).toBeUndefined();
  });

  it('革命中でも有効', () => {
    const state = step(base({ revolution: true }), playOf(1, 'S3a'));
    expect(state.lastFlush).toBe('spade3Return');
  });

  it('シングルのジョーカー以外には♠3単体で返せない', () => {
    const state = base({ field: { ids: ['C4a'], leader: 0 } });
    const error = failure(applyAction(state, playOf(1, 'S3a')));
    expect(error.code).toBe('illegalPlay');
    if (error.code === 'illegalPlay') expect(error.error.code).toBe('notStrongEnough');
  });

  it('スペ3返しを切ると通常の強さ判定になる', () => {
    const state = base({ config: { ...DEFAULT_RULE_CONFIG, spade3Return: false } });
    const error = failure(applyAction(state, playOf(1, 'S3a')));
    expect(error.code).toBe('illegalPlay');
    if (error.code === 'illegalPlay') expect(error.error.code).toBe('notStrongEnough');
  });
});

describe('2.6 革命', () => {
  const five5 = ['S5a', 'S5b', 'H5a', 'H5b', 'D5a'] as const;
  const five6 = ['S6a', 'S6b', 'H6a', 'H6b', 'D6a'] as const;
  const five4 = ['S4a', 'S4b', 'H4a', 'H4b', 'D4a'] as const;

  const revolutionGame = () =>
    gameWith({
      hands: {
        0: [...five5, 'C7a'],
        1: [...five6, ...five4],
        2: ['H7a'],
        3: ['HQa'],
      },
      turn: 0,
    });

  it('同ランク5枚で強弱が反転し、場の強さも反転後で読み直される', () => {
    const state = step(revolutionGame(), playOf(0, ...five5));
    expect(state.revolution).toBe(true);
    expect(state.lastFlush).toBeUndefined();
    // 革命中の5の強さは 18 - 5 = 13。
    expect(state.field?.play.value).toBe(13);
    expect(state.turn).toBe(1);
  });

  it('革命後は反転した強さで比較される', () => {
    const state = step(revolutionGame(), playOf(0, ...five5));
    // 6は革命中は5より弱い。
    const weaker = failure(applyAction(state, playOf(1, ...five6)));
    expect(weaker.code).toBe('illegalPlay');
    if (weaker.code === 'illegalPlay') expect(weaker.error.code).toBe('notStrongEnough');
    // 4は革命中は5より強い。
    expect(applyAction(state, playOf(1, ...five4)).ok).toBe(true);
  });

  it('革命中に再度成立すると戻る（革命返し）', () => {
    let state = step(revolutionGame(), playOf(0, ...five5));
    state = step(state, playOf(1, ...five4));
    expect(state.revolution).toBe(false);
    // 通常時に戻るので4の強さは4。
    expect(state.field?.play.value).toBe(4);
  });

  it('成立枚数に足りない同ランク出しでは革命しない', () => {
    const state = step(revolutionGame(), playOf(0, 'S5a', 'S5b', 'H5a', 'H5b'));
    expect(state.revolution).toBe(false);
    expect(state.field?.play.count).toBe(4);
  });

  it('階段5枚では革命しない', () => {
    const state = step(
      gameWith({
        hands: {
          0: ['S5a', 'S6a', 'S7a', 'S8a', 'S9a', 'DJa'],
          1: ['H6a'],
          2: ['H7a'],
          3: ['HQa'],
        },
        turn: 0,
      }),
      playOf(0, 'S5a', 'S6a', 'S7a', 'S8a', 'S9a'),
    );
    expect(state.revolution).toBe(false);
    expect(state.field?.play.kind).toBe('sequence');
  });
});

describe('2.6 縛り', () => {
  it('同じスートの出しが続くと成立する', () => {
    let state = gameWith({
      hands: { 0: ['S5a', 'D9a'], 1: ['S6a', 'D10a'], 2: ['H7a', 'SJa'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a'));
    expect(state.lockedSuit).toBeUndefined();
    state = step(state, playOf(1, 'S6a'));
    expect(state.lockedSuit).toBe('S');
  });

  it('縛り中は縛りスート以外を出せない', () => {
    let state = gameWith({
      hands: { 0: ['S5a', 'D9a'], 1: ['S6a', 'D10a'], 2: ['H7a', 'SJa'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'S6a'));

    const error = failure(applyAction(state, playOf(2, 'H7a')));
    expect(error.code).toBe('suitLocked');
    if (error.code === 'suitLocked') expect(error.suit).toBe('S');
    expect(applyAction(state, playOf(2, 'SJa')).ok).toBe(true);
  });

  it('ジョーカーは縛りスートの代わりに使え、縛りは維持される', () => {
    let state = gameWith({
      hands: { 0: ['S5a', 'D9a'], 1: ['S6a', 'D10a'], 2: ['JK1', 'H7a'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'S6a'));
    state = step(state, playOf(2, 'JK1'));

    expect(state.lastFlush).toBeUndefined();
    expect(state.lockedSuit).toBe('S');
    expect(state.field?.play.jokerCount).toBe(1);
  });

  it('ジョーカーを含む出しでは縛りを新たに発生させられない', () => {
    let state = gameWith({
      hands: { 0: ['S5a', 'S5b', 'D9a'], 1: ['S6a', 'JK1', 'D10a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a', 'S5b'));
    state = step(state, playOf(1, 'S6a', 'JK1'));
    expect(state.lockedSuit).toBeUndefined();
  });

  it('縛りは場流しで解除される', () => {
    let state = gameWith({
      hands: { 0: ['S5a', 'D9a'], 1: ['S6a', 'D10a'], 2: ['H7a'], 3: ['HQa'] },
      turn: 0,
    });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'S6a'));
    expect(state.lockedSuit).toBe('S');

    state = step(state, pass(2));
    state = step(state, pass(3));
    state = step(state, pass(0));
    expect(state.lastFlush).toBe('allPassed');
    expect(state.lockedSuit).toBeUndefined();
  });

  it('革命では解除されない', () => {
    // 縛り中に5枚の同ランク出しを作るには、縛りスート2枚＋ジョーカー3枚になる。
    const state = step(
      gameWith({
        hands: {
          2: ['S6a', 'S6b', 'JK1', 'JK2', 'JK3', 'D9a'],
          0: ['H7a'],
          1: ['HQa'],
          3: ['HKa'],
        },
        field: { ids: ['S5a', 'S5b', 'C5a', 'C5b', 'H5a'], leader: 1 },
        lockedSuit: 'S',
        turn: 2,
      }),
      playOf(2, 'S6a', 'S6b', 'JK1', 'JK2', 'JK3'),
    );
    expect(state.revolution).toBe(true);
    expect(state.lockedSuit).toBe('S');
    expect(state.lastFlush).toBeUndefined();
  });
});

describe('上がりとゲーム終了', () => {
  it('手札を出し切ると退場し、上がり順に入る', () => {
    const state = step(
      gameWith({ hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] }, turn: 0 }),
      playOf(0, 'S5a'),
    );
    expect(state.players[0].finished).toBe(true);
    expect(state.finishOrder).toEqual([0]);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(1);
  });

  it('残り1人になったらゲームが終わり、最後の1人が順位の末尾に入る', () => {
    let state = gameWith({ hands: { 0: ['S5a'], 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] }, turn: 0 });
    state = step(state, playOf(0, 'S5a'));
    state = step(state, playOf(1, 'H6a'));
    state = step(state, playOf(2, 'H7a'));

    expect(state.phase).toBe('finished');
    expect(state.finishOrder).toEqual([0, 1, 2]);
    expect(state.ranking).toEqual([0, 1, 2, 3]);
    expect(state.players[3].finished).toBe(true);
    expect(state.field).toBeUndefined();
    expect(codeOf(applyAction(state, playOf(3, 'HQa')))).toBe('gameFinished');
  });

  it('退場した席は行動できない', () => {
    const state = gameWith({
      hands: { 1: ['H6a'], 2: ['H7a'], 3: ['HQa'] },
      finished: [0],
      turn: 0,
    });
    expect(codeOf(applyAction(state, pass(0)))).toBe('playerFinished');
  });
});

describe('プレイヤーごとの可視情報', () => {
  it('相手の手札は含めず、残り枚数だけを返す', () => {
    const state = gameWith({
      hands: { 0: ['S5a', 'S6a'], 1: ['H6a'], 2: ['H7a', 'H8a', 'H9a'], 3: ['HQa'] },
      turn: 0,
    });
    const view = getPlayerView(state, 0);

    expect(view.hand.map((item) => item.id)).toEqual(['S5a', 'S6a']);
    expect(view.opponents.map((opponent) => [opponent.seat, opponent.handCount])).toEqual([
      [1, 1],
      [2, 3],
      [3, 1],
    ]);
    expect(JSON.stringify(view)).not.toContain('H7a');
  });
});
