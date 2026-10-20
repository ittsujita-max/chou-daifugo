/**
 * 出せる組み合わせと出す条件（docs/spec.md 2.3〜2.4）。
 *
 * 組み合わせの「種類」は2つだけ扱う。
 * - `rank`     … 同ランク出し。1枚（シングル）もここに含める
 * - `sequence` … 階段。同一スートで強さの順に連続する `sequenceMinLength` 枚以上
 *
 * 階段は「ランクの連続」ではなく**強さの連続**として判定する。こうすると
 * 革命時の反転（通常の `Q-K-A` が革命時も連続である）と、ジョーカーを2（革命時は3）
 * の上に置く最上段（例：`A-2-JK`）が、どちらも同じ仕組みで扱える。
 *
 * ジョーカーが何を名乗ったかは `SequencePlay.slots` に残す（UIの解釈ダイアログ用）。
 *
 * 縛り（spec 2.6）と8切り・スペ3返しはこのモジュールでは判定しない。場の状態を持つ
 * 2.5〜2.6の実装で追加する。
 */

import type { Card, CardId, JokerCard, NormalCard, Rank, Suit } from './types.js';
import {
  JOKER_VALUE,
  MIN_RANK,
  RANK_EIGHT,
  RANK_LABELS,
  RANK_THREE,
  RANK_TWO,
  SUIT_LABELS,
  isJoker,
  isNormalCard,
} from './types.js';
import type { RuleConfig } from './config.js';
import { cardValue, rankFromValue, sortByStrength } from './strength.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type PlayKind = 'rank' | 'sequence';

/** 判定に必要な場の情報のうち、革命とルール設定だけを切り出したもの。 */
export type PlayContext = {
  readonly config: RuleConfig;
  readonly revolution: boolean;
};

/** 階段の1段。`rank` が `undefined` なら2（革命時は3）の上のジョーカー専用スロット。 */
export type SequenceSlot = {
  readonly value: number;
  readonly rank: Rank | undefined;
  readonly card: Card;
};

/** 同ランク出し（シングルを含む）。 */
export type RankPlay = {
  readonly kind: 'rank';
  readonly cards: readonly Card[];
  readonly count: number;
  /** 組み合わせの強さ。 */
  readonly value: number;
  /** ジョーカーだけの出しは `undefined`（他のランクを名乗らない、spec 2.3）。 */
  readonly rank: Rank | undefined;
  readonly jokerCount: number;
};

/** 階段。 */
export type SequencePlay = {
  readonly kind: 'sequence';
  readonly cards: readonly Card[];
  readonly count: number;
  /** 組み合わせの強さ＝最弱の段の強さ（spec 2.4）。 */
  readonly value: number;
  /** ジョーカーだけの階段はスートを名乗らないので `undefined`。 */
  readonly suit: Suit | undefined;
  readonly jokerCount: number;
  /** 弱い順の段。 */
  readonly slots: readonly SequenceSlot[];
};

export type Play = RankPlay | SequencePlay;

export type PlayError =
  | { readonly code: 'noCards' }
  | { readonly code: 'duplicateCards'; readonly ids: readonly CardId[] }
  | { readonly code: 'tooManyCards'; readonly count: number; readonly max: number }
  /** どの種類にも解釈できない（ランクもスートも揃っていない、連続していない等）。 */
  | { readonly code: 'notACombination' }
  /** 場が空で種類が2通りに解釈できる。プレイヤーの選択が必要（spec 2.4-5）。 */
  | { readonly code: 'ambiguousInterpretation'; readonly kinds: readonly PlayKind[] }
  | { readonly code: 'kindMismatch'; readonly expected: PlayKind; readonly expectedCount: number }
  | { readonly code: 'notStrongEnough'; readonly value: number; readonly fieldValue: number }
  /** シングルのジョーカーにジョーカー単体は重ねられない（spec 2.4-4）。 */
  | { readonly code: 'jokerOnJoker' };

export type PlayAnalysis = {
  /**
   * 成立する解釈。種類ごとに1つだけ入る（ジョーカーの解釈が複数ある場合は
   * その種類の中で最も強いものを採る、spec 2.4-5）。
   */
  readonly interpretations: readonly Play[];
  /** 種類が2通りに解釈できる。場が空ならプレイヤーが選ぶ（spec 2.4-5）。 */
  readonly ambiguous: boolean;
};

export function isSingle(play: Play): boolean {
  return play.kind === 'rank' && play.count === 1;
}

/** シングルのジョーカー。スペ3返し（spec 2.6）の対象。 */
export function isJokerSingle(play: Play): boolean {
  return isSingle(play) && play.jokerCount === 1;
}

function duplicateIds(cards: readonly Card[]): readonly CardId[] {
  const seen = new Set<CardId>();
  const duplicated = new Set<CardId>();
  for (const card of cards) {
    if (seen.has(card.id)) duplicated.add(card.id);
    else seen.add(card.id);
  }
  return [...duplicated];
}

function splitJokers(cards: readonly Card[]): {
  readonly normals: readonly NormalCard[];
  readonly jokers: readonly JokerCard[];
} {
  const normals: NormalCard[] = [];
  const jokers: JokerCard[] = [];
  for (const card of cards) {
    if (isJoker(card)) jokers.push(card);
    else normals.push(card);
  }
  return { normals, jokers };
}

/**
 * 同ランク出しとしての解釈（spec 2.3）。
 * ランクは手札の通常札が決める。ジョーカーは不足分を補うだけで、ランクは名乗らない。
 * ジョーカーだけの出しはランクを持たず、通常時・革命時ともに最強（強さ16）になる。
 */
function interpretAsRank(
  cards: readonly Card[],
  context: PlayContext,
): Result<RankPlay, PlayError> {
  const { normals, jokers } = splitJokers(cards);
  const count = cards.length;

  if (count > context.config.maxSameRankCount) {
    return err({ code: 'tooManyCards', count, max: context.config.maxSameRankCount });
  }

  const first = normals[0];
  if (first === undefined) {
    // ジョーカーのみ。spec 2.5 が「ジョーカー2枚のペア」を即流しの例に挙げている通り、
    // 強さは2ではなくジョーカーそのもの。
    return ok({
      kind: 'rank',
      cards: sortByStrength(cards, context.revolution),
      count,
      value: JOKER_VALUE,
      rank: undefined,
      jokerCount: jokers.length,
    });
  }

  if (normals.some((card) => card.rank !== first.rank)) {
    return err({ code: 'notACombination' });
  }

  return ok({
    kind: 'rank',
    cards: sortByStrength(cards, context.revolution),
    count,
    value: cardValue(first, context.revolution),
    rank: first.rank,
    jokerCount: jokers.length,
  });
}

/**
 * 階段としての解釈（spec 2.3）。
 *
 * 枚数 `n` の階段は、強さの連続する `n` 段（窓）を占める。通常札はすべて窓の中に
 * 入り、空いた段をジョーカーが埋める。窓の上端は強さ16まで取れる（2の上、革命時は
 * 3の上のジョーカー専用スロット）。
 *
 * 窓が複数あるときは最も強いもの、つまり下端が最大のものを採る（spec 2.4-5）。
 *
 * ジョーカーだけの出しもスートを名乗らない階段として成立し、上限の窓（通常時なら
 * `A-2-JKの段`）を取る。これはその枚数の階段として到達できる最大の強さで、そもそも
 * 即流しになる強さなので、場に残っている階段には必ず上回れる。
 */
function interpretAsSequence(
  cards: readonly Card[],
  context: PlayContext,
): Result<SequencePlay, PlayError> {
  const { config, revolution } = context;
  const count = cards.length;
  if (count < config.sequenceMinLength) {
    return err({ code: 'notACombination' });
  }

  const { normals, jokers } = splitJokers(cards);
  // ジョーカーだけの出しはスートを名乗らない（`suit` は undefined）。
  const suit = normals[0]?.suit;
  if (normals.some((card) => card.suit !== suit)) {
    return err({ code: 'notACombination' });
  }

  const values = normals.map((card) => cardValue(card, revolution));
  // 同じ段は二度使えない（2デッキなので同スート同ランクが2枚ありうる）。
  if (new Set(values).size !== values.length) {
    return err({ code: 'notACombination' });
  }

  // 窓の上端は強さ16まで（2の上、革命時は3の上）。通常札が無ければ窓は上限まで取れる。
  const highestLow = JOKER_VALUE - count + 1;
  const lowMin =
    values.length === 0 ? MIN_RANK : Math.max(MIN_RANK, Math.max(...values) - count + 1);
  const lowMax = values.length === 0 ? highestLow : Math.min(Math.min(...values), highestLow);
  if (lowMin > lowMax) {
    return err({ code: 'notACombination' });
  }

  // 下端が最大の窓＝最も強い解釈。
  const low = lowMax;
  const byValue = new Map(values.map((value, index) => [value, normals[index] as NormalCard]));
  const spareJokers = [...jokers].sort((a, b) => a.index - b.index);
  const slots: SequenceSlot[] = [];
  let usedJokers = 0;
  for (let value = low; value < low + count; value += 1) {
    const normal = byValue.get(value);
    const card = normal ?? spareJokers[usedJokers];
    if (card === undefined) {
      // 窓の計算が正しければ到達しない。
      return err({ code: 'notACombination' });
    }
    if (normal === undefined) usedJokers += 1;
    slots.push({ value, rank: rankFromValue(value, revolution), card });
  }

  return ok({
    kind: 'sequence',
    cards: slots.map((slot) => slot.card),
    count,
    value: low,
    suit,
    jokerCount: jokers.length,
    slots,
  });
}

/**
 * 出されたカードを組み合わせとして解釈する（spec 2.3〜2.4-5）。
 * 成立する種類をすべて返す。場が空で2種類に解釈できる場合はプレイヤーが選ぶ。
 */
export function analyzePlay(
  cards: readonly Card[],
  context: PlayContext,
): Result<PlayAnalysis, PlayError> {
  if (cards.length === 0) {
    return err({ code: 'noCards' });
  }
  const duplicated = duplicateIds(cards);
  if (duplicated.length > 0) {
    return err({ code: 'duplicateCards', ids: duplicated });
  }

  const asRank = interpretAsRank(cards, context);
  const asSequence = interpretAsSequence(cards, context);
  const interpretations: Play[] = [];
  if (asRank.ok) interpretations.push(asRank.value);
  if (asSequence.ok) interpretations.push(asSequence.value);

  if (interpretations.length === 0) {
    // 枚数上限は理由が明確なのでそのまま返す。
    if (!asRank.ok && asRank.error.code === 'tooManyCards') return asRank;
    return err({ code: 'notACombination' });
  }

  return ok({ interpretations, ambiguous: interpretations.length > 1 });
}

/** 解釈の中から種類を指定して取り出す。 */
export function interpretationOf(analysis: PlayAnalysis, kind: PlayKind): Play | undefined {
  return analysis.interpretations.find((play) => play.kind === kind);
}

/**
 * 場の出しを上回れるか（spec 2.4-2〜2.4-4）。
 * 同じ種類・同じ枚数で、より強いものだけが出せる。同じ強さは出せない。
 */
export function canBeat(candidate: Play, field: Play): Result<Play, PlayError> {
  if (candidate.kind !== field.kind || candidate.count !== field.count) {
    return err({ code: 'kindMismatch', expected: field.kind, expectedCount: field.count });
  }
  if (isJokerSingle(field) && isJokerSingle(candidate)) {
    return err({ code: 'jokerOnJoker' });
  }
  if (candidate.value <= field.value) {
    return err({ code: 'notStrongEnough', value: candidate.value, fieldValue: field.value });
  }
  return ok(candidate);
}

/**
 * 出せるかどうかを判定し、成立した組み合わせを返す（spec 2.4）。
 *
 * - 場が空（`field` が `undefined`）なら任意の合法な組み合わせを出せる。種類が2通りに
 *   解釈できる場合は `chosenKind` で指定する。指定がなければ
 *   `ambiguousInterpretation` を返すので、UIはプレイヤーに選ばせて再度呼ぶ。
 * - 場にカードがあれば種類と枚数が決まるので、`chosenKind` は見ない。
 *
 * 縛り（spec 2.6）はここでは判定しない。
 */
export function validatePlay(
  cards: readonly Card[],
  field: Play | undefined,
  context: PlayContext,
  chosenKind?: PlayKind,
): Result<Play, PlayError> {
  const analyzed = analyzePlay(cards, context);
  if (!analyzed.ok) return analyzed;
  const analysis = analyzed.value;

  if (field === undefined) {
    if (chosenKind !== undefined) {
      const chosen = interpretationOf(analysis, chosenKind);
      if (chosen === undefined) {
        return err({ code: 'kindMismatch', expected: chosenKind, expectedCount: cards.length });
      }
      return ok(chosen);
    }
    if (analysis.ambiguous) {
      return err({
        code: 'ambiguousInterpretation',
        kinds: analysis.interpretations.map((play) => play.kind),
      });
    }
    const only = analysis.interpretations[0];
    if (only === undefined) return err({ code: 'notACombination' });
    return ok(only);
  }

  const matching = interpretationOf(analysis, field.kind);
  if (matching === undefined) {
    return err({ code: 'kindMismatch', expected: field.kind, expectedCount: field.count });
  }
  return canBeat(matching, field);
}

/** 8切りが成立する出しか（spec 2.6）。階段では発動しない。 */
export function isEightCut(play: Play, config: RuleConfig): boolean {
  return config.eightCut && play.kind === 'rank' && play.rank === RANK_EIGHT;
}

export type IllegalFinishReason = 'two' | 'three' | 'eightCut' | 'joker' | 'spade3Single';

/**
 * 反則上がりの判定（spec 2.7）。その手で手札を出し切る場合にだけ意味を持つ。
 *
 * 判定は**その手を出す直前の状態**で行う。`context.revolution` には出す前の革命状態を渡す。
 * その手で革命が起きても判定は変わらない。
 */
export function checkIllegalFinish(
  play: Play,
  context: PlayContext,
): IllegalFinishReason | undefined {
  // 通常時は2、革命時は3（spec 2.7）。
  const forbidden = context.revolution ? RANK_THREE : RANK_TWO;
  if (play.cards.some((card) => isNormalCard(card) && card.rank === forbidden)) {
    return context.revolution ? 'three' : 'two';
  }
  if (isEightCut(play, context.config)) return 'eightCut';
  if (play.jokerCount > 0) return 'joker';

  const only = play.count === 1 ? play.cards[0] : undefined;
  if (only !== undefined && isNormalCard(only) && only.suit === 'S' && only.rank === RANK_THREE) {
    return 'spade3Single';
  }
  return undefined;
}

/**
 * 縛りを新たに発生させるときのスート（spec 2.6）。
 *
 * 全カードが同じスートの出しだけがスートを名乗る。ジョーカーはスートを持たないので、
 * ジョーカーを含む出しは縛りを発生させられない（既存の縛りの維持は `satisfiesLock`）。
 */
export function lockSuitOf(play: Play): Suit | undefined {
  if (play.jokerCount > 0) return undefined;
  const suits = new Set(play.cards.filter(isNormalCard).map((card) => card.suit));
  return suits.size === 1 ? [...suits][0] : undefined;
}

/**
 * 縛り中に出せるか（spec 2.6）。
 * ジョーカーは縛りスートの代わりに使えるが、縛りスート以外の通常札は混ぜられない。
 * シングルのジョーカーは通常札を含まないので縛りを満たす（縛りは維持される）。
 */
export function satisfiesLock(cards: readonly Card[], lockedSuit: Suit | undefined): boolean {
  if (lockedSuit === undefined) return true;
  return cards.every((card) => isJoker(card) || card.suit === lockedSuit);
}

/**
 * 革命で強弱が反転したあと、場の出しの強さを新しい状態で読み直す（spec 2.5）。
 * 革命を起こす出しは同ランク出しなのでランクは変わらず、強さだけが反転する。
 */
export function revaluePlay(play: Play, context: PlayContext): Play {
  const analyzed = analyzePlay(play.cards, context);
  if (!analyzed.ok) return play;
  return interpretationOf(analyzed.value, play.kind) ?? play;
}

function rankLabel(rank: Rank | undefined): string {
  return rank === undefined ? 'JK' : RANK_LABELS[rank];
}

/** ログ・テスト用の表示（例：`同ランク5×3`、`階段♠5-7×3`、`シングルJK`）。 */
export function formatPlay(play: Play): string {
  if (play.kind === 'rank') {
    const name = rankLabel(play.rank);
    return play.count === 1 ? `シングル${name}` : `同ランク${name}×${String(play.count)}`;
  }
  const low = rankLabel(play.slots[0]?.rank);
  const high = rankLabel(play.slots[play.slots.length - 1]?.rank);
  const suit = play.suit === undefined ? '' : SUIT_LABELS[play.suit];
  return `階段${suit}${low}-${high}×${String(play.count)}`;
}
