/**
 * 試合の単位と得点（docs/spec.md 2.10）。
 *
 * - 1セット＝`gamesPerSet` ゲーム（既定4）。段位戦の1試合＝1セット
 * - セット最初のゲームは階級なし。スターターは席順で決める（♠席）
 * - 2ゲーム目以降は前ゲームの大貧民がスターターで、カード交換から始まる
 * - 得点：大富豪6、富豪4、貧民2、大貧民0。セット最終ゲームのみ大富豪に+2
 * - セット順位は累計点。同点は最終ゲームの順位が上の人
 */

import type { PlayerIndex } from './types.js';
import { PLAYER_CLASSES, PLAYER_INDEXES } from './types.js';
import type { RuleConfig } from './config.js';
import type { GameState } from './game.js';
import { createGame } from './game.js';
import type { DealError } from './deal.js';
import type { RngState } from './rng.js';
import { createRng, nextUint32 } from './rng.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

export type Points = Readonly<Record<PlayerIndex, number>>;

const ZERO_POINTS: Points = { 0: 0, 1: 0, 2: 0, 3: 0 };

/** 1ゲームの得点。`finalGame` がtrueなら大富豪に `finalGameTopBonus` を加える。 */
export function gamePoints(
  ranking: readonly PlayerIndex[],
  config: RuleConfig,
  finalGame: boolean,
): Points {
  const points = { ...ZERO_POINTS } as Record<PlayerIndex, number>;
  ranking.forEach((seat, place) => {
    const playerClass = PLAYER_CLASSES[place];
    if (playerClass === undefined) return;
    const bonus = finalGame && place === 0 ? config.finalGameTopBonus : 0;
    points[seat] = config.classPoints[playerClass] + bonus;
  });
  return points;
}

function addPoints(a: Points, b: Points): Points {
  return Object.fromEntries(PLAYER_INDEXES.map((seat) => [seat, a[seat] + b[seat]])) as Record<
    PlayerIndex,
    number
  >;
}

export type SetGameResult = {
  readonly gameNumber: number;
  readonly ranking: readonly PlayerIndex[];
  readonly points: Points;
};

export type SetState = {
  readonly config: RuleConfig;
  /** 進行中のゲーム番号（1始まり）。 */
  readonly gameNumber: number;
  readonly game: GameState;
  readonly results: readonly SetGameResult[];
  readonly totals: Points;
  readonly phase: 'playing' | 'finished';
  readonly rng: RngState;
};

export type SetError =
  | { readonly code: 'gameNotFinished' }
  | { readonly code: 'setFinished' }
  | { readonly code: 'rankingMissing' }
  | { readonly code: 'dealFailed'; readonly error: DealError };

/**
 * セットを開始する。最初のゲームは階級なし・交換なしで、スターターは席順で決める
 * （spec 2.10 の♠席。既定は席0）。
 */
export function createSet(
  config: RuleConfig,
  seed: number,
  startSeat: PlayerIndex = 0,
): Result<SetState, SetError> {
  const [gameSeed, rng] = nextUint32(createRng(seed));
  const game = createGame(config, gameSeed, { starter: startSeat });
  if (!game.ok) return err({ code: 'dealFailed', error: game.error });

  return ok({
    config,
    gameNumber: 1,
    game: game.value,
    results: [],
    totals: ZERO_POINTS,
    phase: 'playing',
    rng,
  });
}

/**
 * 決着したゲームの得点を記録し、次のゲームを始める（最終ゲームならセットを終える）。
 * 次のゲームは前ゲームの大貧民がスターターで、カード交換から始まる（spec 2.9〜2.10）。
 */
export function advanceSet(set: SetState): Result<SetState, SetError> {
  if (set.phase === 'finished') return err({ code: 'setFinished' });
  if (set.game.phase !== 'finished') return err({ code: 'gameNotFinished' });

  const ranking = set.game.ranking;
  if (ranking === undefined) return err({ code: 'rankingMissing' });

  const finalGame = set.gameNumber >= set.config.gamesPerSet;
  const points = gamePoints(ranking, set.config, finalGame);
  const results = [...set.results, { gameNumber: set.gameNumber, ranking, points }];
  const totals = addPoints(set.totals, points);

  if (finalGame) {
    return ok({ ...set, results, totals, phase: 'finished' });
  }

  const [gameSeed, rng] = nextUint32(set.rng);
  const bottom = ranking[PLAYER_INDEXES.length - 1];
  const next = createGame(set.config, gameSeed, {
    ...(bottom === undefined ? {} : { starter: bottom }),
    previousRanking: ranking,
  });
  if (!next.ok) return err({ code: 'dealFailed', error: next.error });

  return ok({
    ...set,
    gameNumber: set.gameNumber + 1,
    game: next.value,
    results,
    totals,
    rng,
  });
}

/**
 * セット順位（上位から）。累計点の高い順で、同点は最終ゲームの順位が上の人が上
 * （spec 2.10）。
 */
export function setRanking(set: SetState): readonly PlayerIndex[] {
  const lastGame = set.results[set.results.length - 1]?.ranking ?? [];
  const placeInLastGame = (seat: PlayerIndex): number => {
    const place = lastGame.indexOf(seat);
    return place < 0 ? PLAYER_INDEXES.length : place;
  };

  return [...PLAYER_INDEXES].sort((a, b) => {
    const byPoints = set.totals[b] - set.totals[a];
    return byPoints !== 0 ? byPoints : placeInLastGame(a) - placeInLastGame(b);
  });
}
