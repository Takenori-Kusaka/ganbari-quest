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
//   - メンバー上限 (`maxMembers`) は **呼び出し側が必ず渡す** (PO 回答 2026-09-03 §4 #3)。
//     上限の SSOT は service 層 (`checkFamilyMemberLimit` → `resolveFullPlanTier`) の 1 本だけで、
//     本 txn は数え直し (排他) だけを担う。未指定は fail-closed で throw (txn を開かない)。
//     旧実装の「未指定なら txn の中で契約列から tier を導く」fallback は、表に無い plan 値を
//     standard に倒す既定を持ち、渡し忘れた経路が黙って緩い上限で通る穴だったため撤去した。
//
// fitness#7 整合: work 内の await は全て tx.execute(...) (tx-bound)。分岐判定は同期処理。
// business 失敗を throw で表現するのは rollback を担わせるため (typed error → catch で
// result に写像し、呼び出し側には throw しない)。

import { sql } from 'drizzle-orm';
import type { Role } from '$lib/server/auth/types';
import { checkInviteEmailBinding } from '../../auth/invite-email-binding';
import type {
	AcceptInviteFailure,
	AcceptInviteTxnInput,
	AcceptInviteTxnResult,
} from '../interfaces/auth-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { isUniqueViolation } from './dsql-errors';
import type { SqlExecutor } from './sql-executor';

export type { SqlExecutor } from './sql-executor';

// 入力 / 結果の型は backend 非依存の repo 契約 (IAuthRepo.acceptInviteTransactional) が SSOT。
// 本 txn はその DSQL 実装であり、独自の型を持たない (#4039)。
export type AcceptInviteInput = AcceptInviteTxnInput;
export type AcceptInviteResult = AcceptInviteTxnResult;
export type { AcceptInviteFailure };

/** txn を rollback させつつ business 失敗を運ぶ内部シグナル。 */
class AcceptInviteAbort extends Error {
	constructor(readonly reason: AcceptInviteFailure) {
		super(`invite accept aborted: ${reason}`);
	}
}

interface AcceptedInviteRow {
	family_id: string;
	role: string;
	invited_by: string | null;
	email: string | null;
}

/**
 * email 束縛 (§6.6 ⚠️) を検査し、違反なら txn を rollback させる abort を投げる。
 *
 * 判定本体は service 層と共有の SSOT (`checkInviteEmailBinding`、#3742) で、
 * email_verified=false の fail-closed + trim/lower 正規化を含む。`invite.email` が
 * `null` (宛先無指定の招待) なら束縛は無く、検査せず通す。
 *
 * fitness#7 (§8) の対象外: await を含まない同期判定であり、txn work の await allowlist
 * (`tests/unit/architecture/dsql-txn-work-allowlist.test.ts`) が見る AwaitExpression を持たない。
 */
function assertInviteEmailBinding(
	inviteEmail: string | null,
	userEmail: string,
	userEmailVerified: boolean | undefined,
): void {
	if (inviteEmail === null) return;
	const bindingError = checkInviteEmailBinding(inviteEmail, userEmail, userEmailVerified);
	if (bindingError === 'INVITE_EMAIL_UNVERIFIED') {
		throw new AcceptInviteAbort('EMAIL_UNVERIFIED');
	}
	if (bindingError === 'INVITE_EMAIL_MISMATCH') {
		throw new AcceptInviteAbort('EMAIL_MISMATCH');
	}
}

/**
 * invite を受諾し membership を作成する (単一 txn、§6.6)。
 * 40001 は runner の withOccRetry が txn 全体を再実行する (work は再実行可能)。
 */
export async function acceptInvite<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
	const { inviteId, userId, userEmail, userEmailVerified, now, maxMembers } = input;
	// fail-closed (PO 回答 2026-09-03 §4 #3): 型上は必須だが、JS 呼び出し / 古い caller が
	// 渡し忘れた場合に「上限なし」や「導出した緩い tier」で通してはならない。txn を開く前に
	// 拒否し、invite / memberships には何も書かない。業務失敗 (AcceptInviteFailure) ではなく
	// 呼び出し契約違反なので throw で表現する (retry しても直らない)。
	if (maxMembers === undefined) {
		throw new TypeError(
			'acceptInvite: maxMembers は必須です (null = 無制限)。上限は service 層 (checkFamilyMemberLimit) が解決して渡す',
		);
	}
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
			assertInviteEmailBinding(invite.email, userEmail, userEmailVerified);

			// #4723: メンバー上限は **txn の中で数え直す**。service 層の事前 read だけでは、
			// 残り 1 枠に対する 2 通の同時受諾が両方とも「まだ空いている」を見て通ってしまう。
			// DSQL は OCC (楽観的並行制御) なので、同じ family の membership を触る txn が
			// 競合すれば 40001 で片方が再実行され、数え直した結果で正しく弾かれる。
			//
			// 上限そのものは呼び出し側 (service 層の `checkFamilyMemberLimit`) が解決して渡す。
			// txn の中でプランを導き直さない — 導出が 2 箇所にあると片方だけ直して静かにずれる
			// (PO 回答 2026-09-03 §4 #3)。未指定は本関数の入口で fail-closed に throw 済み。
			//
			// fitness#7 (§8) 整合: 席数検査を helper 関数に切り出さず inline に置く。work 内の
			// await は tx-bound call だけを許す規約であり、helper 経由だと transitive await を
			// 静的に追えないため。
			if (typeof maxMembers === 'number') {
				const counted = await tx.execute(sql`
					SELECT count(*)::int AS count FROM memberships WHERE family_id = ${invite.family_id}
				`);
				const current = Number((counted.rows[0] as { count: number } | undefined)?.count ?? 0);
				if (current >= maxMembers) throw new AcceptInviteAbort('MEMBER_LIMIT_REACHED');
			}

			await tx.execute(sql`
				INSERT INTO memberships (family_id, user_id, role, invited_by, joined_at)
				VALUES (${invite.family_id}, ${userId}, ${invite.role}, ${invite.invited_by}, ${now})
			`);
			// 呼び出し側 (service 層) が Membership entity を組み立てられるよう、
			// 書いた行の値をそのまま返す (追加 SELECT を発行しない、#4039)。
			return {
				ok: true,
				familyId: invite.family_id,
				role: invite.role as Role,
				invitedBy: invite.invited_by ?? undefined,
				joinedAt: now,
			} as const;
		});
	} catch (err) {
		if (err instanceof AcceptInviteAbort) return { ok: false, reason: err.reason };
		if (isUniqueViolation(err)) return { ok: false, reason: 'ALREADY_IN_TENANT' };
		throw err;
	}
}
