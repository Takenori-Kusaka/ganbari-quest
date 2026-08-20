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
import { PLAN_UPGRADE_URL } from '$lib/domain/errors';
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
	/**
	 * 上限超過で取込対象から外した **行数** (child × activity)。
	 *
	 * quota の単位は行数なので、顧客に伝える「入らなかった数」も行数で数える
	 * (名前の数で数えると、2 人の子に配る取込で実際に落とした量と食い違う)。
	 */
	rejectedRows: number;
	/** 顧客に見せる理由 (`rejectedRows` が 0 なら空文字) */
	message: string;
	/** プラン上限が理由のときのアップグレード導線 (それ以外は null) */
	upgradeUrl: string | null;
}

/**
 * 上限を超える分を **書き込み計画から取り除く**。
 *
 * - 上限なし (standard / family / local / demo) → 何もしない
 * - 残枠 n 行 → 計画のうち n 行に収まる分だけ残し、超過分は全 child の計画から削除する
 *   (「余裕のある分は入る」— 1 件でも超えたら全部落とす、にはしない)
 *
 * # 単位は「行数」であって「活動名の数」ではない
 *
 * quota の正準単位は **per-child 行数**である (`checkActivityLimit` は全 child の
 * `child_activities` 行を合算して `maxActivities` と比べる)。ここで名前の集合数を残枠と
 * 比べると、**同じ 3 名を 2 人の子に取り込んだとき `3 <= 3` を素通りして 6 行書かれ**、
 * 上限 3 のテナントが 6 件保持できてしまう (= 本 gate が塞いだはずの class の再生産)。
 * したがって残枠の消費は「その名前が何人の子に新規計画されたか」で数える。
 *
 * 落とす粒度は **名前単位**に保つ (行単位で削ると「ある子には入ったが別の子には入らない」
 * 非対称な状態になり、顧客に説明できない)。残枠に収まらない名前は全 child の計画から外し、
 * `PLAN_GATE_LABELS.activityLimitReached` で理由を返す。
 *
 * プラン解決は request context ではなく `resolveTenantEntitlement(tenantId)` (DB) を使う。
 * 呼び出し側が licenseStatus を渡し忘れて gate が無効化される経路を作らないため。
 */
export async function enforceActivityQuota(
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<ActivityQuotaEnforcement> {
	const empty: ActivityQuotaEnforcement = {
		rejectedNames: new Set(),
		rejectedRows: 0,
		message: '',
		upgradeUrl: null,
	};
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
		const rejectedRows = countPlannedRows(childInputsByChild);
		for (const [childId, inputs] of childInputsByChild) {
			childInputsByChild.set(
				childId,
				inputs.filter((i) => !rejectedNames.has(i.name)),
			);
		}
		plannedNewNames.clear();
		return {
			rejectedNames,
			rejectedRows,
			message: PLAN_GATE_LABELS.planUnverifiableImportAborted,
			// プラン不明での中止はアップグレードでは解消しない (再試行を促す文言のみ)。
			upgradeUrl: null,
		};
	}
	const limits = getPlanLimits(
		await resolveFullPlanTier(tenantId, entitlement.licenseStatus, entitlement.plan),
	);
	const max = limits.maxActivities;
	if (max === null) return empty;

	const current = await countQuotaActivities(tenantId);
	const remaining = Math.max(0, max - current);
	const plannedRows = countPlannedRows(childInputsByChild);
	if (plannedRows <= remaining) return empty;

	// 残枠に収まる名前だけを残す。1 名の消費量は「その名前を新規計画した child の数」。
	const rowsByName = countRowsByName(childInputsByChild);
	const rejectedNames = new Set<string>();
	let keptRows = 0;
	for (const name of plannedNewNames) {
		const rows = rowsByName.get(name) ?? 0;
		// 収まらない名前は飛ばして次を見る (後続に 1 child 分だけの安い名前があれば入る)。
		if (keptRows + rows <= remaining) keptRows += rows;
		else rejectedNames.add(name);
	}
	for (const [childId, inputs] of childInputsByChild) {
		childInputsByChild.set(
			childId,
			inputs.filter((i) => !rejectedNames.has(i.name)),
		);
	}
	for (const name of rejectedNames) plannedNewNames.delete(name);

	const rejectedRows = plannedRows - keptRows;
	logger.info('[activity-quota] 上限超過分を取込対象から除外しました', {
		context: {
			tenantId,
			max,
			current,
			remaining,
			plannedRows,
			keptRows,
			rejectedRows,
			rejected: rejectedNames.size,
		},
	});

	return {
		rejectedNames,
		rejectedRows,
		message: PLAN_GATE_LABELS.activityLimitReached(max),
		upgradeUrl: PLAN_UPGRADE_URL,
	};
}

/** 書き込み計画の総行数 (child × activity)。quota はこの単位で数える。 */
function countPlannedRows(childInputsByChild: Map<ChildId, InsertChildActivityInput[]>): number {
	let rows = 0;
	for (const inputs of childInputsByChild.values()) rows += inputs.length;
	return rows;
}

/** 活動名ごとの計画行数 (= その名前を新規計画した child の数)。 */
function countRowsByName(
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
): Map<string, number> {
	const rowsByName = new Map<string, number>();
	for (const inputs of childInputsByChild.values()) {
		for (const input of inputs) {
			rowsByName.set(input.name, (rowsByName.get(input.name) ?? 0) + 1);
		}
	}
	return rowsByName;
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
