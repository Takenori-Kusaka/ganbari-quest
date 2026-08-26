// src/lib/domain/shop-availability.ts
// ごほうびショップ「いま こうかんできるか」判定 SSOT (#4684)
//
// 背景 (#4684 F3): カード側の交換ボタン活性判定と「いまこうかんできる」フィルタの判定が
// 別々に書かれており、フィルタ側だけが `balance >= points` しか見ていなかった。その結果
// 承認待ち (押せない) のごほうびがフィルタ件数と一覧に混ざり、「3件中 2件」と出ているのに
// 押せるのは 1 件、という状態になっていた。
//
// 判定を本 module の 1 関数に閉じ、カード / フィルタ / 件数バッジが同じ答えを返すことを
// 構造的に保証する (どちらか一方だけ条件が増える再発を型で止める)。

/** 交換可否判定に必要な最小 shape (page load が返す reward の部分集合)。 */
export interface ExchangeCandidate {
	/** ごほうび 1 個あたりの必要ポイント。 */
	points: number;
	/** 最新申請の状態。承認待ちの間は同じごほうびを再申請できない (repo の dedup 契約)。 */
	latestRequestStatus: string | null;
}

/**
 * 「いま押せる」= 残高が足りている **かつ** 承認待ちでない。
 *
 * 承認待ちを除外するのは表示上の都合ではなく、`insertRedemptionRequest` の dedup 契約
 * (同一 child × reward の pending が既存なら DUPLICATE_REQUEST) により実際に申請が通らないため。
 */
export function canExchangeReward(reward: ExchangeCandidate, balance: number): boolean {
	return balance >= reward.points && reward.latestRequestStatus !== 'pending_parent_approval';
}
