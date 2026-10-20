/**
 * 即流しの判定（docs/spec.md 2.5）。
 *
 * 「その出しの直後の状態（革命の反転を含む）で、同種・同枚数で合法に上回れる組み合わせが
 * 108枚の中に理論上存在しない」なら場を流す。
 *
 * 判定は**108枚の構成**から導く。誰が何を持っているか、すでに何が出たかは見ない
 * （仕様の「108枚の構成上」はデッキの構成を指す）。シックスカードやジョーカーペアのような
 * 個別ケースはハードコードせず、上回れる手が組めるかを数えて判定する。
 */

import type { Play, RankPlay, SequencePlay } from './play.js';
import type { RuleConfig } from './config.js';
import { JOKER_COUNT, NORMAL_CARD_COUNT } from './cards.js';
import { rankValue } from './strength.js';
import type { Suit } from './types.js';
import { JOKER_VALUE, RANKS, SUITS } from './types.js';

/** 同スート同ランクが何枚あるか（2デッキなので2枚）。 */
const COPIES_PER_SUIT_RANK = NORMAL_CARD_COUNT / (SUITS.length * RANKS.length);

export type FieldContext = {
  readonly config: RuleConfig;
  /** その出しの直後の革命状態。 */
  readonly revolution: boolean;
  /** その出しの直後の縛りスート。縛り中は縛りスート以外の通常札を混ぜられない。 */
  readonly lockedSuit: Suit | undefined;
};

/**
 * 同ランク出しを上回れる手が組めるか。
 *
 * 同ランクN枚を出すには、そのランクの通常札（縛り中は縛りスートの2枚だけ）とジョーカーで
 * N枚を揃える必要がある。ジョーカーだけの出し（強さ16）も候補に入る。
 */
function canBeatRankPlay(play: RankPlay, context: FieldContext): boolean {
  // シングルのジョーカーはスペ3返しで流される側なので即流しにしない（spec 2.6）。
  // ここで即流しにしてしまうとスペ3返しが一度も発生しなくなる。
  if (play.count === 1 && play.rank === undefined && context.config.spade3Return) {
    return true;
  }

  const suitsUsable = context.lockedSuit === undefined ? SUITS.length : 1;
  const availablePerRank = suitsUsable * COPIES_PER_SUIT_RANK + JOKER_COUNT;

  for (const rank of RANKS) {
    if (rankValue(rank, context.revolution) <= play.value) continue;
    if (availablePerRank >= play.count) return true;
  }

  // ジョーカーだけの同ランク出し。スートを名乗らないので縛り中も出せる。
  return JOKER_VALUE > play.value && JOKER_COUNT >= play.count;
}

/**
 * 階段を上回れる手が組めるか。
 *
 * 枚数が同じ階段の強さは窓の下端で決まり、下端は最大 `JOKER_VALUE - 枚数 + 1`
 * （最上段がジョーカーになる窓）。その窓はどのスートでも通常札とジョーカー1枚で必ず
 * 組めるので、下端を1段でも上に取れるなら上回れる。縛り中でも縛りスートで組めるため
 * 判定は変わらない。
 */
function canBeatSequencePlay(play: SequencePlay): boolean {
  return play.value < JOKER_VALUE - play.count + 1;
}

/** 同種・同枚数で上回れる手が108枚の構成上存在しないなら `true`（場が流れる）。 */
export function isUnbeatable(play: Play, context: FieldContext): boolean {
  return play.kind === 'rank' ? !canBeatRankPlay(play, context) : !canBeatSequencePlay(play);
}
