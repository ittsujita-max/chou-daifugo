/**
 * カードとプレイヤーの基本型（docs/spec.md 2.1〜2.2、2.8）。
 */

/** スートに強弱はない（spec 2.1）。並び順は表示とソートの安定化のためだけに使う。 */
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

/**
 * 通常札のランク内部値（spec 2.2）。
 * 3〜10はそのまま、J=11、Q=12、K=13、A=14、2=15。
 */
export const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type Rank = (typeof RANKS)[number];

/** ジョーカーの内部値。通常時・革命時ともに最強（spec 2.2）。 */
export const JOKER_VALUE = 16;

/** ランクの最小値・最大値（通常時の強さの順）。 */
export const MIN_RANK = 3;
export const MAX_RANK = 15;

/** 8切りの8（spec 2.6）。 */
export const RANK_EIGHT = 8;
/** 反則上がりの2、革命時の3（spec 2.7）。 */
export const RANK_TWO = 15;
export const RANK_THREE = 3;

export const RANK_LABELS: Readonly<Record<Rank, string>> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
};

export const SUIT_LABELS: Readonly<Record<Suit, string>> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

/** 2デッキなので同スート同ランクが2枚ある。`a` / `b` で区別する（CLAUDE.md）。 */
export type CardCopy = 'a' | 'b';
export type JokerIndex = 1 | 2 | 3 | 4;

/** カードIDはデッキ番号込みで一意（例：`H5a`、`H5b`、`JK1`〜`JK4`）。 */
export type CardId = string;

export type NormalCard = {
  readonly kind: 'normal';
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
  readonly copy: CardCopy;
};

export type JokerCard = {
  readonly kind: 'joker';
  readonly id: CardId;
  readonly index: JokerIndex;
};

export type Card = NormalCard | JokerCard;

export const PLAYER_COUNT = 4;
/** 席番号。手番は時計回りで 0 → 1 → 2 → 3 → 0（spec 2.5）。 */
export type PlayerIndex = 0 | 1 | 2 | 3;
export const PLAYER_INDEXES: readonly PlayerIndex[] = [0, 1, 2, 3];

/** 階級（spec 2.8）。 */
export const PLAYER_CLASSES = ['daifugo', 'fugo', 'hinmin', 'daihinmin'] as const;
export type PlayerClass = (typeof PLAYER_CLASSES)[number];

export const PLAYER_CLASS_LABELS: Readonly<Record<PlayerClass, string>> = {
  daifugo: '大富豪',
  fugo: '富豪',
  hinmin: '貧民',
  daihinmin: '大貧民',
};

export function isNormalCard(card: Card): card is NormalCard {
  return card.kind === 'normal';
}

export function isJoker(card: Card): card is JokerCard {
  return card.kind === 'joker';
}

export function isPlayerIndex(value: number): value is PlayerIndex {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** 時計回りの次の席（spec 2.5）。 */
export function nextSeat(seat: PlayerIndex): PlayerIndex {
  return ((seat + 1) % PLAYER_COUNT) as PlayerIndex;
}
