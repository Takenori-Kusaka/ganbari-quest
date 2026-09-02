// src/lib/server/services/tenant-relocation-service.ts
// 別の家族グループへの「引っ越し合流」(#4642)。
//
// 招待リンクをうまく踏めず、誤って自分だけの家族グループを作って owner になってしまった人が、
// 後から正しい招待を受け取れるようにする。1 ユーザー = 1 テナント制約 (`invite-service`) を
// 満たしたまま移るため、**受諾 → 元の membership 削除 → 無人になった元テナントの掃除** を
// この順で行う (受諾を先にするのは、途中で失敗しても「どこにも所属しない人」を作らないため)。
//
// **不可逆操作**: 元の家族グループのデータ (子供 / 活動 / 履歴 / 設定 / ファイル) は復元できない。
// したがって呼び出しは顧客の明示同意を得た経路 (`/auth/invite/[code]` の確認画面) からに限る。

import type { Membership } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { deleteVacatedTenant, getOwnerDeletionInfo } from './account-deletion-service';
import { acceptInvite } from './invite-service';
import { resolveFullPlanTier } from './plan-limit-service';

/** 引っ越しできない理由。`null` = 引っ越し可能。 */
export type RelocationBlockedReason =
	/** 今の家族グループに自分以外のメンバーが居る (勝手に畳めない) */
	| 'HAS_OTHER_MEMBERS'
	/** 今の家族グループに子供が登録されている (その子の記録ごと消える) */
	| 'HAS_CHILDREN'
	/** 今の家族グループの owner ではない (先に自分だけ抜ければよい) */
	| 'NOT_OWNER'
	/** そもそもどこにも所属していない (通常の受諾で足りる) */
	| 'NO_CURRENT_TENANT';

export interface RelocationEligibility {
	/** 引っ越し可能なら現在の家族グループ id。不可なら null。 */
	currentTenantId: string | null;
	blockedReason: RelocationBlockedReason | null;
}

/**
 * 引っ越し合流できる状態かを判定する (read only)。
 * 画面表示とサーバー側の実行前検証の両方が本関数を通ることで、判定が 2 つに割れない。
 */
export async function checkRelocationEligibility(userId: string): Promise<RelocationEligibility> {
	const memberships = await getRepos().auth.findUserTenants(userId);
	const current = memberships[0];
	if (!current) return { currentTenantId: null, blockedReason: 'NO_CURRENT_TENANT' };
	if (current.role !== 'owner') {
		return { currentTenantId: current.tenantId, blockedReason: 'NOT_OWNER' };
	}

	const { isOnlyMember } = await getOwnerDeletionInfo(current.tenantId, userId);
	if (!isOnlyMember) {
		return { currentTenantId: current.tenantId, blockedReason: 'HAS_OTHER_MEMBERS' };
	}

	// #4642 PO 決裁 Q1: 子供が 1 人でも居たら阻止する。
	// `isOnlyMember` は memberships しか数えないため、**ログインアカウントを持たない子供**
	// (children 行のみ / membership なし) が居ても true になる。それだけで可否を決めると、
	// その子のプロフィール・ポイント履歴・画像が確認画面 1 枚で不可逆に消える。
	if (await hasChildren(current.tenantId)) {
		return { currentTenantId: current.tenantId, blockedReason: 'HAS_CHILDREN' };
	}
	return { currentTenantId: current.tenantId, blockedReason: null };
}

/**
 * 家族グループに子供が 1 人でも残っているか (在籍 + アーカイブ)。
 *
 * どちらも `fullTenantDeletion` で消える対象なので両方数える。
 * 集計に失敗したときは **「居ない」と答えない** — 確認できなかったことを「居ない」と
 * 読み替えると不可逆削除に進んでしまうため、居るものとして扱って阻止する (fail-closed)。
 */
async function hasChildren(tenantId: string): Promise<boolean> {
	try {
		const [active, archived] = await Promise.all([
			getRepos().child.findAllChildren(tenantId),
			getRepos().child.findArchivedChildren(tenantId),
		]);
		return active.length + archived.length > 0;
	} catch (e) {
		logger.error('[relocation] 子供の在籍確認に失敗したため引っ越しを許可しない (fail-closed)', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		return true;
	}
}

export type RelocationResult =
	| { ok: true; membership: Membership; deletedTenantId: string }
	| { ok: false; blockedReason: RelocationBlockedReason }
	/** 受諾そのものが拒否された (理由は `INVITE_ACCEPT_ERROR_REASONS`)。元の家族は無傷。 */
	| { ok: false; acceptError: string };

/**
 * 招待を受諾して別の家族グループへ移り、無人になった元の家族グループを削除する。
 *
 * 失敗しても「どこにも所属しない人」を作らない順序で実行する:
 *   1. 引っ越し可否を再検証 (画面の同意だけを信用しない)
 *   2. 招待を受諾 (ここで失敗しても元の家族はそのまま)
 *   3. 元の membership を削除 (この時点で移動が確定)
 *   4. 無人になった元テナントを削除 (失敗しても移動は成立済み。ログに残して続行する)
 */
export async function relocateToInvitedTenant(
	inviteCode: string,
	userId: string,
	userEmail: string,
	opts: { emailVerified?: boolean } = {},
): Promise<RelocationResult> {
	const eligibility = await checkRelocationEligibility(userId);
	if (eligibility.blockedReason !== null || eligibility.currentTenantId === null) {
		return { ok: false, blockedReason: eligibility.blockedReason ?? 'NO_CURRENT_TENANT' };
	}
	const oldTenantId = eligibility.currentTenantId;

	const accepted = await acceptInvite(inviteCode, userId, userEmail, {
		emailVerified: opts.emailVerified,
		allowRelocation: true,
	});
	if ('error' in accepted) {
		logger.warn('[relocation] 招待受諾に失敗したため引っ越しを中止 (元の家族は無傷)', {
			context: { userId, oldTenantId, error: accepted.error },
		});
		return { ok: false, acceptError: accepted.error };
	}

	// 監査: 不可逆操作なので「誰が・どこから・どこへ移り・何を畳んだか」を 1 行残す
	logger.warn('[relocation] 家族グループの引っ越しを実行 (元の家族グループのデータを破棄)', {
		context: {
			userId,
			fromTenantId: oldTenantId,
			toTenantId: accepted.membership.tenantId,
			role: accepted.membership.role,
		},
	});

	await getRepos().auth.deleteMembership(userId, oldTenantId);

	// 元テナントの掃除。ここで失敗しても引っ越し自体は成立しているので throw しない
	// (顧客を「合流できたのにエラー画面」に落とさない)。残骸はログから追える。
	try {
		const planTier = await resolveFullPlanTier(oldTenantId, 'none');
		await deleteVacatedTenant(oldTenantId, { route: 'relocation', planTier });
	} catch (e) {
		logger.error('[relocation] 無人になった元の家族グループの削除に失敗 (引っ越しは成立済み)', {
			error: e instanceof Error ? e.message : String(e),
			context: { userId, oldTenantId },
		});
	}

	return { ok: true, membership: accepted.membership, deletedTenantId: oldTenantId };
}
