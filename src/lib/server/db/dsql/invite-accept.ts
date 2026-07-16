// src/lib/server/db/dsql/invite-accept.ts
// EPIC #3424 / 実装 #3528 (#N2-1 Phase B cycle (b)) / 設計 SSOT: dsql-data-model.md §6.6
//
// invite 受諾 = 単一 txn。§6.6 の厳密分岐:
//   - UPDATE ... WHERE status='pending' AND expires_at > now RETURNING の rowCount=0
//     = 業務失敗 (INVALID_OR_EXPIRED)。**retry 禁止** — 正常 return で返す (throw しない)
//   - membership INSERT の 23505 (PK/owner_guard 重複) = ALREADY_IN_TENANT。
//     単一 txn ゆえ invite の accepted 化も一緒に rollback される (部分コミット禁止)
//   - 40001 (OCC) は throw のまま runner 内蔵 withOccRetry が txn 全体を再実行
//   - email 束縛 (§6.6 ⚠️): invite.email 設定時は受諾 user email と一致必須。判定は
//     `auth/invite-email-binding.ts` (SSOT、#3742) を service 層と共有し、email_verified=false
//     fail-closed (EMAIL_UNVERIFIED) + trim/lower 正規化を含めて parity を機械保証する。
//     不一致 / 未検証は throw → rollback (招待リンク横流し・未検証 email 自称による横取りを防ぐ)
//
// fitness#7 整合: work 内の await は全て tx.execute(...) (tx-bound)。分岐判定は同期処理。
// business 失敗を throw で表現するのは rollback を担わせるため (typed error → catch で
// result に写像し、呼び出し側には throw しない)。

import { sql } from 'drizzle-orm';
import { checkInviteEmailBinding } from '../../auth/invite-email-binding';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { isUniqueViolation } from './dsql-errors';
import type { SqlExecutor } from './sql-executor';

export type { SqlExecutor } from './sql-executor';

export interface AcceptInviteInput {
	inviteId: string;
	/** 受諾する user (users.user_id)。 */
	userId: string;
	/** 受諾 user の email (invite.email 束縛検証に使用)。 */
	userEmail: string;
	/**
	 * 受諾 user の email が IdP で検証済みか (Cognito `email_verified` claim、#3555 ③ / #3742)。
	 * email 束縛招待でのみ判定に使う。`false` は fail-closed で拒否、`undefined` は
	 * claim を持たない provider (local / dev) との後方互換のため許容 (service 層と同一契約)。
	 */
	userEmailVerified?: boolean;
	/** 判定基準時刻 (ISO 8601)。呼び出し側が注入する (テスト決定性 + txn 内で一貫)。 */
	now: string;
}

export type AcceptInviteFailure =
	| 'INVALID_OR_EXPIRED'
	| 'ALREADY_IN_TENANT'
	| 'EMAIL_MISMATCH'
	| 'EMAIL_UNVERIFIED';

export type AcceptInviteResult =
	| { ok: true; familyId: string; role: string }
	| { ok: false; reason: AcceptInviteFailure };

/** txn を rollback させつつ business 失敗を運ぶ内部シグナル。 */
class AcceptInviteAbort extends Error {
	constructor(readonly reason: AcceptInviteFailure) {
		super(`invite accept aborted: ${reason}`);
	}
}

interface AcceptedInviteRow {
	family_id: string;
	role: string;
	invited_by: string;
	email: string | null;
}

/**
 * invite を受諾し membership を作成する (単一 txn、§6.6)。
 * 40001 は runner の withOccRetry が txn 全体を再実行する (work は再実行可能)。
 */
export async function acceptInvite<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
	const { inviteId, userId, userEmail, userEmailVerified, now } = input;
	try {
		return await runner.runInTransaction(async (tx) => {
			// 状態遷移と条件判定を 1 文に畳む (§6.6): pending かつ未失効の行だけが accepted 化される。
			const updated = await tx.execute(sql`
				UPDATE invites
				SET status = 'accepted', accepted_by = ${userId}, accepted_at = ${now}
				WHERE invite_id = ${inviteId} AND status = 'pending' AND expires_at > ${now}
				RETURNING family_id, role, invited_by, email
			`);
			const invite = updated.rows[0] as AcceptedInviteRow | undefined;
			if (!invite) throw new AcceptInviteAbort('INVALID_OR_EXPIRED');

			// email 束縛 (§6.6 ⚠️)。判定は service 層と共有の SSOT (#3742):
			// email_verified=false fail-closed + trim/lower 正規化 (email_lower と同じ原則)。
			if (invite.email !== null) {
				const bindingError = checkInviteEmailBinding(invite.email, userEmail, userEmailVerified);
				if (bindingError === 'INVITE_EMAIL_UNVERIFIED') {
					throw new AcceptInviteAbort('EMAIL_UNVERIFIED');
				}
				if (bindingError === 'INVITE_EMAIL_MISMATCH') {
					throw new AcceptInviteAbort('EMAIL_MISMATCH');
				}
			}

			await tx.execute(sql`
				INSERT INTO memberships (family_id, user_id, role, invited_by, joined_at)
				VALUES (${invite.family_id}, ${userId}, ${invite.role}, ${invite.invited_by}, ${now})
			`);
			return { ok: true, familyId: invite.family_id, role: invite.role } as const;
		});
	} catch (err) {
		if (err instanceof AcceptInviteAbort) return { ok: false, reason: err.reason };
		if (isUniqueViolation(err)) return { ok: false, reason: 'ALREADY_IN_TENANT' };
		throw err;
	}
}
