/**
 * ヒューリスティックCPU（docs/spec.md 3 の難易度3段階、5 の「ルールエンジン上の
 * ヒューリスティック」）。
 *
 * 純粋関数。乱数は引数で受け取るシード付きRNGだけを使うので、同じシード・同じ状態なら
 * 必ず同じ手を選ぶ。1人用・切断時の代打ち・空席補充・自動対戦で共通に使う。
 *
 * 考え方：`getLegalPlays` が返す手に点を付けて最大のものを選ぶ。点の内訳は
 * 「何枚はけるか」から「強い札を手放す損」「同ランクの組を崩す損」を引いたもの。
 * 上がれる手は最優先、反則上がりは強く避ける。パスも1つの候補として同じ尺度で比べる。
 */

import type { Card, PlayerIndex, Rank } from './types.js';
import { MAX_RANK, MIN_RANK, PLAYER_INDEXES, RANK_THREE, RANK_TWO, isNormalCard } from './types.js';
import type { RuleConfig } from './config.js';
import type { GameAction, GameState } from './game.js';
import type { LegalPlay } from './legal.js';
import { getLegalPlays } from './legal.js';
import { isEightCut } from './play.js';
import { cardValue } from './strength.js';
import type { RngState } from './rng.js';
import { nextFloat } from './rng.js';

export const CPU_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type CpuLevel = (typeof CPU_LEVELS)[number];

export type CpuWeights = {
  /** 1枚はけることの加点。 */
  readonly shed: number;
  /** 手放すカードの強さに対する減点係数。 */
  readonly keepStrong: number;
  /** ジョーカー1枚を使うことの減点。 */
  readonly joker: number;
  /** 同ランクの組を崩すことの減点。 */
  readonly breakSet: number;
  /** 8切りの加点（場が流れて自分がスターターに戻れる）。 */
  readonly eightCut: number;
  /** 上がれる手の加点。 */
  readonly finish: number;
  /** 反則上がりの減点。 */
  readonly illegalFinish: number;
  /** 革命の加点係数。手札が弱いほど効く。 */
  readonly revolution: number;
  /**
   * 「最後に残せないカード」を抱える減点係数（spec 2.7）。
   * 2・ジョーカーを抱えたまま手札が減ると反則上がりに追い込まれるので、
   * 残り枚数に対する比率で効かせる。
   */
  readonly stranded: number;
  /** パスの基準点。これを下回る手しかなければパスする。 */
  readonly passBias: number;
  /** 急ぐ状況（都落ち回避・相手の手札が少ない）での加点係数。 */
  readonly hurry: number;
  /** 揺らぎの幅。初級ほど大きい。 */
  readonly noise: number;
};

/**
 * 難易度ごとの重み（spec 3 の初級・中級・上級）。
 * 上級は揺らぎなし。初級は強い札の管理が甘く、揺らぎが大きい。
 */
export const CPU_WEIGHTS: Readonly<Record<CpuLevel, CpuWeights>> = {
  beginner: {
    shed: 1,
    keepStrong: 0.2,
    joker: 0.3,
    breakSet: 0.2,
    eightCut: 0.5,
    finish: 100,
    illegalFinish: 20,
    revolution: 0,
    stranded: 1,
    passBias: -2,
    hurry: 0,
    noise: 5,
  },
  intermediate: {
    shed: 1.6,
    keepStrong: 0.6,
    joker: 1,
    breakSet: 0.5,
    eightCut: 2,
    finish: 100,
    illegalFinish: 50,
    revolution: 1,
    stranded: 4,
    passBias: -0.5,
    hurry: 0.4,
    noise: 1.5,
  },
  advanced: {
    shed: 2,
    keepStrong: 0.8,
    joker: 1.5,
    breakSet: 0.8,
    eightCut: 3,
    finish: 100,
    illegalFinish: 80,
    revolution: 2,
    stranded: 8,
    passBias: 0,
    hurry: 0.8,
    noise: 0,
  },
};

/** 最後の1手に残せないカード（spec 2.7）。通常時の2、革命時の3、ジョーカー。 */
function cannotFinishWith(card: Card, revolution: boolean): boolean {
  if (!isNormalCard(card)) return true;
  return card.rank === (revolution ? RANK_THREE : RANK_TWO);
}

/** カード1枚の「手放したくなさ」。最弱を0、最強の通常札を1とする。 */
function keepCost(card: Card, revolution: boolean): number {
  return (cardValue(card, revolution) - MIN_RANK) / (MAX_RANK - MIN_RANK);
}

/** 手札の弱さ。0〜1。革命で得をするかの判断に使う。 */
export function handWeakness(hand: readonly Card[], revolution: boolean): number {
  if (hand.length === 0) return 0;
  const middle = (MIN_RANK + MAX_RANK) / 2;
  return hand.filter((card) => cardValue(card, revolution) <= middle).length / hand.length;
}

function rankCounts(hand: readonly Card[]): ReadonlyMap<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of hand) {
    if (!isNormalCard(card)) continue;
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

/** 同ランクの組をいくつ崩すか（2枚以上あるランクを一部だけ使う数）。 */
function brokenSets(play: LegalPlay, counts: ReadonlyMap<Rank, number>): number {
  const used = new Map<Rank, number>();
  for (const card of play.cards) {
    if (!isNormalCard(card)) continue;
    used.set(card.rank, (used.get(card.rank) ?? 0) + 1);
  }
  let broken = 0;
  for (const [rank, taken] of used) {
    const held = counts.get(rank) ?? 0;
    if (held >= 2 && taken < held) broken += 1;
  }
  return broken;
}

/**
 * 急ぐべき状況か。0〜1。
 * - 自分が前ゲームの大富豪でまだ誰も上がっていない：都落ちを避けるため最優先で上がりたい
 * - 相手の手札が少ない：先に上がられる前に出し切りたい
 */
export function urgencyOf(state: GameState, seat: PlayerIndex): number {
  const fallRisk =
    state.previousTopSeat === seat &&
    state.finishOrder.length === 0 &&
    !state.players[seat].finished
      ? 1
      : 0;

  const opponentLow = PLAYER_INDEXES.filter(
    (index) => index !== seat && !state.players[index].finished,
  ).reduce<number>((least, index) => Math.min(least, state.players[index].hand.length), 99);
  const pressure = opponentLow <= 3 ? 1 : opponentLow <= 6 ? 0.5 : 0;

  return Math.max(fallRisk, pressure);
}

export type ScoreContext = {
  readonly config: RuleConfig;
  readonly revolution: boolean;
  readonly hand: readonly Card[];
  readonly weights: CpuWeights;
  readonly urgency: number;
};

/** 1つの手の点数。揺らぎは含めない。 */
export function scorePlay(play: LegalPlay, context: ScoreContext): number {
  const { weights: w, revolution, hand, config } = context;
  const counts = rankCounts(hand);
  let score = 0;

  const empties = play.cards.length === hand.length;
  if (empties) {
    score += play.illegalFinish === undefined ? w.finish : -w.illegalFinish;
  }

  score += w.shed * play.cards.length;
  score += w.hurry * context.urgency * play.cards.length;

  for (const card of play.cards) {
    score -= w.keepStrong * keepCost(card, revolution);
  }
  score -= w.joker * play.play.jokerCount;
  score -= w.breakSet * brokenSets(play, counts);

  if (isEightCut(play.play, config)) score += w.eightCut;

  // 革命は手札が弱いほど得。強い手札で起こすと自分の強みを捨てることになる。
  const triggersRevolution =
    play.play.kind === 'rank' && play.play.count >= config.revolutionMinCount;
  if (triggersRevolution) {
    score += w.revolution * (handWeakness(hand, revolution) - 0.5) * 2;
  }

  // スペ3返しは場を流して自分がスターターになるので、1枚の価値以上の意味がある。
  if (play.spade3Return) score += w.eightCut;

  // 出したあとに「最後に残せないカード」がどれだけ残るか（spec 2.7）。
  // 残り枚数が少ないほど、2やジョーカーを抱えていることが致命的になる。
  const remaining = hand.length - play.cards.length;
  if (remaining > 0) {
    const strandedAfter =
      hand.filter((card) => cannotFinishWith(card, revolution)).length -
      play.cards.filter((card) => cannotFinishWith(card, revolution)).length;
    score -= w.stranded * (strandedAfter / remaining);
  }

  return score;
}

/** 交換で渡すカードを選ぶ（spec 2.9）。組にならない弱いカードから渡す。 */
export function chooseExchangeCards(
  hand: readonly Card[],
  count: number,
  level: CpuLevel,
  rng: RngState,
): { readonly cards: readonly Card[]; readonly rng: RngState } {
  const weights = CPU_WEIGHTS[level];
  const counts = rankCounts(hand);
  let current = rng;

  const scored = hand.map((card) => {
    const [noise, next] = nextFloat(current);
    current = next;
    const inSet = isNormalCard(card) && (counts.get(card.rank) ?? 0) >= 2 ? 1 : 0;
    // 残したい度合い。小さいものから渡す。
    const keep =
      keepCost(card, false) + weights.breakSet * inSet + weights.noise * (noise - 0.5) * 0.2;
    return { card, keep };
  });

  scored.sort((a, b) => a.keep - b.keep);
  return { cards: scored.slice(0, count).map((entry) => entry.card), rng: current };
}

/**
 * その席が取る行動を1つ選ぶ。行動できないときは `undefined`。
 * 交換中（spec 2.9）は渡すカードの提出を返す。
 */
export function chooseAction(
  state: GameState,
  seat: PlayerIndex,
  level: CpuLevel,
  rng: RngState,
): { readonly action: GameAction; readonly rng: RngState } | undefined {
  const weights = CPU_WEIGHTS[level];

  if (state.phase === 'exchange') {
    const exchange = state.exchange;
    const pair = exchange?.pairs.find((entry) => entry.upper === seat);
    if (exchange === undefined || pair === undefined) return undefined;
    if (exchange.submissions.some((entry) => entry.upper === seat)) return undefined;

    const chosen = chooseExchangeCards(state.players[seat].hand, pair.count, level, rng);
    return { action: { type: 'exchange', seat, cards: chosen.cards }, rng: chosen.rng };
  }

  if (state.phase !== 'playing' || state.turn !== seat) return undefined;

  const canPass = state.field !== undefined;
  const plays = getLegalPlays(state, seat);
  if (plays.length === 0) {
    return canPass ? { action: { type: 'pass', seat }, rng } : undefined;
  }

  const context: ScoreContext = {
    config: state.config,
    revolution: state.revolution,
    hand: state.players[seat].hand,
    weights,
    urgency: urgencyOf(state, seat),
  };

  let current = rng;
  let best: LegalPlay | undefined;
  let bestScore = canPass ? weights.passBias : Number.NEGATIVE_INFINITY;

  for (const play of plays) {
    let score = scorePlay(play, context);
    if (weights.noise > 0) {
      const [noise, next] = nextFloat(current);
      current = next;
      score += weights.noise * (noise - 0.5) * 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }

  if (best === undefined) {
    return canPass ? { action: { type: 'pass', seat }, rng: current } : undefined;
  }

  return {
    action: { type: 'play', seat, cards: best.cards, preferKind: best.play.kind },
    rng: current,
  };
}
