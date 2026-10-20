/** テスト用のカード取得と状態組み立て。ルールエンジン本体には含めない。 */

import { createDeck, indexById } from '../src/cards.js';
import type { RuleConfig } from '../src/config.js';
import { DEFAULT_RULE_CONFIG } from '../src/config.js';
import type { GameState, PlayerState } from '../src/game.js';
import type { Play, PlayContext, PlayKind } from '../src/play.js';
import { analyzePlay, interpretationOf } from '../src/play.js';
import { createRng } from '../src/rng.js';
import type { Card, PlayerIndex, Suit } from '../src/types.js';
import { PLAYER_INDEXES } from '../src/types.js';

const deckById = indexById(createDeck());

export function card(id: string): Card {
  const found = deckById.get(id);
  if (found === undefined) throw new Error(`不明なカードID：${id}`);
  return found;
}

export function cards(...ids: readonly string[]): readonly Card[] {
  return ids.map(card);
}

export function ctx(revolution = false, config: RuleConfig = DEFAULT_RULE_CONFIG): PlayContext {
  return { config, revolution };
}

export type MakePlayOptions = {
  readonly revolution?: boolean;
  readonly config?: RuleConfig;
  /** 同ランク出しと階段の両方に解釈できるときの指定。 */
  readonly kind?: PlayKind;
};

/** テスト用に組み合わせを組み立てる。成立しなければ例外。 */
export function makePlay(ids: readonly string[], options: MakePlayOptions = {}): Play {
  const context = ctx(options.revolution ?? false, options.config ?? DEFAULT_RULE_CONFIG);
  const analyzed = analyzePlay(cards(...ids), context);
  if (!analyzed.ok) throw new Error(`組み合わせが成立しない：${JSON.stringify(analyzed.error)}`);
  const kind = options.kind;
  if (kind !== undefined) {
    const chosen = interpretationOf(analyzed.value, kind);
    if (chosen === undefined) throw new Error(`${kind} として解釈できない`);
    return chosen;
  }
  const [only, ...rest] = analyzed.value.interpretations;
  if (only === undefined) throw new Error('組み合わせが成立しない');
  if (rest.length > 0) throw new Error('解釈が複数ある。kind を指定する');
  return only;
}

export type GameOptions = {
  /** 席ごとの手札。省略した席は手札なし。 */
  readonly hands: Readonly<Partial<Record<PlayerIndex, readonly string[]>>>;
  readonly turn?: PlayerIndex;
  readonly field?: {
    readonly ids: readonly string[];
    readonly leader: PlayerIndex;
    readonly kind?: PlayKind;
  };
  readonly revolution?: boolean;
  readonly lockedSuit?: Suit;
  readonly config?: RuleConfig;
  readonly passed?: readonly PlayerIndex[];
  readonly finished?: readonly PlayerIndex[];
  readonly finishOrder?: readonly PlayerIndex[];
  readonly illegalFinishOrder?: readonly PlayerIndex[];
  readonly fallenSeat?: PlayerIndex;
  readonly previousTopSeat?: PlayerIndex;
};

/** ルールのテスト用に、手札と場を指定した状態を直接組み立てる。 */
export function gameWith(options: GameOptions): GameState {
  const config = options.config ?? DEFAULT_RULE_CONFIG;
  const revolution = options.revolution ?? false;
  const finished = options.finished ?? [];
  const passed = options.passed ?? [];

  const players = Object.fromEntries(
    PLAYER_INDEXES.map((seat) => [
      seat,
      {
        hand: cards(...(options.hands[seat] ?? [])),
        passed: passed.includes(seat),
        finished: finished.includes(seat),
      } satisfies PlayerState,
    ]),
  ) as Record<PlayerIndex, PlayerState>;

  const field =
    options.field === undefined
      ? undefined
      : {
          play: makePlay(options.field.ids, {
            revolution,
            config,
            ...(options.field.kind === undefined ? {} : { kind: options.field.kind }),
          }),
          leader: options.field.leader,
        };

  return {
    config,
    players,
    turn: options.turn ?? 0,
    field,
    lockedSuit: options.lockedSuit,
    revolution,
    finishOrder: options.finishOrder ?? finished,
    illegalFinishOrder: options.illegalFinishOrder ?? [],
    fallenSeat: options.fallenSeat,
    previousTopSeat: options.previousTopSeat,
    ranking: undefined,
    blind: [],
    exchange: undefined,
    phase: 'playing',
    lastFlush: undefined,
    rng: createRng(0),
  };
}
