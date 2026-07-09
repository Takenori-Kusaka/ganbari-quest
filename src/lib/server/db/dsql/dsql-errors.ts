// src/lib/server/db/dsql/dsql-errors.ts
// EPIC #3424 / M4-E item 11 (#3435) / 設計 SSOT: dsql-data-model.md §8 / m4-implementation-plan.md §3.8-11
//
// DSQL エラー分類の **単一集約点** (§3.8 item 11「40001/23505/rowCount=0 分岐」の分類層)。
// service 層 (cutover 配線) は raw pg error を直接判定せず、必ず本 module 経由で分岐する:
//
//   | シグナル | 意味 | 扱い |
//   |---|---|---|
//   | 40001 (OC000) | OCC write-write 競合 | runner (withOccRetry) が txn 全体を bounded retry。
//   |               |                      | service には通常届かない (上限超過時のみ) |
//   | 23505         | UNIQUE 違反 (owner_guard / email_lower / weekly_auto_guard / 複合 PK) | **business
//   |               | error。retry 禁止** (二重付与化する)。constraint 名で domain error に写像 |
//   | 23514         | CHECK 違反 (enum SSOT 逸脱) | 入力バグ。retry 禁止、validation 層の欠陥として扱う |
//   | rowCount=0    | 条件付き UPDATE の状態遷移不成立 | エラーでない。repo が RETURNING 行数で返す
//   |               | (claimReward / completeMission 等)。service は戻り値で分岐 |
//
// 40001 の retry 自体は occ-retry.ts (runner に内蔵済) が正。本 module は「retry しては
// ならないエラーの分類」を 1 箇所に集約し、repo / service に散在していた inline 判定
// (invite-accept.ts 等) を置換する。

/** pg error の SQLSTATE を取り出す (driver / drizzle wrap の cause を 1 段見る)。 */
export function sqlstateOf(err: unknown): string | undefined {
	if (typeof err !== 'object' || err === null) return undefined;
	const code = (err as { code?: unknown }).code;
	if (typeof code === 'string') return code;
	const cause = (err as { cause?: unknown }).cause;
	if (typeof cause === 'object' && cause !== null) {
		const causeCode = (cause as { code?: unknown }).code;
		if (typeof causeCode === 'string') return causeCode;
	}
	return undefined;
}

/** UNIQUE 違反 (23505)。owner_guard / weekly_auto_guard / email_lower / 複合 PK 重複。 */
export function isUniqueViolation(err: unknown): boolean {
	return sqlstateOf(err) === '23505';
}

/** CHECK 違反 (23514)。enum SSOT (check-constraints.ts) 逸脱 = validation 層の欠陥。 */
export function isCheckViolation(err: unknown): boolean {
	return sqlstateOf(err) === '23514';
}

/**
 * 23505 の違反 constraint 名を取り出す (pg error の .constraint / cause 1 段)。
 * service 層はこれで domain error に写像する (例: 'memberships_owner_guard_unique' →
 * OWNER_ALREADY_EXISTS / 'users_email_lower_unique' → EMAIL_TAKEN)。
 */
export function uniqueConstraintOf(err: unknown): string | undefined {
	if (typeof err !== 'object' || err === null) return undefined;
	const c = (err as { constraint?: unknown }).constraint;
	if (typeof c === 'string') return c;
	const cause = (err as { cause?: unknown }).cause;
	if (typeof cause === 'object' && cause !== null) {
		const causeC = (cause as { constraint?: unknown }).constraint;
		if (typeof causeC === 'string') return causeC;
	}
	return undefined;
}
