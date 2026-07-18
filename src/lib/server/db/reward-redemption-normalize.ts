// src/lib/server/db/reward-redemption-normalize.ts
// #3464: resolvedByParentId の値域正規化 SSOT。
//
// 背景 (#3331 / #3337): resolvedByParentId は cognito sub を保持する TEXT 監査カラムだが、旧
// approve/reject 経路は placeholder として `0` (number) / `'0'` を書いていた。`?? null` は 0 が
// nullish でないため legacy 0 を素通しし、string|null 型に number/`'0'` が紛れる coercion trap になる。
// #3337 は **read 経路 (DynamoDB toRow / SQLite lazy-startup-migration)** で 0/'0' → null に収束させたが、
// restore write (insertRedemptionForRestore) が `input.resolvedByParentId` を verbatim 書込するため、
// legacy 0 を含む旧 backup を復元すると「書込 0 / read null」の物理値ドリフト (#3464 item1) が残っていた。
//
// 本 SSOT を read 正規化と restore write の双方が使うことで、`0` / `'0'` が物理 DB に再混入しない
// (round-trip が物理値レベルで閉じる)。実 parent userId は string 保存のためそのまま String 化する。

/**
 * resolvedByParentId を正規化する。legacy placeholder (`0` / `'0'`) と null/undefined を `null` に、
 * 実 parent id (string / 数値 id) は文字列へ収束させる。read (toRow) と restore write の共通 SSOT。
 */
export function normalizeResolvedByParentId(raw: unknown): string | null {
	if (raw === null || raw === undefined || raw === 0 || raw === '0') return null;
	return String(raw);
}
