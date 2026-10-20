/**
 * 場・手番・場流しと特殊ルール（docs/spec.md 2.5〜2.6）。
 *
 * 状態はイミュータブル。`applyAction(state, action)` が新しい状態を返し、不正な手は
 * 例外ではなく型付きエラーを返す（CLAUDE.md「ルールエンジンの設計原則」）。
 *
 * このモジュールの未実装（フェーズ0の残り）
 * - 反則上がり（spec 2.7）… 手札を出し切ったプレイヤーは上がり順に退場するだけで、
 *   2やジョーカーを含む最終手を無効にする判定はまだ行わない
 * - 順位・都落ち（spec 2.8）、カード交換（spec 2.9）、得点（spec 2.10）
 * - 合法手の列挙 `getLegalActions`
 */

import type { Card, CardId, PlayerClass, PlayerIndex, Suit } from './types.js';
import { PLAYER_CLASSES, PLAYER_INDEXES, RANK_THREE, isNormalCard, nextSeat } from './types.js';
import type { RuleConfig } from './config.js';
import type { Play, PlayContext, PlayError, PlayKind } from './play.js';
import {
  analyzePlay,
  checkIllegalFinish,
  interpretationOf,
  isEightCut,
  isJokerSingle,
  lockSuitOf,
  revaluePlay,
  satisfiesLock,
  validatePlay,
} from './play.js';
import { isUnbeatable } from './unbeatable.js';
import type { DealError } from './deal.js';
import { deal } from './deal.js';
import type { ExchangePair, ExchangeState } from './exchange.js';
import { exchangePairs, forcedExchangeCards, swapHands } from './exchange.js';
import type { RngState } from './rng.js';
import { createRng } from './rng.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type PlayerState = {
  readonly hand: readonly Card[];
  /** この場でパス済み。場が流れるまで出せない（spec 2.5）。 */
  readonly passed: boolean;
  /** 上がって退場した。 */
  readonly finished: boolean;
};

export type FieldState = {
  readonly play: Play;
  /** 直近に有効なカードを出した人。場流し後のスターターになる（spec 2.5）。 */
  readonly leader: PlayerIndex;
};

/** 場が流れた理由。UIの演出に使う。 */
export type FlushReason = 'allPassed' | 'eightCut' | 'spade3Return' | 'unbeatable';

export type GameState = {
  readonly config: RuleConfig;
  readonly players: Readonly<Record<PlayerIndex, PlayerState>>;
  readonly turn: PlayerIndex;
  /** 場。空なら `undefined`。 */
  readonly field: FieldState | undefined;
  /** 縛りスート。場流しで解除され、革命では解除されない（spec 2.6）。 */
  readonly lockedSuit: Suit | undefined;
  readonly revolution: boolean;
  /** 有効に上がった順（上位から、spec 2.8）。 */
  readonly finishOrder: readonly PlayerIndex[];
  /** 反則上がりした順。1人目が大貧民、2人目が貧民、3人目が富豪（spec 2.7）。 */
  readonly illegalFinishOrder: readonly PlayerIndex[];
  /** 都落ちした席（spec 2.8）。 */
  readonly fallenSeat: PlayerIndex | undefined;
  /** 前ゲームの大富豪。都落ちの判定に使う（spec 2.8）。 */
  readonly previousTopSeat: PlayerIndex | undefined;
  /** 確定した順位（上位から）。決着するまでは `undefined`。 */
  readonly ranking: readonly PlayerIndex[] | undefined;
  /** 伏せ札。ゲーム中は使わない（spec 2.1）。 */
  readonly blind: readonly Card[];
  /** 交換の状態（spec 2.9）。交換が終われば `undefined`。 */
  readonly exchange: ExchangeState | undefined;
  /** `exchange` の間は誰も出せない（spec 2.9）。 */
  readonly phase: 'exchange' | 'playing' | 'finished';
  /** 直前の行動で場が流れた理由。流れていなければ `undefined`。 */
  readonly lastFlush: FlushReason | undefined;
  readonly rng: RngState;
};

export type GameAction =
  | {
      readonly type: 'play';
      readonly seat: PlayerIndex;
      readonly cards: readonly Card[];
      /** 同ランク出しと階段の両方に解釈できるときの選択（spec 2.4-5）。 */
      readonly preferKind?: PlayKind;
    }
  | { readonly type: 'pass'; readonly seat: PlayerIndex }
  /** 上位者が渡すカードの提出（spec 2.9）。下位者は自動なので提出しない。 */
  | { readonly type: 'exchange'; readonly seat: PlayerIndex; readonly cards: readonly Card[] };

export type GameError =
  | { readonly code: 'gameFinished' }
  | { readonly code: 'notYourTurn'; readonly turn: PlayerIndex }
  | { readonly code: 'playerFinished' }
  /** 場が空のときの先手はパスできない（spec 2.5）。 */
  | { readonly code: 'cannotPassAsStarter' }
  | { readonly code: 'cardsNotInHand'; readonly ids: readonly CardId[] }
  | { readonly code: 'duplicateCards'; readonly ids: readonly CardId[] }
  | { readonly code: 'suitLocked'; readonly suit: Suit }
  | { readonly code: 'illegalPlay'; readonly error: PlayError }
  /** 交換が終わるまで誰も出せない（spec 2.9）。 */
  | { readonly code: 'inExchange' }
  | { readonly code: 'notInExchange' }
  /** その席は交換でカードを渡す側ではない。 */
  | { readonly code: 'exchangeNotYours' }
  | { readonly code: 'alreadySubmitted' }
  | {
      readonly code: 'wrongExchangeCount';
      readonly expected: number;
      readonly actual: number;
    };

function withPlayer(
  players: Readonly<Record<PlayerIndex, PlayerState>>,
  seat: PlayerIndex,
  patch: Partial<PlayerState>,
): Readonly<Record<PlayerIndex, PlayerState>> {
  return Object.fromEntries(
    PLAYER_INDEXES.map((index) => [
      index,
      index === seat ? { ...players[index], ...patch } : players[index],
    ]),
  ) as Record<PlayerIndex, PlayerState>;
}

function clearPasses(
  players: Readonly<Record<PlayerIndex, PlayerState>>,
): Readonly<Record<PlayerIndex, PlayerState>> {
  return Object.fromEntries(
    PLAYER_INDEXES.map((index) => [index, { ...players[index], passed: false }]),
  ) as Record<PlayerIndex, PlayerState>;
}

/** 退場していない席。 */
export function activeSeats(state: GameState): readonly PlayerIndex[] {
  return PLAYER_INDEXES.filter((seat) => !state.players[seat].finished);
}

/**
 * `from` の次から見て、最初の「退場しておらずパスもしていない」席。
 * `from` 自身は含めない。1周して誰もいなければ `undefined`（＝場が流れる）。
 */
function nextActor(
  players: Readonly<Record<PlayerIndex, PlayerState>>,
  from: PlayerIndex,
): PlayerIndex | undefined {
  let seat = nextSeat(from);
  for (let step = 0; step < PLAYER_INDEXES.length - 1; step += 1) {
    const player = players[seat];
    if (!player.finished && !player.passed) return seat;
    seat = nextSeat(seat);
  }
  return undefined;
}

/** `from` 自身を含め、左隣に向かって最初の退場していない席（spec 2.5 のスターター決定）。 */
function firstActiveFrom(
  players: Readonly<Record<PlayerIndex, PlayerState>>,
  from: PlayerIndex,
): PlayerIndex | undefined {
  let seat = from;
  for (let step = 0; step < PLAYER_INDEXES.length; step += 1) {
    if (!players[seat].finished) return seat;
    seat = nextSeat(seat);
  }
  return undefined;
}

export type GameSetup = {
  /** セット最初のゲームは席順で決める（spec 2.10）。2ゲーム目以降は前ゲームの大貧民。 */
  readonly starter?: PlayerIndex;
  /** 前ゲームの大富豪。都落ちの判定に使う（spec 2.8）。 */
  readonly previousTopSeat?: PlayerIndex;
  /**
   * 前ゲームの順位（上位から）。渡すとカード交換から始まる（spec 2.9）。
   * `previousTopSeat` を省略した場合はこの先頭を使う。
   */
  readonly previousRanking?: readonly PlayerIndex[];
};

export function createGame(
  config: RuleConfig,
  seed: number,
  setup: GameSetup = {},
): Result<GameState, DealError> {
  const dealt = deal(config, createRng(seed));
  if (!dealt.ok) return dealt;
  const { hands, blind, rng } = dealt.value;

  const players = Object.fromEntries(
    PLAYER_INDEXES.map((seat) => [seat, { hand: hands[seat], passed: false, finished: false }]),
  ) as Record<PlayerIndex, PlayerState>;

  const previousRanking = setup.previousRanking;
  const pairs = previousRanking === undefined ? [] : exchangePairs(previousRanking, config);
  const exchange = pairs.length === 0 ? undefined : { pairs, submissions: [] };

  return ok({
    config,
    players,
    turn: setup.starter ?? 0,
    field: undefined,
    lockedSuit: undefined,
    revolution: false,
    finishOrder: [],
    illegalFinishOrder: [],
    fallenSeat: undefined,
    previousTopSeat: setup.previousTopSeat ?? previousRanking?.[0],
    ranking: undefined,
    blind,
    exchange,
    phase: exchange === undefined ? 'playing' : 'exchange',
    lastFlush: undefined,
    rng,
  });
}

/** まだカードを提出していない上位者の席（spec 2.9）。 */
export function pendingExchangeSeats(state: GameState): readonly PlayerIndex[] {
  const exchange = state.exchange;
  if (state.phase !== 'exchange' || exchange === undefined) return [];
  return exchange.pairs
    .filter((pair) => !exchange.submissions.some((entry) => entry.upper === pair.upper))
    .map((pair) => pair.upper);
}

function applyExchangeAction(
  state: GameState,
  seat: PlayerIndex,
  cards: readonly Card[],
): Result<GameState, GameError> {
  const exchange = state.exchange;
  if (state.phase !== 'exchange' || exchange === undefined) {
    return err({ code: 'notInExchange' });
  }

  const pair = exchange.pairs.find((entry) => entry.upper === seat);
  if (pair === undefined) {
    return err({ code: 'exchangeNotYours' });
  }
  if (exchange.submissions.some((entry) => entry.upper === seat)) {
    return err({ code: 'alreadySubmitted' });
  }
  if (cards.length !== pair.count) {
    return err({ code: 'wrongExchangeCount', expected: pair.count, actual: cards.length });
  }

  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) {
    return err({ code: 'duplicateCards', ids: cards.map((card) => card.id) });
  }
  const hand = state.players[seat].hand;
  const missing = cards
    .filter((card) => !hand.some((held) => held.id === card.id))
    .map((card) => card.id);
  if (missing.length > 0) {
    return err({ code: 'cardsNotInHand', ids: missing });
  }

  const submissions = [...exchange.submissions, { upper: seat, cards }];
  if (submissions.length < exchange.pairs.length) {
    return ok({ ...state, exchange: { ...exchange, submissions } });
  }

  // 全組そろったので同時交換を実行する。
  const hands = Object.fromEntries(
    PLAYER_INDEXES.map((index) => [index, state.players[index].hand]),
  ) as Record<PlayerIndex, readonly Card[]>;
  const swapped = swapHands(hands, exchange.pairs, submissions);
  const players = Object.fromEntries(
    PLAYER_INDEXES.map((index) => [index, { ...state.players[index], hand: swapped[index] }]),
  ) as Record<PlayerIndex, PlayerState>;

  return ok({ ...state, players, exchange: undefined, phase: 'playing' });
}

/**
 * 順位を組み立てる（spec 2.7〜2.8）。上位から並べる。
 *
 * 上から「有効に上がった順」、次に場に残っていた人、次に都落ちの人、最後に反則上がりの人
 * （1人目が最下位なので逆順）。反則上がりがいると都落ちはその分だけ繰り上がる。
 */
function buildRanking(
  state: GameState,
  stillActive: readonly PlayerIndex[],
): readonly PlayerIndex[] {
  return [
    ...state.finishOrder,
    ...stillActive,
    ...(state.fallenSeat === undefined ? [] : [state.fallenSeat]),
    ...[...state.illegalFinishOrder].reverse(),
  ];
}

/** 残り1人以下になったらゲーム終了。残っていた人は順位のその位置に入る。 */
function closeIfOver(state: GameState): GameState {
  const active = activeSeats(state);
  if (active.length > 1) return state;

  const players = active.reduce(
    (current, seat) => withPlayer(current, seat, { finished: true }),
    state.players,
  );

  return {
    ...state,
    players,
    field: undefined,
    lockedSuit: undefined,
    phase: 'finished',
    ranking: buildRanking(state, active),
  };
}

/**
 * 場を流す（spec 2.5）。パス状態と縛りを解除し、スターターを決める。
 * `lastLeader` が退場済みなら左隣から最初のアクティブプレイヤー。
 */
function flush(state: GameState, lastLeader: PlayerIndex, reason: FlushReason): GameState {
  const players = clearPasses(state.players);
  const starter = players[lastLeader].finished
    ? firstActiveFrom(players, nextSeat(lastLeader))
    : lastLeader;

  return closeIfOver({
    ...state,
    players,
    field: undefined,
    lockedSuit: undefined,
    lastFlush: reason,
    turn: starter ?? state.turn,
  });
}

/** スペ3返し（spec 2.6）。シングルのジョーカーに対してのみ♠3を1枚出せる。 */
function isSpade3Return(state: GameState, cards: readonly Card[]): boolean {
  if (!state.config.spade3Return) return false;
  if (state.field === undefined || !isJokerSingle(state.field.play)) return false;
  const only = cards.length === 1 ? cards[0] : undefined;
  return only !== undefined && isNormalCard(only) && only.suit === 'S' && only.rank === RANK_THREE;
}

/** 直前の出しと今の出しのスートが一致したら縛りが成立する（spec 2.6）。 */
function lockFormedBy(previous: Play | undefined, current: Play): Suit | undefined {
  if (previous === undefined) return undefined;
  const before = lockSuitOf(previous);
  const now = lockSuitOf(current);
  return before !== undefined && before === now ? now : undefined;
}

function applyPass(state: GameState, seat: PlayerIndex): Result<GameState, GameError> {
  const field = state.field;
  if (field === undefined) {
    return err({ code: 'cannotPassAsStarter' });
  }

  const players = withPlayer(state.players, seat, { passed: true });
  const waiting = PLAYER_INDEXES.filter(
    (index) => !players[index].finished && !players[index].passed && index !== field.leader,
  );

  const passed: GameState = { ...state, players, lastFlush: undefined };
  if (waiting.length === 0) {
    // リード以外のアクティブプレイヤー全員がパスした（spec 2.5）。
    return ok(flush(passed, field.leader, 'allPassed'));
  }

  const next = nextActor(players, seat);
  if (next === undefined) {
    return ok(flush(passed, field.leader, 'allPassed'));
  }
  return ok({ ...passed, turn: next });
}

function applyPlay(
  state: GameState,
  seat: PlayerIndex,
  cards: readonly Card[],
  preferKind: PlayKind | undefined,
): Result<GameState, GameError> {
  const actor = state.players[seat];
  const missing = cards
    .filter((card) => !actor.hand.some((held) => held.id === card.id))
    .map((card) => card.id);
  if (missing.length > 0) {
    return err({ code: 'cardsNotInHand', ids: missing });
  }

  const before: PlayContext = { config: state.config, revolution: state.revolution };
  const spade3 = isSpade3Return(state, cards);

  // スペ3返しは強さと縛りを飛び越える（spec 2.6）。
  const locked = state.lockedSuit;
  if (!spade3 && locked !== undefined && !satisfiesLock(cards, locked)) {
    return err({ code: 'suitLocked', suit: locked });
  }

  let played: Play;
  if (spade3) {
    const analyzed = analyzePlay(cards, before);
    if (!analyzed.ok) return err({ code: 'illegalPlay', error: analyzed.error });
    const single = interpretationOf(analyzed.value, 'rank');
    if (single === undefined) {
      return err({ code: 'illegalPlay', error: { code: 'notACombination' } });
    }
    played = single;
  } else {
    const validated = validatePlay(cards, state.field?.play, before, preferKind);
    if (!validated.ok) return err({ code: 'illegalPlay', error: validated.error });
    played = validated.value;
  }

  const hand = actor.hand.filter((held) => !cards.some((card) => card.id === held.id));
  const emptied = hand.length === 0;
  // 反則上がりの判定は出す直前の状態で行う（spec 2.7）。
  const illegal = emptied ? checkIllegalFinish(played, before) : undefined;
  const validFinish = emptied && illegal === undefined;

  let players = withPlayer(state.players, seat, { hand, finished: emptied });
  const finishOrder = validFinish ? [...state.finishOrder, seat] : state.finishOrder;
  const illegalFinishOrder =
    illegal !== undefined ? [...state.illegalFinishOrder, seat] : state.illegalFinishOrder;

  // 都落ち（spec 2.8）。前ゲームの大富豪は、他の誰かが最初に有効に上がった時点で退場。
  // 反則上がりは引き金にならず、大富豪自身の反則上がりは都落ちではなく反則上がり扱い。
  const previousTop = state.previousTopSeat;
  const falls =
    validFinish &&
    state.finishOrder.length === 0 &&
    previousTop !== undefined &&
    previousTop !== seat &&
    !players[previousTop].finished;
  let fallenSeat = state.fallenSeat;
  if (falls && previousTop !== undefined) {
    players = withPlayer(players, previousTop, { finished: true });
    fallenSeat = previousTop;
  }

  // 革命（spec 2.6）。同ランク4枚以上で強弱が反転し、革命中に再度成立すると戻る。
  const revolutionTriggered =
    played.kind === 'rank' && played.count >= state.config.revolutionMinCount;
  const revolution = revolutionTriggered ? !state.revolution : state.revolution;
  const after: PlayContext = { config: state.config, revolution };
  // 反転後の強さで場に残す（spec 2.5 の即流し判定も反転後の状態で行う）。
  const fieldPlay = revolutionTriggered ? revaluePlay(played, after) : played;

  // 縛りは場流しで解除、革命では解除されない（spec 2.6）。既存の縛りは維持する。
  const nextLock = state.config.suitLock
    ? (locked ?? lockFormedBy(state.field?.play, fieldPlay))
    : undefined;

  // 反則上がりの手でも場流し・革命の効果は発生する（spec 2.7）。
  const eightCut = isEightCut(fieldPlay, state.config);
  const unbeatable = isUnbeatable(fieldPlay, {
    config: state.config,
    revolution,
    lockedSuit: nextLock,
  });

  const reason: FlushReason | undefined = spade3
    ? 'spade3Return'
    : eightCut
      ? 'eightCut'
      : unbeatable
        ? 'unbeatable'
        : undefined;

  const base: GameState = {
    ...state,
    players,
    finishOrder,
    illegalFinishOrder,
    fallenSeat,
    revolution,
    lastFlush: undefined,
  };

  if (reason !== undefined) {
    return ok(flush(base, seat, reason));
  }

  const next = nextActor(players, seat);
  if (next === undefined) {
    // 出せる人が残っていない＝リード以外全員がパス済み（spec 2.5）。
    return ok(flush(base, seat, 'allPassed'));
  }

  return ok(
    closeIfOver({
      ...base,
      field: { play: fieldPlay, leader: seat },
      lockedSuit: nextLock,
      turn: next,
    }),
  );
}

export function applyAction(state: GameState, action: GameAction): Result<GameState, GameError> {
  if (state.phase === 'finished') {
    return err({ code: 'gameFinished' });
  }

  // 交換は同時なので手番を見ない（spec 2.9）。
  if (action.type === 'exchange') {
    return applyExchangeAction(state, action.seat, action.cards);
  }
  if (state.phase === 'exchange') {
    return err({ code: 'inExchange' });
  }

  if (action.seat !== state.turn) {
    return err({ code: 'notYourTurn', turn: state.turn });
  }
  if (state.players[action.seat].finished) {
    return err({ code: 'playerFinished' });
  }

  return action.type === 'pass'
    ? applyPass(state, action.seat)
    : applyPlay(state, action.seat, action.cards, action.preferKind);
}

/** 順位（上位から）から階級を引く（spec 2.8）。 */
export function classOf(
  ranking: readonly PlayerIndex[],
  seat: PlayerIndex,
): PlayerClass | undefined {
  const place = ranking.indexOf(seat);
  return place < 0 ? undefined : PLAYER_CLASSES[place];
}

/** 席ごとの階級。決着していなければ `undefined`。 */
export function classesOf(
  state: GameState,
): Readonly<Record<PlayerIndex, PlayerClass>> | undefined {
  const ranking = state.ranking;
  if (ranking === undefined) return undefined;
  const entries = PLAYER_INDEXES.map((seat) => [seat, classOf(ranking, seat)] as const);
  if (entries.some(([, playerClass]) => playerClass === undefined)) return undefined;
  return Object.fromEntries(entries) as Record<PlayerIndex, PlayerClass>;
}

export type ExchangeView = {
  readonly pairs: readonly ExchangePair[];
  /** 提出済みの席。中身は見せない（同時交換なので、相手が何を渡すかは分からない）。 */
  readonly submittedSeats: readonly PlayerIndex[];
  /** 自分が渡す枚数。交換に関係なければ0。 */
  readonly yourCount: number;
  /** 自分が渡すカード。下位者は自動で確定、上位者は提出済みならその内容。 */
  readonly yourCards: readonly Card[] | undefined;
};

function exchangeViewOf(state: GameState, seat: PlayerIndex): ExchangeView | undefined {
  const exchange = state.exchange;
  if (exchange === undefined) return undefined;

  const asUpper = exchange.pairs.find((pair) => pair.upper === seat);
  const asLower = exchange.pairs.find((pair) => pair.lower === seat);
  const submitted = exchange.submissions.find((entry) => entry.upper === seat);

  return {
    pairs: exchange.pairs,
    submittedSeats: exchange.submissions.map((entry) => entry.upper),
    yourCount: asUpper?.count ?? asLower?.count ?? 0,
    yourCards:
      asLower !== undefined
        ? forcedExchangeCards(state.players[seat].hand, asLower.count)
        : submitted?.cards,
  };
}

export type OpponentView = {
  readonly seat: PlayerIndex;
  readonly handCount: number;
  readonly passed: boolean;
  readonly finished: boolean;
};

export type PlayerView = {
  readonly seat: PlayerIndex;
  readonly hand: readonly Card[];
  /** 相手は残り枚数だけ。手札は含めない（不正対策、spec 5）。 */
  readonly opponents: readonly OpponentView[];
  readonly turn: PlayerIndex;
  readonly field: FieldState | undefined;
  readonly lockedSuit: Suit | undefined;
  readonly revolution: boolean;
  readonly finishOrder: readonly PlayerIndex[];
  readonly illegalFinishOrder: readonly PlayerIndex[];
  readonly fallenSeat: PlayerIndex | undefined;
  readonly ranking: readonly PlayerIndex[] | undefined;
  readonly exchange: ExchangeView | undefined;
  readonly phase: GameState['phase'];
  readonly lastFlush: FlushReason | undefined;
};

/** そのプレイヤーに見えてよい情報だけを返す（CLAUDE.md）。 */
export function getPlayerView(state: GameState, seat: PlayerIndex): PlayerView {
  return {
    seat,
    hand: state.players[seat].hand,
    opponents: PLAYER_INDEXES.filter((index) => index !== seat).map((index) => ({
      seat: index,
      handCount: state.players[index].hand.length,
      passed: state.players[index].passed,
      finished: state.players[index].finished,
    })),
    turn: state.turn,
    field: state.field,
    lockedSuit: state.lockedSuit,
    revolution: state.revolution,
    finishOrder: state.finishOrder,
    illegalFinishOrder: state.illegalFinishOrder,
    fallenSeat: state.fallenSeat,
    ranking: state.ranking,
    exchange: exchangeViewOf(state, seat),
    phase: state.phase,
    lastFlush: state.lastFlush,
  };
}
