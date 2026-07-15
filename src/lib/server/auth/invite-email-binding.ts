// src/lib/server/auth/invite-email-binding.ts
// #3742: 招待 email 束縛判定の SSOT (service 層 / DSQL txn 変種の parity 強制点)。
//
// #3729 (#3555) で service 層 `invite-service.ts` に実装した判定 (email_verified=false
// fail-closed + trim/lower 正規化) と、DSQL 並行実装 `db/dsql/invite-accept.ts` の判定が
// 非対称になっていた gap (#3742) への根治。判定ロジックを本 pure 関数 1 箇所に集約し、
// 両経路が import することで #3424 cutover 後も認可強度が乖離しない (ADR-0063 の
// 「アプリ層単一強制点」と同型。ADR-0061 same-class → SSOT 化)。

/** 束縛判定の失敗理由。null = 束縛 OK (受諾続行可)。 */
export type InviteEmailBindingError = 'INVITE_EMAIL_UNVERIFIED' | 'INVITE_EMAIL_MISMATCH';

/**
 * 宛先 email 束縛招待の受諾可否判定 (#3549 判断2 / dsql-data-model.md §6.6 ⚠️)。
 * invite.email 設定時のみ呼ぶ (未束縛 invite は opt-in 原則で判定対象外)。
 *
 * - #3555 ③: 束縛照合は「検証済み email」が前提。`emailVerified === false` は他人の
 *   email 自称による束縛招待横取りを塞ぐため fail-closed で拒否。`undefined` は claim を
 *   持たない provider (local / dev) との後方互換のため許容。
 * - userEmail 未提供 / 不一致は fail-closed (招待リンク横流しによる別人受諾を防ぐ)。
 *   照合は `trim().toLowerCase()` 正規化 (users.email_lower と同じ case-insensitive 原則)。
 */
export function checkInviteEmailBinding(
	inviteEmail: string,
	userEmail: string | undefined,
	emailVerified: boolean | undefined,
): InviteEmailBindingError | null {
	if (emailVerified === false) {
		return 'INVITE_EMAIL_UNVERIFIED';
	}
	if (inviteEmail.toLowerCase() !== userEmail?.trim().toLowerCase()) {
		return 'INVITE_EMAIL_MISMATCH';
	}
	return null;
}
