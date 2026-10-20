# CLAUDE.md — 超大富豪

トランプ2デッキ（108枚）・4人対戦の大富豪オンラインゲーム。仕様は `docs/spec.md` が正。仕様と矛盾する実装をしない。仕様が曖昧・不足なら、実装前に質問する。

## コミュニケーション

- 返答、コミットメッセージ、コードコメントは日本語
- 作業の区切りごとに「何をしたか・テスト結果・次にやること」を短く報告する

## 現在のフェーズ

**フェーズ0：ルールエンジン**。画面・サーバー・課金には手を付けない。

フェーズ0の完了条件

1. `packages/engine` に spec.md 第2章の全ルールを実装
2. ルールごとの単体テストが全て通る
3. ランダムCPU同士の自動対戦（シード固定）を1万ゲーム回して例外・不正状態が出ない
4. 自動対戦の統計（平均手数、革命回数、大富豪維持率）を出すスクリプト

## 技術スタック

- TypeScript（strict）、Node.js LTS
- pnpm workspace のモノレポ
  - `packages/engine` … ルールエンジン（フェーズ0）
  - `apps/client` … クライアント（フェーズ1〜、PixiJSまたはPhaser）
  - `apps/server` … 対戦サーバー（フェーズ2〜、Colyseus）
- テスト：Vitest
- Lint/Format：ESLint＋Prettier

## ルールエンジンの設計原則

- **純粋関数のみ**。I/O、DOM、ネットワーク、`Date.now()`、`Math.random()` を使わない
- 乱数は引数で受け取るシード付きRNG。同じシードなら同じ結果（リプレイ・テストのため）
- 状態はイミュータブル。`applyAction(state, action) => newState` の形
- 調整可能な値は全て `RuleConfig` に集約し、ハードコードしない
  - 例：`revolutionMinCount: 4`、`blindCards: 0`、`exchange: { top: 3, second: 2 }`、`eightCut: true`、`suitLock: true`、`spade3Return: true`
- 主要API（目安）
  - `createGame(config, seed)` / `deal`
  - `getLegalActions(state, playerId)` … CPU・UIのハイライト・サーバー検証で共通利用
  - `applyAction(state, action)` … 不正な手は型付きエラーを返す（例外で落とさない）
  - `analyzePlay(cards, state)` … 種類・強さ・ジョーカー解釈・8切り判定
  - `isUnbeatable(play, stateAfterPlay)` … 即流し判定。108枚構成から列挙して汎用的に判定し、個別ケースをハードコードしない
  - `checkIllegalFinish(play, stateBeforePlay)` … 反則上がり判定（出す直前の状態で判定）
- プレイヤーごとに見える情報だけを返す `getPlayerView(state, playerId)` を用意（相手の手札を含めない）

## 2デッキで特に注意する点

- 同スート同ランクのカードが2枚ある。カードIDはデッキ番号込みで一意にする（例：`H5a`, `H5b`, `JK1`〜`JK4`）
- 同ランク出しは最大12枚（8枚＋ジョーカー4枚）
- ジョーカー複数入りの階段・同ランク出しの解釈は「成立する中で最強」を自動選択。場が空で数字1枚＋JK2枚の場合のみトリプル／階段をプレイヤーが選ぶ
- 革命4枚以上・革命返しが頻発する前提でテストする

## テスト方針

- spec.md の各ルール（2.3〜2.10）ごとに `describe` を分ける
- 境界ケースを必ず含める：JK同士の重ね禁止、スペ3返しと縛り、8を含む階段、革命を起こす最終手の反則判定、都落ちと反則上がりの組み合わせ、退場者がリードだった場合のスターター決定
- バグ修正時は、再現テストを先に書いてから直す

## やらないこと

- 日本大富豪連盟の公式ルールブックの文章をコードやドキュメントに転載しない（ルールは spec.md の自前の記述に従う）
- 仕様にないルールを勝手に追加しない
- フェーズ0の範囲外（UI、通信、DB）を作らない

## コマンド

```
pnpm install
pnpm test                   # 全パッケージのテスト
pnpm typecheck              # 型チェック
pnpm lint                   # ESLint
pnpm format                 # Prettier（書き換え）
pnpm -F engine test
pnpm -F engine test:watch
pnpm -F engine build
pnpm -F engine sim                   # ランダムCPUの自動対戦（既定10000ゲーム）と統計
pnpm -F engine sim -- --games 1000   # ゲーム数を指定
pnpm -F engine sim -- --seed 7       # シードを指定
```
