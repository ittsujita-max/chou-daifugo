/**
 * CPU同士の自動対戦とその統計（docs/spec.md 2.11、CLAUDE.md フェーズ0の完了条件3・4）。
 *
 *   pnpm -F engine sim                            # 上級CPU×4、10000ゲーム
 *   pnpm -F engine sim -- --games 1000            # ゲーム数
 *   pnpm -F engine sim -- --cpu random            # advanced | intermediate | beginner | random
 *   pnpm -F engine sim -- --seed 7                # シード（同じシードなら同じ結果）
 *   pnpm -F engine sim -- --match --games 4000    # 難易度を席に割り当てて強さを比較
 *   pnpm -F engine sim -- --revolution 5          # 革命の成立枚数を変えて比較
 *   pnpm -F engine sim -- --exchange 2,1          # 交換枚数を変えて比較
 */

import type {
  CpuLevel,
  FlushReason,
  GameState,
  PlayerIndex,
  RngState,
  RuleConfig,
} from '../src/index.js';
import {
  DEFAULT_RULE_CONFIG,
  PLAYER_INDEXES,
  advanceSet,
  applyAction,
  chooseAction,
  createRng,
  createSet,
  getLegalActions,
  pendingExchangeSeats,
  pick,
  setRanking,
  validateRuleConfig,
} from '../src/index.js';

/** `random` は合法手から一様ランダム。ルールの総当たり検証用。 */
type Brain = CpuLevel | 'random';

type Options = {
  readonly games: number;
  readonly seed: number;
  readonly brain: Brain;
  readonly match: boolean;
  readonly config: RuleConfig;
};

const BRAINS: readonly Brain[] = ['advanced', 'intermediate', 'beginner', 'random'];

function isBrain(value: string | undefined): value is Brain {
  return value !== undefined && (BRAINS as readonly string[]).includes(value);
}

function parseArgs(argv: readonly string[]): Options {
  let games = 10000;
  let seed = 1;
  let brain: Brain = 'advanced';
  let match = false;
  let config = DEFAULT_RULE_CONFIG;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--match') match = true;
    if (flag === '--games' && next !== undefined) games = Math.max(1, Math.floor(Number(next)));
    if (flag === '--seed' && next !== undefined) seed = Math.floor(Number(next));
    if (flag === '--cpu' && isBrain(next)) brain = next;
    if (flag === '--revolution' && next !== undefined) {
      config = { ...config, revolutionMinCount: Math.floor(Number(next)) };
    }
    if (flag === '--exchange' && next !== undefined) {
      const [top, second] = next.split(',').map((part) => Math.floor(Number(part)));
      if (top !== undefined && second !== undefined) {
        config = { ...config, exchange: { top, second } };
      }
    }
  }

  if (!Number.isFinite(games) || !Number.isFinite(seed)) {
    fail('--games と --seed は数値で指定する');
  }
  const validated = validateRuleConfig(config);
  if (!validated.ok) fail(`ルール設定が不正：${JSON.stringify(validated.error)}`);

  return { games, seed, brain, match, config };
}

function fail(message: string): never {
  console.error(`自動対戦で異常：${message}`);
  process.exit(1);
}

type Stats = {
  games: number;
  sets: number;
  actions: number;
  plays: number;
  passes: number;
  revolutions: number;
  illegalFinishes: number;
  fallen: number;
  topKept: number;
  topChances: number;
  legalActions: number;
  legalSamples: number;
  flushes: Record<FlushReason, number>;
  /** 席ではなく頭脳ごとの成績。 */
  points: Record<Brain, number>;
  tops: Record<Brain, number>;
  gamesPlayed: Record<Brain, number>;
};

function emptyStats(): Stats {
  const zero = (): Record<Brain, number> => ({
    advanced: 0,
    intermediate: 0,
    beginner: 0,
    random: 0,
  });
  return {
    games: 0,
    sets: 0,
    actions: 0,
    plays: 0,
    passes: 0,
    revolutions: 0,
    illegalFinishes: 0,
    fallen: 0,
    topKept: 0,
    topChances: 0,
    legalActions: 0,
    legalSamples: 0,
    flushes: { allPassed: 0, eightCut: 0, spade3Return: 0, unbeatable: 0 },
    points: zero(),
    tops: zero(),
    gamesPlayed: zero(),
  };
}

type Seating = Readonly<Record<PlayerIndex, Brain>>;

function decide(
  state: GameState,
  seat: PlayerIndex,
  brain: Brain,
  rng: RngState,
  stats: Stats,
): { action: ReturnType<typeof getLegalActions>[number]; rng: RngState } {
  if (brain === 'random') {
    const legal = getLegalActions(state, seat);
    if (state.phase === 'playing') {
      stats.legalActions += legal.length;
      stats.legalSamples += 1;
    }
    const [choice, next] = pick(legal, rng);
    if (choice === undefined) fail(`合法手がない（席 ${String(seat)}）`);
    return { action: choice, rng: next };
  }

  if (state.phase === 'playing') {
    stats.legalActions += getLegalActions(state, seat).length;
    stats.legalSamples += 1;
  }
  const decision = chooseAction(state, seat, brain, rng);
  if (decision === undefined) fail(`CPUが手を選べない（席 ${String(seat)}）`);
  return { action: decision.action, rng: decision.rng };
}

function runGame(
  start: GameState,
  seating: Seating,
  rngIn: RngState,
  stats: Stats,
): { state: GameState; rng: RngState } {
  let state = start;
  let rng = rngIn;

  // 交換（spec 2.9）。同時なので手番を見ない。
  for (const seat of pendingExchangeSeats(state)) {
    const decided = decide(state, seat, seating[seat], rng, stats);
    rng = decided.rng;
    const result = applyAction(state, decided.action);
    if (!result.ok) fail(`交換が通らない：${JSON.stringify(result.error)}`);
    state = result.value;
    stats.actions += 1;
  }
  if (state.phase === 'exchange') fail('交換が終わらない');

  const dealt = PLAYER_INDEXES.reduce<number>(
    (total, seat) => total + state.players[seat].hand.length,
    0,
  );

  let guard = 0;
  while (state.phase === 'playing') {
    guard += 1;
    if (guard > 5000) fail('ゲームが終わらない');

    const seat = state.turn;
    const decided = decide(state, seat, seating[seat], rng, stats);
    rng = decided.rng;

    const result = applyAction(state, decided.action);
    if (!result.ok) fail(`選んだ手が出せない：${JSON.stringify(result.error)}`);

    stats.actions += 1;
    if (decided.action.type === 'play') stats.plays += 1;
    if (decided.action.type === 'pass') stats.passes += 1;

    const before = state.revolution;
    state = result.value;
    if (state.revolution !== before) stats.revolutions += 1;
    if (state.lastFlush !== undefined) stats.flushes[state.lastFlush] += 1;
  }

  const ranking = state.ranking;
  if (ranking === undefined || new Set(ranking).size !== PLAYER_INDEXES.length) {
    fail(`順位が確定しない：${JSON.stringify(ranking)}`);
  }
  if (dealt !== 108 - state.blind.length) fail(`配札枚数が合わない：${String(dealt)}`);

  stats.games += 1;
  stats.illegalFinishes += state.illegalFinishOrder.length;
  if (state.fallenSeat !== undefined) stats.fallen += 1;

  return { state, rng };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const stats = emptyStats();
  let rng = createRng(options.seed);
  let setSeed = options.seed;
  const started = Date.now();

  while (stats.games < options.games) {
    // 席順の有利不利を打ち消すため、セットごとに頭脳の割り当てを回す。
    const offset = stats.sets % PLAYER_INDEXES.length;
    const seating = Object.fromEntries(
      PLAYER_INDEXES.map((seat) => [
        seat,
        options.match ? (BRAINS[(seat + offset) % BRAINS.length] ?? 'random') : options.brain,
      ]),
    ) as Seating;

    const created = createSet(options.config, setSeed);
    setSeed += 1;
    if (!created.ok) fail(`セットを開始できない：${JSON.stringify(created.error)}`);

    let set = created.value;
    let previousTop: PlayerIndex | undefined;

    for (;;) {
      const played = runGame(set.game, seating, rng, stats);
      rng = played.rng;

      const ranking = played.state.ranking ?? [];
      const top = ranking[0];
      if (previousTop !== undefined && top !== undefined) {
        stats.topChances += 1;
        if (top === previousTop) stats.topKept += 1;
      }
      previousTop = top;

      for (const seat of PLAYER_INDEXES) stats.gamesPlayed[seating[seat]] += 1;
      if (top !== undefined) stats.tops[seating[top]] += 1;

      const advanced = advanceSet({ ...set, game: played.state });
      if (!advanced.ok) fail(`セットを進められない：${JSON.stringify(advanced.error)}`);
      set = advanced.value;
      if (set.phase === 'finished') break;
    }

    for (const seat of PLAYER_INDEXES) stats.points[seating[seat]] += set.totals[seat];
    stats.sets += 1;
    if (setRanking(set).length !== PLAYER_INDEXES.length) fail('セット順位が壊れている');
  }

  report(options, stats, Date.now() - started);
}

function report(options: Options, stats: Stats, ms: number): void {
  const per = (value: number): string => (value / stats.games).toFixed(2);
  const rate = (hit: number, total: number): string =>
    total === 0 ? '—' : `${((hit / total) * 100).toFixed(1)}%`;
  const { config } = options;

  console.log(
    `設定           革命${String(config.revolutionMinCount)}枚 / 交換${String(config.exchange.top)}-${String(config.exchange.second)}枚 / 伏せ札${String(config.blindCards)}枚`,
  );
  console.log(`CPU            ${options.match ? '難易度対戦（席を回して割当）' : options.brain}`);
  console.log(`シード         ${String(options.seed)}`);
  console.log(
    `規模           ${String(stats.games)}ゲーム（${String(stats.sets)}セット）／${String(ms)}ms（${(ms / stats.games).toFixed(2)}ms per game）`,
  );
  console.log('');
  console.log(
    `平均手数       ${per(stats.actions)}（出す ${per(stats.plays)} / パス ${per(stats.passes)}）`,
  );
  console.log(`革命回数       ${per(stats.revolutions)} per game`);
  console.log(
    `場流し         全員パス ${per(stats.flushes.allPassed)} / 8切り ${per(stats.flushes.eightCut)} / 即流し ${per(stats.flushes.unbeatable)} / スペ3返し ${per(stats.flushes.spade3Return)}`,
  );
  console.log(`反則上がり     ${per(stats.illegalFinishes)} per game`);
  console.log(`都落ち率       ${rate(stats.fallen, stats.games)}`);
  console.log(
    `大富豪維持率   ${rate(stats.topKept, stats.topChances)}（${String(stats.topChances)}回中 ${String(stats.topKept)}回）`,
  );
  console.log(
    `1手の合法手    ${(stats.legalActions / Math.max(1, stats.legalSamples)).toFixed(1)}`,
  );

  if (options.match) {
    console.log('');
    console.log('難易度別の成績（席を回しているので席順の有利は打ち消されている）');
    for (const brain of BRAINS) {
      const games = stats.gamesPlayed[brain];
      if (games === 0) continue;
      const average = (stats.points[brain] / (games / config.gamesPerSet)).toFixed(2);
      console.log(
        `  ${brain.padEnd(13)} セット平均 ${average}点 / 大富豪率 ${rate(stats.tops[brain], games)}`,
      );
    }
  } else {
    console.log('');
    console.log('※全席が同じ頭脳。調整値は難易度対戦（--match）の結果と併せて判断する。');
  }
}

main();
