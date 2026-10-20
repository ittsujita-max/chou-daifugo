import { describe, expect, it } from 'vitest';

import { createDeck, indexById } from '../src/cards.js';
import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { Play, PlayContext, PlayError, PlayKind } from '../src/play.js';
import { analyzePlay, formatPlay, validatePlay } from '../src/play.js';
import type { Result } from '../src/result.js';
import { JOKER_VALUE } from '../src/types.js';

const byId = indexById(createDeck());
const c = (...ids: readonly string[]) => ids.map((id) => byId.get(id)!);

const ctx = (revolution = false): PlayContext => ({ config: DEFAULT_RULE_CONFIG, revolution });

/** 場が空のときに成立する組み合わせを取り出す。 */
const leadWith = (ids: readonly string[], revolution = false, kind?: PlayKind): Play => {
  const result = validatePlay(c(...ids), undefined, ctx(revolution), kind);
  if (!result.ok) throw new Error(`出せない：${JSON.stringify(result.error)}`);
  return result.value;
};

const errorOf = <T>(result: Result<T, PlayError>): PlayError => {
  if (result.ok) throw new Error('エラーになるはずが成立した');
  return result.error;
};

const codeOf = <T>(result: Result<T, PlayError>): string => errorOf(result).code;

describe('2.3 シングル', () => {
  it('1枚はそのカードの強さで出せる', () => {
    const play = leadWith(['H5a']);
    expect(play.kind).toBe('rank');
    expect(play.count).toBe(1);
    expect(play.value).toBe(5);
    if (play.kind === 'rank') expect(play.rank).toBe(5);
  });

  it('シングルのジョーカーは他のランクを名乗らず最強', () => {
    const play = leadWith(['JK1']);
    expect(play.kind).toBe('rank');
    expect(play.value).toBe(JOKER_VALUE);
    expect(play.jokerCount).toBe(1);
    if (play.kind === 'rank') expect(play.rank).toBeUndefined();
    expect(formatPlay(play)).toBe('シングルJK');
  });
});

describe('2.3 同ランク出し', () => {
  it('ペア・トリプルが成立し、強さはそのランク', () => {
    expect(leadWith(['H5a', 'S5a']).value).toBe(5);
    expect(leadWith(['H5a', 'S5a', 'D5a']).count).toBe(3);
  });

  it('同スート同ランクの2枚（♥5×2）もペアとして有効', () => {
    const play = leadWith(['H5a', 'H5b']);
    expect(play.kind).toBe('rank');
    expect(play.count).toBe(2);
    expect(play.value).toBe(5);
  });

  it('ジョーカーが不足分を補う', () => {
    const play = leadWith(['H5a', 'JK1']);
    expect(play.value).toBe(5);
    expect(play.jokerCount).toBe(1);
    expect(formatPlay(play)).toBe('同ランク5×2');
  });

  it('同ランク8枚＋ジョーカー4枚の12枚出しまで出せる', () => {
    const play = leadWith([
      'S5a',
      'S5b',
      'H5a',
      'H5b',
      'D5a',
      'D5b',
      'C5a',
      'C5b',
      'JK1',
      'JK2',
      'JK3',
      'JK4',
    ]);
    expect(play.count).toBe(12);
    expect(play.value).toBe(5);
    expect(play.jokerCount).toBe(4);
  });

  it('ジョーカーだけの出しはランクを持たず強さ16（ジョーカー2枚のペア）', () => {
    const play = leadWith(['JK1', 'JK2']);
    expect(play.kind).toBe('rank');
    expect(play.count).toBe(2);
    expect(play.value).toBe(JOKER_VALUE);
    if (play.kind === 'rank') expect(play.rank).toBeUndefined();
  });

  it('設定した上限枚数を超えたら tooManyCards', () => {
    const limited: PlayContext = {
      config: { ...DEFAULT_RULE_CONFIG, maxSameRankCount: 4 },
      revolution: false,
    };
    const result = validatePlay(c('S5a', 'S5b', 'H5a', 'H5b', 'D5a'), undefined, limited);
    expect(codeOf(result)).toBe('tooManyCards');
    expect(validatePlay(c('S5a', 'S5b', 'H5a', 'H5b'), undefined, limited).ok).toBe(true);
  });

  it('ランクが混ざると出せない', () => {
    expect(codeOf(validatePlay(c('H5a', 'H6a'), undefined, ctx()))).toBe('notACombination');
  });
});

describe('2.3 階段', () => {
  it('同一スートで連続する3枚が成立し、強さは最弱のカード', () => {
    const play = leadWith(['S5a', 'S6a', 'S7a']);
    expect(play.kind).toBe('sequence');
    expect(play.count).toBe(3);
    expect(play.value).toBe(5);
    if (play.kind === 'sequence') expect(play.suit).toBe('S');
    expect(formatPlay(play)).toBe('階段♠5-7×3');
  });

  it('3枚未満は階段にならない', () => {
    expect(codeOf(validatePlay(c('S5a', 'S6a'), undefined, ctx()))).toBe('notACombination');
  });

  it('連続は強さの順で判定する：Q-K-A と K-A-2 は成立、A-2-3 は不成立', () => {
    expect(leadWith(['SQa', 'SKa', 'SAa']).value).toBe(12);
    expect(leadWith(['SKa', 'SAa', 'S2a']).value).toBe(13);
    expect(codeOf(validatePlay(c('SAa', 'S2a', 'S3a'), undefined, ctx()))).toBe('notACombination');
  });

  it('革命時も強さの順で連続する（Q-K-A は成立し、A が最弱になる）', () => {
    const play = leadWith(['SQa', 'SKa', 'SAa'], true);
    expect(play.kind).toBe('sequence');
    expect(play.value).toBe(4);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.rank)).toEqual([14, 13, 12]);
    }
    expect(formatPlay(play)).toBe('階段♠A-Q×3');
  });

  it('スートが混ざると階段にならない', () => {
    expect(codeOf(validatePlay(c('S5a', 'H6a', 'S7a'), undefined, ctx()))).toBe('notACombination');
  });

  it('同じ段は二度使えない（♠5×2を含む階段は不成立）', () => {
    expect(codeOf(validatePlay(c('S5a', 'S5b', 'S6a'), undefined, ctx()))).toBe('notACombination');
  });

  it('ジョーカーが途中を補う', () => {
    const play = leadWith(['S5a', 'S7a', 'JK1']);
    expect(play.value).toBe(5);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.card.id)).toEqual(['S5a', 'JK1', 'S7a']);
      expect(play.slots.map((slot) => slot.rank)).toEqual([5, 6, 7]);
    }
  });

  it('ジョーカーが端を補い、解釈が複数あるときは最も強い窓を採る', () => {
    // ♠5 ♠6 ＋JK は 4-5-6 とも 5-6-7 とも解釈できる。強い方（5-6-7）を採る。
    const play = leadWith(['S5a', 'S6a', 'JK1']);
    expect(play.value).toBe(5);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.rank)).toEqual([5, 6, 7]);
      expect(play.slots[2]?.card.id).toBe('JK1');
    }

    const higher = leadWith(['S6a', 'S7a', 'JK1']);
    expect(higher.value).toBe(6);
    if (higher.kind === 'sequence') {
      expect(higher.slots.map((slot) => slot.rank)).toEqual([6, 7, 8]);
    }
  });

  it('ジョーカーは通常時は2の上に最上段として置ける（A-2-JK）', () => {
    const play = leadWith(['SAa', 'S2a', 'JK1']);
    expect(play.value).toBe(14);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.rank)).toEqual([14, 15, undefined]);
      expect(play.slots[2]?.card.id).toBe('JK1');
    }
    expect(formatPlay(play)).toBe('階段♠A-JK×3');
  });

  it('革命時は3の上に最上段として置ける（5-4-3-JK）', () => {
    const play = leadWith(['S5a', 'S4a', 'S3a', 'JK1'], true);
    expect(play.count).toBe(4);
    expect(play.value).toBe(13);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.rank)).toEqual([5, 4, 3, undefined]);
    }
  });

  it('ジョーカーだけの階段はスートを名乗らず、取れる窓の上限を取る', () => {
    const play = leadWith(['JK1', 'JK2', 'JK3'], false, 'sequence');
    expect(play.kind).toBe('sequence');
    // 3枚階段の下端は最大14（窓は A-2-JKの段）。これが3枚階段の到達できる最大の強さ。
    expect(play.value).toBe(14);
    if (play.kind === 'sequence') {
      expect(play.suit).toBeUndefined();
      expect(play.slots.map((slot) => slot.rank)).toEqual([14, 15, undefined]);
    }
    expect(formatPlay(play)).toBe('階段A-JK×3');
  });

  it('ジョーカー4枚の階段は下端13', () => {
    const play = leadWith(['JK1', 'JK2', 'JK3', 'JK4'], false, 'sequence');
    expect(play.value).toBe(13);
    if (play.kind === 'sequence') {
      expect(play.slots.map((slot) => slot.rank)).toEqual([13, 14, 15, undefined]);
    }
  });

  it('ジョーカーだけの出しは同ランク出しとも階段とも解釈できる', () => {
    const analyzed = analyzePlay(c('JK1', 'JK2', 'JK3'), ctx());
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      expect([...analyzed.value.interpretations.map((play) => play.kind)].sort()).toEqual([
        'rank',
        'sequence',
      ]);
      expect(analyzed.value.ambiguous).toBe(true);
    }
  });

  it('ジョーカー2枚は階段の最小枚数に届かないので同ランク出しだけ', () => {
    const analyzed = analyzePlay(c('JK1', 'JK2'), ctx());
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      expect(analyzed.value.interpretations.map((play) => play.kind)).toEqual(['rank']);
      expect(analyzed.value.ambiguous).toBe(false);
    }
  });
});

describe('2.4 出す条件', () => {
  it('場が空なら任意の合法な組み合わせを出せる', () => {
    expect(validatePlay(c('S5a'), undefined, ctx()).ok).toBe(true);
    expect(validatePlay(c('S5a', 'S6a', 'S7a'), undefined, ctx()).ok).toBe(true);
  });

  it('同じ種類・同じ枚数でないと出せない', () => {
    const pair = leadWith(['H5a', 'S5a']);
    expect(codeOf(validatePlay(c('H6a'), pair, ctx()))).toBe('kindMismatch');
    expect(codeOf(validatePlay(c('H6a', 'S6a', 'D6a'), pair, ctx()))).toBe('kindMismatch');

    const sequence = leadWith(['S5a', 'S6a', 'S7a']);
    expect(codeOf(validatePlay(c('H6a', 'S6a', 'D6a'), sequence, ctx()))).toBe('kindMismatch');
  });

  it('より強いものだけ出せる', () => {
    const pair = leadWith(['H5a', 'S5a']);
    expect(validatePlay(c('H6a', 'S6a'), pair, ctx()).ok).toBe(true);
    expect(codeOf(validatePlay(c('H4a', 'S4a'), pair, ctx()))).toBe('notStrongEnough');
  });

  it('同じ強さは出せない（♥5に♠5も、♥5に♥5も出せない）', () => {
    const single = leadWith(['H5a']);
    expect(codeOf(validatePlay(c('S5a'), single, ctx()))).toBe('notStrongEnough');
    expect(codeOf(validatePlay(c('H5b'), single, ctx()))).toBe('notStrongEnough');
  });

  it('シングルのジョーカーにジョーカー単体は重ねられない', () => {
    const jokerSingle = leadWith(['JK1']);
    expect(codeOf(validatePlay(c('JK2'), jokerSingle, ctx()))).toBe('jokerOnJoker');
  });

  it('シングルのジョーカーは通常のカードでも上回れない', () => {
    const jokerSingle = leadWith(['JK1']);
    expect(codeOf(validatePlay(c('S2a'), jokerSingle, ctx()))).toBe('notStrongEnough');
  });

  it('場にカードがあるときは、場の種類に合う解釈が選ばれる', () => {
    const ambiguous = ['H6a', 'JK1', 'JK2'];

    const triple = leadWith(['H5a', 'S5a', 'D5a']);
    const asRank = validatePlay(c(...ambiguous), triple, ctx());
    expect(asRank.ok).toBe(true);
    if (asRank.ok) {
      expect(asRank.value.kind).toBe('rank');
      expect(asRank.value.value).toBe(6);
    }

    const sequence = leadWith(['S5a', 'S6a', 'S7a']);
    const asSequence = validatePlay(c(...ambiguous), sequence, ctx());
    expect(asSequence.ok).toBe(true);
    if (asSequence.ok) {
      expect(asSequence.value.kind).toBe('sequence');
      expect(asSequence.value.value).toBe(6);
    }
  });

  it('場が空でトリプルと階段の両方に解釈できる出しはプレイヤーが選ぶ', () => {
    const cards = c('H6a', 'JK1', 'JK2');
    const error = errorOf(validatePlay(cards, undefined, ctx()));
    expect(error.code).toBe('ambiguousInterpretation');
    if (error.code === 'ambiguousInterpretation') {
      expect([...error.kinds].sort()).toEqual(['rank', 'sequence']);
    }

    expect(leadWith(['H6a', 'JK1', 'JK2'], false, 'rank').kind).toBe('rank');
    expect(leadWith(['H6a', 'JK1', 'JK2'], false, 'sequence').kind).toBe('sequence');
  });

  it('解釈が1通りなら場が空でも選択は要らない', () => {
    expect(validatePlay(c('S5a', 'S6a', 'S7a'), undefined, ctx()).ok).toBe(true);
    expect(validatePlay(c('H5a', 'S5a', 'D5a'), undefined, ctx()).ok).toBe(true);
  });

  it('指定した種類に解釈できなければ kindMismatch', () => {
    const result = validatePlay(c('H5a', 'S5a', 'D5a'), undefined, ctx(), 'sequence');
    expect(codeOf(result)).toBe('kindMismatch');
  });

  it('階段は最弱のカードで比較する（スートは問わない）', () => {
    const sequence = leadWith(['S5a', 'S6a', 'S7a']);
    expect(validatePlay(c('H6a', 'H7a', 'H8a'), sequence, ctx()).ok).toBe(true);
    expect(codeOf(validatePlay(c('H4a', 'H5a', 'H6a'), sequence, ctx()))).toBe('notStrongEnough');
  });

  it('3枚階段にジョーカー3枚で勝てる', () => {
    const sequence = leadWith(['S5a', 'S6a', 'S7a']);
    const result = validatePlay(c('JK1', 'JK2', 'JK3'), sequence, ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('sequence');
      expect(result.value.value).toBe(14);
    }

    // 強さ14の階段（3枚階段の上限）同士は同値禁止で上回れない。
    // ただしこの強さの階段は即流しになるので、場に残ることはない。
    const strongest = leadWith(['SAa', 'S2a', 'JK1']);
    expect(codeOf(validatePlay(c('JK2', 'JK3', 'JK4'), strongest, ctx()))).toBe('notStrongEnough');
  });

  it('革命時は強弱が反転して比較される', () => {
    const singleAce = leadWith(['SAa'], true);
    expect(validatePlay(c('SKa'), singleAce, ctx(true)).ok).toBe(true);
    expect(codeOf(validatePlay(c('S2a'), singleAce, ctx(true)))).toBe('notStrongEnough');

    const normalAce = leadWith(['SAa']);
    expect(codeOf(validatePlay(c('SKa'), normalAce, ctx()))).toBe('notStrongEnough');
    expect(validatePlay(c('S2a'), normalAce, ctx()).ok).toBe(true);
  });
});

describe('入力の検証', () => {
  it('0枚は出せない', () => {
    expect(codeOf(validatePlay([], undefined, ctx()))).toBe('noCards');
  });

  it('同じカードを2回含む出しは弾く', () => {
    const card = byId.get('H5a')!;
    const error = errorOf(validatePlay([card, card], undefined, ctx()));
    expect(error.code).toBe('duplicateCards');
    if (error.code === 'duplicateCards') expect(error.ids).toEqual(['H5a']);
  });
});
