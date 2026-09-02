// src/lib/server/services/activity-quota.ts (#4693)
//
// **カスタム活動の上限を「取込の実書き込み直前」で一元強制する。**
//
// # なぜ独立した強制点にするか
//
// 上限判定 (`checkActivityLimit`) は各 route の action が個別に呼ぶ形だった。手動追加 /
// 一括追加 / 別の子からコピー / テンプレ取込には gate があったが、**ファイル復元
// (`?/importFile`) にだけ無く**、無料プランの上限 3 件に達したテナントが CSV / JSON を
// 用意すれば 119 件でも取り込めた (#4693 実測。#2894 / #3740 に続く同 class 3 件目)。
//
// 「経路ごとに gate を書く」設計では、経路が増えるたびに書き忘れが再発する。全ての取込経路が
// 通る `importActivities` の直前でここを通すことで、**経路を足しても素通りできない**構造にする。
//
// 手動追加 (`createActivity`) は取込ではないため本関数を通らないが、そちらは action 側の
// `checkActivityLimit` で従来どおり止まる。両者が同じ `getPlanLimits().maxActivities` を読む。

import { countsTowardActivityQuota } from '$lib/domain/activity-source';
import type { ChildId } from '$lib/domain/ids';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { resolveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';
import { getRepos } from '$lib/server/db/factory';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { getPlanLimits, resolveFullPlanTier } from './plan-limit-service';

export interface ActivityQuotaEnforcement {
	/** 上限超過で取込対象から外した活動名 */
	rejectedNames: Set<string>;
	/** 顧客に見せる理由 (`rejectedNames` が空なら空文字) */
	message: string;
}

/**
 * 上限を超える分を **書き込み計画から取り除く**。
 *
 * - 上限なし (standard / family / local / demo) → 何もしない
 * - 残枠 n 件 → 計画のうち先頭 n 件だけ残し、超過分は全 child の計画から削除する
 *   (「余裕のある分は入る」— 1 件でも超えたら全部落とす、にはしない)
 *
 * プラン解決は request context ではなく `resolveTenantEntitlement(tenantId)` (DB) を使う。
 * 呼び出し側が licenseStatus を渡し忘れて gate が無効化される経路を作らないため。
 */
export async function enforceActivityQuota(
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<ActivityQuotaEnforcement> {
	const empty: ActivityQuotaEnforcement = { rejectedNames: new Set(), message: '' };
	if (plannedNewNames.size === 0) return empty;

	// プラン解決できない (DB 障害等) ときは **取り込まない**。ここで握り潰して通すと、
	// 障害中だけ上限が消える経路になる (fail-closed、ADR-0006)。
	let entitlement: { licenseStatus: string; plan?: string };
	try {
		entitlement = await resolveTenantEntitlement(tenantId);
	} catch (e) {
		logger.error('[activity-quota] プランを確認できないため取込を中止しました', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		const rejectedNames = new Set(plannedNewNames);
		for (const [childId, inputs] of childInputsByChild) {
			childInputsByChild.set(
				childId,
				inputs.filter((i) => !rejectedNames.has(i.name)),
			);
		}
		plannedNewNames.clear();
		return { rejectedNames, message: PLAN_GATE_LABELS.planUnverifiableImportAborted };
	}
	const limits = getPlanLimits(
		await resolveFullPlanTier(tenantId, entitlement.licenseStatus, entitlement.plan),
	);
	const max = limits.maxActivities;
	if (max === null) return empty;

	const current = await countQuotaActivities(tenantId);
	const remaining = Math.max(0, max - current);
	if (plannedNewNames.size <= remaining) return empty;

	// 先頭 `remaining` 件を残し、残りを全 child の計画から取り除く。
	const keep = new Set([...plannedNewNames].slice(0, remaining));
	const rejectedNames = new Set([...plannedNewNames].filter((n) => !keep.has(n)));
	for (const [childId, inputs] of childInputsByChild) {
		childInputsByChild.set(
			childId,
			inputs.filter((i) => !rejectedNames.has(i.name)),
		);
	}
	for (const name of rejectedNames) plannedNewNames.delete(name);

	logger.info('[activity-quota] 上限超過分を取込対象から除外しました', {
		context: { tenantId, max, current, remaining, rejected: rejectedNames.size },
	});

	return { rejectedNames, message: PLAN_GATE_LABELS.activityLimitReached(max) };
}

/** quota に数える活動 (custom source) の現在数を tenant 横断で数える。 */
async function countQuotaActivities(tenantId: string): Promise<number> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	let current = 0;
	for (const child of children) {
		const activities = await repos.childActivity.findActivitiesByChild(child.id, tenantId);
		current += activities.filter((a) => countsTowardActivityQuota(a.source)).length;
	}
	return current;
}
