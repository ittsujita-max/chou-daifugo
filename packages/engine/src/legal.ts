/**
 * 合法手の列挙（docs/spec.md 2.3〜2.6）。CPU・UIの合法手ハイライト・サーバー検証で使う。
 *
 * **代表手だけを返す。** 同じランクのカードが複数あるとき（2デッキなので ♥5 が2枚ある、
 * 同ランクが最大8枚ある）どの1枚を使うかで組み合わせの数が爆発するので、カードは
 * 弱い順・デッキ番号順に決め打ちで選ぶ。階段も (スート, 窓) ごとに、ジョーカーを
 * 隙間だけに使う形を1つ返す。
 *
 * プレイヤーが別のカードを選んで出すのは自由で、その判定は `applyAction`（`validatePlay`）が
 * 行う。このモジュールはあくまで「どんな手があるか」の列挙である。
 */

import type { Card, NormalCard, PlayerIndex, Rank } from './types.js';
import { JOKER_VALUE, MIN_RANK, RANK_THREE, SUITS, isJoker, isNormalCard } from './types.js';
import type { GameAction, GameState } from './game.js';
import { pendingExchangeSeats } from './game.js';
import { defaultExchangeCards } from './exchange.js';
import type { IllegalFinishReason, Play, PlayContext, PlayKind } from './play.js';
import {
  analyzePlay,
  checkIllegalFinish,
  interpretationOf,
  isJokerSingle,
  satisfiesLock,
  validatePlay,
} from './play.js';
import { cardValue, sortByStrength } from './strength.js';

export type LegalPlay = {
  readonly cards: readonly Card[];
  readonly play: Play;
  /** この手で上がると反則上がりになる理由（spec 2.7）。ならないなら `undefined`。 */
  readonly illegalFinish: IllegalFinishReason | undefined;
  /** スペ3返し（spec 2.6）。 */
  readonly spade3Return: boolean;
};

function countsFor(state: GameState, kind: PlayKind, handSize: number): readonly number[] {
  const field = state.field;
  if (field !== undefined) {
    return field.play.kind === kind ? [field.play.count] : [];
  }
  const from = kind === 'rank' ? 1 : state.config.sequenceMinLength;
  const to = kind === 'rank' ? Math.min(state.config.maxSameRankCount, handSize) : handSize;
  const counts: number[] = [];
  for (let count = from; count <= to; count += 1) counts.push(count);
  return counts;
}

/**
 * その席が「今この場に対して」出せる手の代表を列挙する。
 * 退場済み・パス済み・決着後は空。手番かどうかは見ない（`getLegalActions` が見る）。
 */
export function getLegalPlays(state: GameState, seat: PlayerIndex): readonly LegalPlay[] {
  const player = state.players[seat];
  if (state.phase !== 'playing' || player.finished || player.passed) return [];

  const context: PlayContext = { config: state.config, revolution: state.revolution };
  const hand = sortByStrength(player.hand, state.revolution);
  const jokers = hand.filter(isJoker);
  const normals = hand.filter(isNormalCard);
  const field = state.field;

  const results: LegalPlay[] = [];
  const seen = new Set<string>();

  const consider = (cards: readonly Card[], kind: PlayKind, spade3 = false): void => {
    // スペ3返しは同じカード・同じ種類でも別の手なので、キーに含めて区別する。
    const key = `${kind}:${String(spade3)}:${cards.map((card) => card.id).join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (!spade3 && !satisfiesLock(cards, state.lockedSuit)) return;

    let play: Play;
    if (spade3) {
      const analyzed = analyzePlay(cards, context);
      if (!analyzed.ok) return;
      const single = interpretationOf(analyzed.value, 'rank');
      if (single === undefined) return;
      play = single;
    } else {
      const validated = validatePlay(cards, field?.play, context, kind);
      if (!validated.ok) return;
      play = validated.value;
    }

    results.push({
      cards,
      play,
      illegalFinish:
        cards.length === player.hand.length ? checkIllegalFinish(play, context) : undefined,
      spade3Return: spade3,
    });
  };

  // 同ランク出し（シングルを含む）。
  const byRank = new Map<Rank, NormalCard[]>();
  for (const card of normals) {
    const group = byRank.get(card.rank);
    if (group === undefined) byRank.set(card.rank, [card]);
    else group.push(card);
  }
  for (const count of countsFor(state, 'rank', hand.length)) {
    for (const group of byRank.values()) {
      // ジョーカーは不足分を補う。通常札が1枚もないとランクが決まらない。
      const maxJokers = Math.min(jokers.length, count - 1);
      for (let used = 0; used <= maxJokers; used += 1) {
        const needed = count - used;
        if (needed > group.length) continue;
        consider([...group.slice(0, needed), ...jokers.slice(0, used)], 'rank');
      }
    }
    // ジョーカーだけの同ランク出し。
    if (count <= jokers.length) consider(jokers.slice(0, count), 'rank');
  }

  // 階段。スートごとに窓を走査し、隙間をジョーカーで埋める。
  for (const count of countsFor(state, 'sequence', hand.length)) {
    for (const suit of SUITS) {
      const bySlot = new Map<number, NormalCard>();
      for (const card of normals) {
        if (card.suit !== suit) continue;
        const value = cardValue(card, state.revolution);
        if (!bySlot.has(value)) bySlot.set(value, card);
      }
      if (bySlot.size === 0) continue;

      for (let low = MIN_RANK; low + count - 1 <= JOKER_VALUE; low += 1) {
        const picked: Card[] = [];
        let jokersNeeded = 0;
        for (let value = low; value < low + count; value += 1) {
          const card = bySlot.get(value);
          if (card === undefined) jokersNeeded += 1;
          else picked.push(card);
        }
        if (picked.length === 0 || jokersNeeded > jokers.length) continue;
        consider([...picked, ...jokers.slice(0, jokersNeeded)], 'sequence');
      }
    }
    // ジョーカーだけの階段。スートを名乗らず、取れる窓の上限を取る。
    if (count <= jokers.length) consider(jokers.slice(0, count), 'sequence');
  }

  // スペ3返し（spec 2.6）。通常の強さ判定では出せないので別に加える。
  if (field !== undefined && state.config.spade3Return && isJokerSingle(field.play)) {
    const spade3 = normals.find((card) => card.suit === 'S' && card.rank === RANK_THREE);
    if (spade3 !== undefined) consider([spade3], 'rank', true);
  }

  return results;
}

/**
 * 出せる手が1つも無く、パスしかできないか。
 *
 * 自動対戦で測ると手番の約半分がこの状態で、パスの99.8%がこれにあたる。
 * クライアントはここで持ち時間を使わせず自動パスする（spec 4.2）。
 */
export function mustPass(state: GameState, seat: PlayerIndex): boolean {
  if (state.phase !== 'playing' || state.turn !== seat) return false;
  return state.field !== undefined && getLegalPlays(state, seat).length === 0;
}

/**
 * その席が今取れる行動。手番でなければ空。
 * 場にカードがあるときだけパスを含む（spec 2.5）。
 *
 * 交換中（spec 2.9）は、まだ提出していない上位者に対して**既定の提出（弱い順）**を
 * 1つだけ返す。仕様上はどの組み合わせでも渡せるので、自分で選ぶCPU・UIは
 * `applyAction` に直接渡す。
 */
export function getLegalActions(state: GameState, seat: PlayerIndex): readonly GameAction[] {
  if (state.phase === 'exchange') {
    const pair = state.exchange?.pairs.find((entry) => entry.upper === seat);
    if (pair === undefined || !pendingExchangeSeats(state).includes(seat)) return [];
    return [
      { type: 'exchange', seat, cards: defaultExchangeCards(state.players[seat].hand, pair.count) },
    ];
  }
  if (state.phase !== 'playing' || state.turn !== seat) return [];

  const plays: GameAction[] = getLegalPlays(state, seat).map((legal) => ({
    type: 'play',
    seat,
    cards: legal.cards,
    preferKind: legal.play.kind,
  }));

  return state.field === undefined ? plays : [...plays, { type: 'pass', seat }];
}
