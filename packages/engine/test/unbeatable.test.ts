import { describe, expect, it } from 'vitest';

import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { FieldContext } from '../src/unbeatable.js';
import { isUnbeatable } from '../src/unbeatable.js';
import type { Suit } from '../src/types.js';
import { makePlay } from './helpers.js';

const field = (revolution = false, lockedSuit?: Suit): FieldContext => ({
  config: DEFAULT_RULE_CONFIG,
  revolution,
  lockedSuit,
});

const unbeatable = (ids: readonly string[], context = field(), kind?: 'rank' | 'sequence') =>
  isUnbeatable(
    makePlay(ids, {
      revolution: context.revolution,
      ...(kind === undefined ? {} : { kind }),
    }),
    context,
  );

describe('2.5 即流し（同ランク出し）', () => {
  it('ジョーカー2枚のペアは即流し', () => {
    expect(unbeatable(['JK1', 'JK2'], field(), 'rank')).toBe(true);
  });

  it('2のペアは即流しでない（ジョーカーのペアで上回れる）', () => {
    expect(unbeatable(['S2a', 'H2a'])).toBe(false);
  });

  it('2が4枚は即流しでない（ジョーカー4枚で上回れる）', () => {
    expect(unbeatable(['S2a', 'S2b', 'H2a', 'H2b'])).toBe(false);
  });

  it('2が5枚は即流し（ジョーカーは4枚しかない）', () => {
    expect(unbeatable(['S2a', 'S2b', 'H2a', 'H2b', 'D2a'])).toBe(true);
  });

  it('5が6枚は即流しでない（6は8枚あるので6枚組める）', () => {
    expect(unbeatable(['S5a', 'S5b', 'H5a', 'H5b', 'D5a', 'D5b'])).toBe(false);
  });

  it('ジョーカー4枚の同ランク出しは即流し', () => {
    expect(unbeatable(['JK1', 'JK2', 'JK3', 'JK4'], field(), 'rank')).toBe(true);
  });

  it('シングルの2は即流しでない（シングルのジョーカーで上回れる）', () => {
    expect(unbeatable(['S2a'])).toBe(false);
  });

  it('シングルのジョーカーは即流しにしない（スペ3返しの対象だから）', () => {
    expect(unbeatable(['JK1'])).toBe(false);
  });

  it('スペ3返しを切ると、シングルのジョーカーは即流しになる', () => {
    const noReturn: FieldContext = {
      config: { ...DEFAULT_RULE_CONFIG, spade3Return: false },
      revolution: false,
      lockedSuit: undefined,
    };
    expect(unbeatable(['JK1'], noReturn)).toBe(true);
  });

  it('革命中は反転した強さで判定される', () => {
    // 革命中の3は最強の通常札。ペアならジョーカーのペアで上回れる。
    expect(unbeatable(['S3a', 'H3a'], field(true))).toBe(false);
    // 5枚ならジョーカーが足りない。
    expect(unbeatable(['S3a', 'S3b', 'H3a', 'H3b', 'D3a'], field(true))).toBe(true);
    // 通常時の3のペアは上回る手がいくらでもある。
    expect(unbeatable(['S3a', 'H3a'], field(false))).toBe(false);
  });
});

describe('2.5 即流し（階段）', () => {
  it('最強階段（最上段がジョーカー）は即流し', () => {
    // 3枚階段の下端は最大14。
    expect(unbeatable(['SAa', 'S2a', 'JK1'])).toBe(true);
    expect(unbeatable(['JK1', 'JK2', 'JK3'], field(), 'sequence')).toBe(true);
  });

  it('下端が1段でも下なら即流しでない', () => {
    expect(unbeatable(['SKa', 'SAa', 'S2a'])).toBe(false);
    expect(unbeatable(['S5a', 'S6a', 'S7a'])).toBe(false);
  });

  it('枚数が増えると最強階段の下端も下がる', () => {
    // 4枚階段の下端は最大13。
    expect(unbeatable(['SKa', 'SAa', 'S2a', 'JK1'])).toBe(true);
    expect(unbeatable(['SQa', 'SKa', 'SAa', 'S2a'])).toBe(false);
  });

  it('革命中の最強階段も即流し', () => {
    // 革命中は3が最強の通常札。4-3-JK が下端14の3枚階段。
    expect(unbeatable(['S4a', 'S3a', 'JK1'], field(true))).toBe(true);
    expect(unbeatable(['S5a', 'S4a', 'S3a'], field(true))).toBe(false);
  });
});

describe('2.5 即流しと縛り', () => {
  it('縛り中でもジョーカーが縛りスートの代わりになるので判定は変わらない', () => {
    for (const ids of [['S2a', 'S2b'], ['S2a'], ['S6a', 'S6b', 'JK1', 'JK2']]) {
      expect(unbeatable(ids, field(false, 'S'))).toBe(unbeatable(ids, field(false)));
    }
  });

  it('縛り中は同ランクに使える通常札が2枚に減るので、枚数が多いと上回れなくなる', () => {
    // 実戦では縛り中に7枚の同ランク出しは作れない（縛りスートは2枚＋ジョーカー4枚で6枚まで）。
    // 枚数の数え方を固定するための単体テスト。
    const sevenSixes = ['S6a', 'S6b', 'H6a', 'H6b', 'D6a', 'D6b', 'C6a'];
    expect(unbeatable(sevenSixes, field(false))).toBe(false);
    expect(unbeatable(sevenSixes, field(false, 'S'))).toBe(true);
  });
});
