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
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { PlanTier } from '$lib/domain/constants/plan-tier';
import { deriveLicenseStatus } from '$lib/domain/contract-state';
import { getPlanLimits, resolvePaidPlanTier } from '$lib/domain/plan-limits';
import { isTrialEndDateActiveJST } from '$lib/domain/trial-period';
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

/** 席数検査に要る `families` の契約列 (contract-state-matrix §3 の部分集合)。 */
interface FamilyContractRow {
	status: string;
	plan: string | null;
	stripe_subscription_id: string | null;
}

/** 席数検査に要る `trial_history` の列 (最新 1 行)。 */
interface TrialRow {
	end_date: string;
	tier: string;
	stripe_subscription_id: string | null;
}

/**
 * #4704: 契約列 (+ 最新トライアル) から plan tier を導く (同期・純粋)。
 *
 * 判定規則は domain leaf が SSOT (`deriveLicenseStatus` / `resolvePaidPlanTier` /
 * `isTrialEndDateActiveJST`) で、発行側の `resolvePlanTier` (service) と同じ述語を読む。
 * service を直接呼ばないのは repo → service が循環になるため。`resolvePlanTier` が持つ
 * 環境依存の判断 (DEBUG_PLAN / セルフホスト / demo) は本 txn の対象外である
 * (受諾は DSQL backend = 本番 cognito 経路でしか走らない)。
 */
function planTierOfContract(row: FamilyContractRow, trial: TrialRow | undefined): PlanTier {
	const licenseStatus = deriveLicenseStatus({
		status: row.status,
		stripeSubscriptionId: row.stripe_subscription_id,
	});
	if (licenseStatus === AUTH_LICENSE_STATUS.ACTIVE) return resolvePaidPlanTier(row.plan);
	// #4707 と同じ規則: 本契約へ移行済みの行は end_date に関わらず終了。有効期間は JST 暦日。
	if (
		trial &&
		trial.stripe_subscription_id === null &&
		isTrialEndDateActiveJST(trial.end_date) &&
		isPlanTier(trial.tier)
	) {
		return trial.tier;
	}
	return 'free';
}

/** `trial_history.tier` は自由文字列列なので、表に無い値を tier として通さない。 */
function isPlanTier(value: string): value is PlanTier {
	return value === 'free' || value === 'standard' || value === 'family';
}

interface AcceptedInviteRow {
	family_id: string;
	role: string;
	invited_by: string | null;
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

			// #4704: **受諾側でも席数を数える。** 上限検査が発行時だけだと、
			// (a) 発行後にプランが下がった / (b) 上限ぎりぎりで複数の招待が同時に受諾された
			// 場合に上限を超えられる。同一 txn 内で数えることで、超過した受諾だけが確実に落ちる
			// (40001 は runner が再実行するので、勝った 1 件だけが通る)。
			//
			// fitness#7 (§8) 整合: 席数検査を helper 関数に切り出さず inline に置く。work 内の
			// await は tx-bound call だけを許す規約であり、helper 経由だと transitive await を
			// 静的に追えないため。判定 (プラン導出・比較) は同期処理で await を挟まない。
			const contract = await tx.execute(sql`
				SELECT status, plan, stripe_subscription_id FROM families WHERE family_id = ${invite.family_id}
			`);
			const family = contract.rows[0] as FamilyContractRow | undefined;
			if (!family) throw new AcceptInviteAbort('INVALID_OR_EXPIRED');
			// トライアル中は発行側 (`resolveFullPlanTier`) が trial の tier で上限を見るので、
			// 受諾側も同じ行を読む。読まないと「発行は通るのに受諾だけ落ちる」ずれになる。
			const trial = await tx.execute(sql`
				SELECT end_date, tier, stripe_subscription_id FROM trial_history
				WHERE family_id = ${invite.family_id}
				ORDER BY created_at DESC, trial_id DESC
				LIMIT 1
			`);
			const latestTrial = trial.rows[0] as TrialRow | undefined;
			const maxSeats = getPlanLimits(planTierOfContract(family, latestTrial)).maxFamilyMembers;
			if (maxSeats !== null) {
				const counted = await tx.execute(sql`
					SELECT count(*)::int AS seats FROM memberships WHERE family_id = ${invite.family_id}
				`);
				const seats = Number((counted.rows[0] as { seats: number } | undefined)?.seats ?? 0);
				if (seats >= maxSeats) throw new AcceptInviteAbort('MEMBER_LIMIT_REACHED');
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
