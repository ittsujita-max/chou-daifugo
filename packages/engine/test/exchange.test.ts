import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG, handSize } from '../src/config.js';
import {
  defaultExchangeCards,
  exchangePairs,
  forcedExchangeCards,
  swapHands,
} from '../src/exchange.js';
import type { GameState } from '../src/game.js';
import { applyAction, createGame, getPlayerView } from '../src/game.js';
import { getLegalActions } from '../src/legal.js';
import type { Card, PlayerIndex } from '../src/types.js';
import { PLAYER_INDEXES } from '../src/types.js';
import { cards, gameWith } from './helpers.js';

const ids = (list: readonly Card[]) => list.map((card) => card.id);

const started = (): GameState => {
  const created = createGame(DEFAULT_RULE_CONFIG, 12345, { previousRanking: [0, 1, 2, 3] });
  if (!created.ok) throw new Error('配札に失敗');
  return created.value;
};

const step = (state: GameState, seat: PlayerIndex, give: readonly Card[]): GameState => {
  const result = applyAction(state, { type: 'exchange', seat, cards: give });
  if (!result.ok) throw new Error(`交換できない：${JSON.stringify(result.error)}`);
  return result.value;
};

describe('2.9 交換の組と渡すカード', () => {
  it('大富豪⇔大貧民が3枚、富豪⇔貧民が2枚', () => {
    expect(exchangePairs([2, 0, 3, 1], DEFAULT_RULE_CONFIG)).toEqual([
      { upper: 2, lower: 1, count: 3 },
      { upper: 0, lower: 3, count: 2 },
    ]);
  });

  it('枚数0の設定なら組を作らない', () => {
    const noExchange = { ...DEFAULT_RULE_CONFIG, exchange: { top: 0, second: 0 } };
    expect(exchangePairs([0, 1, 2, 3], noExchange)).toEqual([]);
  });

  it('下位者は強い順に渡す（JK＞2＞A＞K…）', () => {
    const hand = cards('S5a', 'D2a', 'JK1', 'CKa', 'HAa');
    expect(ids(forcedExchangeCards(hand, 3))).toEqual(['JK1', 'D2a', 'HAa']);
  });

  it('上位者の既定の選択は弱い順', () => {
    const hand = cards('S5a', 'D2a', 'JK1', 'CKa', 'HAa');
    expect(ids(defaultExchangeCards(hand, 2))).toEqual(['S5a', 'CKa']);
  });

  it('革命中でも交換は通常時の強さ順で決まる', () => {
    // 交換はゲーム開始時なので革命は解除済み（spec 2.9）。3は最弱のまま。
    const hand = cards('S3a', 'D2a', 'H7a');
    expect(ids(forcedExchangeCards(hand, 1))).toEqual(['D2a']);
  });

  it('swapHands は枚数を変えず、渡したカードが相手に移る', () => {
    const hands = {
      0: cards('S5a', 'S6a', 'S7a', 'S8a'),
      1: cards('H5a', 'H6a'),
      2: cards('D5a', 'D6a'),
      3: cards('C2a', 'CAa', 'CKa', 'C4a'),
    } as Record<PlayerIndex, readonly Card[]>;

    const swapped = swapHands(
      hands,
      [
        { upper: 0, lower: 3, count: 2 },
        { upper: 1, lower: 2, count: 1 },
      ],
      [
        { upper: 0, cards: cards('S5a', 'S6a') },
        { upper: 1, cards: cards('H5a') },
      ],
    );

    for (const seat of PLAYER_INDEXES) {
      expect(swapped[seat]).toHaveLength(hands[seat].length);
    }
    // 大貧民の強い2枚（♣2・♣A）が大富豪に渡る。
    expect(ids(swapped[0])).toContain('C2a');
    expect(ids(swapped[0])).toContain('CAa');
    expect(ids(swapped[0])).not.toContain('S5a');
    expect(ids(swapped[3])).toContain('S5a');
    expect(ids(swapped[3])).not.toContain('C2a');
    // 富豪⇔貧民は1枚。貧民が渡すのは強い方の♦6。
    expect(ids(swapped[1])).toContain('D6a');
    expect(ids(swapped[1])).not.toContain('H5a');
    expect(ids(swapped[2])).toContain('H5a');
    expect(ids(swapped[2])).not.toContain('D6a');
  });
});

describe('2.9 交換フェーズ', () => {
  it('前ゲームの順位を渡すと交換から始まる', () => {
    const state = started();
    expect(state.phase).toBe('exchange');
    expect(state.exchange?.pairs).toEqual([
      { upper: 0, lower: 3, count: 3 },
      { upper: 1, lower: 2, count: 2 },
    ]);
    expect(state.previousTopSeat).toBe(0);
  });

  it('セット最初のゲーム（前ゲームの順位なし）は交換なし', () => {
    const created = createGame(DEFAULT_RULE_CONFIG, 12345);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.phase).toBe('playing');
    expect(created.value.exchange).toBeUndefined();
  });

  it('交換が終わるまで誰も出せない', () => {
    const state = started();
    const result = applyAction(state, {
      type: 'play',
      seat: state.turn,
      cards: [state.players[state.turn].hand[0]!],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inExchange');
  });

  it('下位者は提出できない', () => {
    const state = started();
    const result = applyAction(state, {
      type: 'exchange',
      seat: 3,
      cards: state.players[3].hand.slice(0, 3),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('exchangeNotYours');
  });

  it('枚数が違う提出・手札にないカード・二重提出を弾く', () => {
    const state = started();

    const wrongCount = applyAction(state, {
      type: 'exchange',
      seat: 0,
      cards: state.players[0].hand.slice(0, 2),
    });
    expect(wrongCount.ok).toBe(false);
    if (!wrongCount.ok) expect(wrongCount.error.code).toBe('wrongExchangeCount');

    const notMine = applyAction(state, {
      type: 'exchange',
      seat: 0,
      cards: state.players[3].hand.slice(0, 3),
    });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.code).toBe('cardsNotInHand');

    const once = step(state, 0, state.players[0].hand.slice(0, 3));
    const twice = applyAction(once, {
      type: 'exchange',
      seat: 0,
      cards: once.players[0].hand.slice(0, 3),
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe('alreadySubmitted');
  });

  it('同じカードを2枚含む提出を弾く', () => {
    const state = started();
    const card = state.players[0].hand[0]!;
    const result = applyAction(state, { type: 'exchange', seat: 0, cards: [card, card, card] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicateCards');
  });

  it('全組そろうと同時交換が実行され、出せるようになる', () => {
    const before = started();
    const fromTop = before.players[0].hand.slice(0, 3);
    const fromSecond = before.players[1].hand.slice(0, 2);
    const fromBottom = forcedExchangeCards(before.players[3].hand, 3);
    const fromThird = forcedExchangeCards(before.players[2].hand, 2);

    let state = step(before, 0, fromTop);
    expect(state.phase).toBe('exchange');
    expect(state.exchange?.submissions).toHaveLength(1);

    state = step(state, 1, fromSecond);
    expect(state.phase).toBe('playing');
    expect(state.exchange).toBeUndefined();

    for (const seat of PLAYER_INDEXES) {
      expect(state.players[seat].hand).toHaveLength(handSize(DEFAULT_RULE_CONFIG));
    }

    // 大富豪は大貧民の強い3枚を受け取り、渡した3枚を失う。
    for (const card of fromBottom) expect(ids(state.players[0].hand)).toContain(card.id);
    for (const card of fromTop) expect(ids(state.players[0].hand)).not.toContain(card.id);
    for (const card of fromTop) expect(ids(state.players[3].hand)).toContain(card.id);
    // 富豪⇔貧民も同様。
    for (const card of fromThird) expect(ids(state.players[1].hand)).toContain(card.id);
    for (const card of fromSecond) expect(ids(state.players[2].hand)).toContain(card.id);
  });

  it('交換後の手札は通常時の強さの昇順に並ぶ', () => {
    let state = started();
    state = step(state, 0, state.players[0].hand.slice(0, 3));
    state = step(state, 1, state.players[1].hand.slice(0, 2));

    for (const seat of PLAYER_INDEXES) {
      const hand = state.players[seat].hand;
      for (let i = 1; i < hand.length; i += 1) {
        const previous = hand[i - 1]!;
        const current = hand[i]!;
        const value = (card: Card) => (card.kind === 'joker' ? 16 : card.rank);
        expect(value(previous)).toBeLessThanOrEqual(value(current));
      }
    }
  });
});

describe('2.9 交換中の可視情報と合法手', () => {
  it('下位者には自分が渡すカードが見え、相手の提出内容は見えない', () => {
    const state = step(started(), 0, started().players[0].hand.slice(0, 3));

    const bottomView = getPlayerView(state, 3);
    expect(bottomView.exchange?.yourCount).toBe(3);
    expect(ids(bottomView.exchange?.yourCards ?? [])).toEqual(
      ids(forcedExchangeCards(state.players[3].hand, 3)),
    );
    expect(bottomView.exchange?.submittedSeats).toEqual([0]);
    // 大富豪が何を渡すかは分からない。
    expect(JSON.stringify(bottomView.exchange)).not.toContain(
      state.players[0].hand[0]?.id ?? 'なし',
    );
  });

  it('交換に関係ない席は渡す枚数0', () => {
    const view = getPlayerView(gameWith({ hands: { 0: ['S5a'] } }), 0);
    expect(view.exchange).toBeUndefined();
  });

  it('交換中はまだ提出していない上位者にだけ既定の提出が1つ返る', () => {
    const state = started();
    const top = getLegalActions(state, 0);
    expect(top).toHaveLength(1);
    expect(top[0]?.type).toBe('exchange');

    expect(getLegalActions(state, 3)).toEqual([]);

    const after = step(state, 0, state.players[0].hand.slice(0, 3));
    expect(getLegalActions(after, 0)).toEqual([]);
    expect(getLegalActions(after, 1)).toHaveLength(1);
  });

  it('既定の提出はそのまま適用できる', () => {
    let state = started();
    for (const seat of [0, 1] as const) {
      const actions = getLegalActions(state, seat);
      const action = actions[0];
      expect(action).toBeDefined();
      if (action === undefined) return;
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.value;
    }
    expect(state.phase).toBe('playing');
  });
});
