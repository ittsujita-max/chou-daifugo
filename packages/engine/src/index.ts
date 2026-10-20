/**
 * 超大富豪 ルールエンジン。
 *
 * 純粋関数のみ。I/O・DOM・ネットワーク・`Date.now()`・`Math.random()` を使わない。
 * 仕様は docs/spec.md が正。
 *
 * フェーズ0の実装状況
 * - [x] カード構成・強さ（spec 2.1〜2.2）
 * - [x] ルール設定（RuleConfig）とシード付きRNG
 * - [x] 配札
 * - [x] 組み合わせ判定・出す条件（analyzePlay / validatePlay、spec 2.3〜2.4）
 * - [x] 場・手番・場流し・即流し（applyAction / isUnbeatable、spec 2.5）
 * - [x] 特殊ルール（8切り・スペ3返し・革命・縛り、spec 2.6）
 * - [x] 合法手の列挙（getLegalActions）
 * - [x] 反則上がり・順位・都落ち（spec 2.7〜2.8）
 * - [x] カード交換（spec 2.9）
 * - [x] 試合の単位とセットの得点（spec 2.10）
 * - [x] ヒューリスティックCPU（難易度3段階、spec 3）
 */

export * from './result.js';
export * from './types.js';
export * from './cards.js';
export * from './strength.js';
export * from './config.js';
export * from './rng.js';
export * from './deal.js';
export * from './play.js';
export * from './unbeatable.js';
export * from './exchange.js';
export * from './game.js';
export * from './legal.js';
export * from './score.js';
export * from './cpu.js';
