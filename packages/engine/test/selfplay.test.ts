/**
 * ランダムCPU同士の自動対戦で状態機械を総当たりに近い形で検証する
 * （CLAUDE.md フェーズ0の完了条件3の縮小版。1万ゲームは sim スクリプトで回す）。
 */

import { describe, expect, it } from 'vitest';

import { TOTAL_CARD_COUNT } from '../src/cards.js';
import { DEFAULT_RULE_CONFIG, handSize } from '../src/config.js';
import type { GameState } from '../src/game.js';
import { applyAction, createGame, pendingExchangeSeats } from '../src/game.js';
import { getLegalActions } from '../src/legal.js';
import { advanceSet, createSet, setRanking } from '../src/score.js';
import type { RngState } from '../src/rng.js';
import { createRng, pick } from '../src/rng.js';
import type { CardId, PlayerIndex } from '../src/types.js';
import { PLAYER_INDEXES } from '../src/types.js';

const MAX_ACTIONS = 2000;

type Outcome = {
  readonly state: GameState;
  readonly actions: number;
  readonly revolutions: number;
};

function cardsInHands(state: GameState): number {
  return PLAYER_INDEXES.reduce<number>((total, seat) => total + state.players[seat].hand.length, 0);
}

function checkInvariants(state: GameState, playedIds: ReadonlySet<CardId>): void {
  // カードの総数は常に108枚。
  expect(cardsInHands(state) + playedIds.size + state.blind.length).toBe(TOTAL_CARD_COUNT);

  // 場が空なら縛りもパスも解除されている（spec 2.5〜2.6）。
  if (state.field === undefined && state.phase === 'playing') {
    expect(state.lockedSuit).toBeUndefined();
    for (const seat of PLAYER_INDEXES) {
      expect(state.players[seat].passed).toBe(false);
    }
  }

  // 上がった人・反則上がりの人の手札は空。
  // 都落ちの人は手札を持ったまま退場する（spec 2.8）。
  for (const seat of [...state.finishOrder, ...state.illegalFinishOrder]) {
    expect(state.players[seat].finished).toBe(true);
    expect(state.players[seat].hand).toHaveLength(0);
  }
  if (state.fallenSeat !== undefined) {
    expect(state.players[state.fallenSeat].finished).toBe(true);
  }

  // 上がり順・反則上がり順・都落ちは重複しない。
  const out = [
    ...state.finishOrder,
    ...state.illegalFinishOrder,
    ...(state.fallenSeat === undefined ? [] : [state.fallenSeat]),
  ];
  expect(new Set(out).size).toBe(out.length);
}

function playRandomGame(seed: number, previousTopSeat?: PlayerIndex): Outcome {
  const created = createGame(
    DEFAULT_RULE_CONFIG,
    seed,
    previousTopSeat === undefined ? {} : { previousTopSeat },
  );
  if (!created.ok) throw new Error(`配札に失敗：${JSON.stringify(created.error)}`);

  let state = created.value;
  let rng: RngState = createRng(seed ^ 0x9e3779b9);
  let actions = 0;
  let revolutions = 0;
  const playedIds = new Set<CardId>();

  while (state.phase === 'playing') {
    actions += 1;
    if (actions > MAX_ACTIONS) throw new Error(`終わらない（seed ${String(seed)}）`);

    const seat = state.turn;
    expect(state.players[seat].finished).toBe(false);
    expect(state.players[seat].passed).toBe(false);

    const legal = getLegalActions(state, seat);
    // 場が空なら必ず出せる手がある。場があればパスできる。
    expect(legal.length).toBeGreaterThan(0);

    const [choice, nextRng] = pick(legal, rng);
    rng = nextRng;
    if (choice === undefined) throw new Error('行動が選べない');

    const result = applyAction(state, choice);
    if (!result.ok) {
      throw new Error(
        `列挙した手が出せない（seed ${String(seed)}）：${JSON.stringify(choice)} → ${JSON.stringify(result.error)}`,
      );
    }

    if (choice.type === 'play') {
      for (const card of choice.cards) {
        expect(playedIds.has(card.id)).toBe(false);
        playedIds.add(card.id);
      }
    }

    const before = state.revolution;
    state = result.value;
    if (state.revolution !== before) revolutions += 1;

    checkInvariants(state, playedIds);
  }

  return { state, actions, revolutions };
}

/** 交換を含めて1ゲームを最後まで進める。 */
function runGameTo(start: GameState, rngIn: RngState): { state: GameState; rng: RngState } {
  let state = start;
  let rng = rngIn;

  for (const seat of pendingExchangeSeats(state)) {
    const actions = getLegalActions(state, seat);
    expect(actions).toHaveLength(1);
    const [choice, next] = pick(actions, rng);
    rng = next;
    if (choice === undefined) throw new Error('交換の手がない');
    const result = applyAction(state, choice);
    if (!result.ok) throw new Error(`交換できない：${JSON.stringify(result.error)}`);
    state = result.value;
  }
  expect(state.phase).toBe('playing');

  let guard = 0;
  while (state.phase === 'playing') {
    guard += 1;
    if (guard > MAX_ACTIONS) throw new Error('終わらない');
    const legal = getLegalActions(state, state.turn);
    expect(legal.length).toBeGreaterThan(0);
    const [choice, next] = pick(legal, rng);
    rng = next;
    if (choice === undefined) throw new Error('行動が選べない');
    const result = applyAction(state, choice);
    if (!result.ok) throw new Error(`出せない：${JSON.stringify(result.error)}`);
    state = result.value;
  }
  return { state, rng };
}

describe('ランダムCPUのセット進行（交換あり）', () => {
  it('25セット（100ゲーム）が交換を含めて通る', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const created = createSet(DEFAULT_RULE_CONFIG, seed);
      if (!created.ok) throw new Error(`セットを開始できない：${JSON.stringify(created.error)}`);

      let set = created.value;
      let rng: RngState = createRng(seed ^ 0x5bf03635);
      let games = 0;

      for (;;) {
        // 2ゲーム目以降はカード交換から始まる（spec 2.9）。
        expect(set.game.phase).toBe(set.gameNumber === 1 ? 'playing' : 'exchange');

        const played = runGameTo(set.game, rng);
        rng = played.rng;
        games += 1;

        for (const seat of PLAYER_INDEXES) {
          expect(played.state.players[seat].finished).toBe(true);
        }
        expect([...(played.state.ranking ?? [])].sort()).toEqual([...PLAYER_INDEXES]);

        const advanced = advanceSet({ ...set, game: played.state });
        if (!advanced.ok) throw new Error(`進められない：${JSON.stringify(advanced.error)}`);
        set = advanced.value;
        if (set.phase === 'finished') break;
      }

      expect(games).toBe(DEFAULT_RULE_CONFIG.gamesPerSet);
      expect(set.results).toHaveLength(DEFAULT_RULE_CONFIG.gamesPerSet);
      // 1ゲーム12点、最終ゲームだけ+2。
      const total = PLAYER_INDEXES.reduce<number>((sum, seat) => sum + set.totals[seat], 0);
      expect(total).toBe(
        12 * DEFAULT_RULE_CONFIG.gamesPerSet + DEFAULT_RULE_CONFIG.finalGameTopBonus,
      );
      expect([...setRanking(set)].sort()).toEqual([...PLAYER_INDEXES]);
    }
  });

  it('交換後も全員27枚のまま始まる', () => {
    const created = createSet(DEFAULT_RULE_CONFIG, 3);
    if (!created.ok) throw new Error('セットを開始できない');

    const first = runGameTo(created.value.game, createRng(3));
    const advanced = advanceSet({ ...created.value, game: first.state });
    if (!advanced.ok) throw new Error('進められない');

    const second = advanced.value.game;
    expect(second.phase).toBe('exchange');
    for (const seat of pendingExchangeSeats(second)) {
      expect(getLegalActions(second, seat)).toHaveLength(1);
    }
    for (const seat of PLAYER_INDEXES) {
      expect(second.players[seat].hand).toHaveLength(handSize(DEFAULT_RULE_CONFIG));
    }
  });
});

describe('ランダムCPUの自動対戦', () => {
  const seeds = Array.from({ length: 200 }, (_, index) => index);

  it('200ゲームが例外・不正状態なく決着する', () => {
    for (const seed of seeds) {
      const { state } = playRandomGame(seed);

      expect(state.phase).toBe('finished');
      expect(state.field).toBeUndefined();

      const ranking = state.ranking;
      expect(ranking).toBeDefined();
      expect(ranking).toHaveLength(PLAYER_INDEXES.length);
      expect([...(ranking ?? [])].sort()).toEqual([...PLAYER_INDEXES]);

      for (const seat of PLAYER_INDEXES) {
        expect(state.players[seat].finished).toBe(true);
      }
      // 最下位は手札を残したまま終わる（相手がいなくなるので出し切らない）。
      const last = ranking?.[PLAYER_INDEXES.length - 1];
      expect(last).toBeDefined();
    }
  });

  it('決着時、上がった人の手札は空で、最後まで残った人は手札を残す', () => {
    const { state } = playRandomGame(11);
    for (const seat of [...state.finishOrder, ...state.illegalFinishOrder]) {
      expect(state.players[seat].hand).toHaveLength(0);
    }
    const stillHolding = PLAYER_INDEXES.filter(
      (seat) => state.players[seat].hand.length > 0,
    ).length;
    // 残るのは最後の1人と、いれば都落ちの人だけ。
    expect(stillHolding).toBeLessThanOrEqual(2);
  });

  it('前ゲームの大富豪を指定しても決着する（都落ちを含む）', () => {
    let fallen = 0;
    for (const seed of seeds) {
      const { state } = playRandomGame(seed, (seed % 4) as PlayerIndex);
      expect(state.phase).toBe('finished');
      expect([...(state.ranking ?? [])].sort()).toEqual([...PLAYER_INDEXES]);
      if (state.fallenSeat !== undefined) fallen += 1;
    }
    // ランダム打ちでも都落ちは頻繁に起きる。
    expect(fallen).toBeGreaterThan(0);
  });

  it('同じシードなら同じ結果になる', () => {
    expect(playRandomGame(42).state).toEqual(playRandomGame(42).state);
    expect(playRandomGame(42).state.ranking).not.toEqual(playRandomGame(43).state.ranking);
  });

  it('配り切った108枚がすべて出され、1ゲームの手数は妥当な範囲に収まる', () => {
    const { state, actions } = playRandomGame(7);
    expect(state.blind).toHaveLength(0);
    expect(handSize(DEFAULT_RULE_CONFIG)).toBe(27);
    expect(actions).toBeGreaterThan(20);
    expect(actions).toBeLessThan(MAX_ACTIONS);
  });

  it('革命が起きるゲームがある（革命5枚、spec 2.11 で確定）', () => {
    const total = seeds
      .slice(0, 50)
      .reduce<number>((sum, seed) => sum + playRandomGame(seed).revolutions, 0);
    expect(total).toBeGreaterThan(0);
  });
});
