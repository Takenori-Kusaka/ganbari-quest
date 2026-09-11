// src/lib/server/services/data-service.ts
// テナントデータクリア・サマリーサービス (#0205, #739)
// 重要: ファクトリ層 (factory.ts) 経由でDBアクセスすること。
// $lib/server/db/client を直接importしてはならない（DynamoDB環境でクラッシュする）。

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { deleteAllChildrenData, deleteTenantScopedData } from './tenant-cleanup-service';

// ============================================================
// Types
// ============================================================

/**
 * データクリアで消える件数のサマリー (#4696)。
 *
 * 旧実装は children 以外を **0 固定**で返しており、活動ログが 58 件あっても Danger Zone に
 * 「活動ログ: 0件」と表示していた (顧客が「消えるものが無い」と誤読する)。実数を数えられる
 * ものだけを field に持ち、数えられない概念 (廃止済の実績等) は field ごと持たない。
 */
export interface DataSummary {
	children: number;
	activityLogs: number;
	pointLedger: number;
	statuses: number;
	/** ログイン連続記録 (login_streaks) の行数 = 記録を持つ子供の人数 */
	loginStreaks: number;
	checklistTemplates: number;
	voices: number;
}

export interface ClearResult {
	deleted: {
		/** 削除した子供の人数 (子供に紐づく全表は同一 txn で消える) */
		children: number;
		/** テナントスコープ (子供に紐づかない) データの削除操作数 */
		other: number;
	};
}

// ============================================================
// Service
// ============================================================

/**
 * テナント内のユーザーデータ件数を取得（ファクトリ経由、#4696 で実数化）。
 *
 * **0 固定を返さない**。数えられない概念は field を持たない (廃止済の実績など)。
 * 例外を握り潰して 0 を返すと「消えるものが無い」と誤読させるため、失敗は呼び出し元へ throw する。
 */
export async function getDataSummary(tenantId: string): Promise<DataSummary> {
	const repos = getRepos();
	const childList = await repos.child.findAllChildren(tenantId);

	// 子供ごとの集計 (Danger Zone を開いたときだけ走る。子供は家族あたり数人で N+1 にならない)
	let activityLogs = 0;
	let pointLedger = 0;
	let statuses = 0;
	let loginStreaks = 0;
	let voices = 0;
	for (const child of childList) {
		activityLogs += await repos.activity.countActiveActivityLogs(child.id, tenantId);
		pointLedger += await repos.activity.countPointLedgerEntries(child.id, tenantId);
		statuses += (await repos.status.findStatuses(child.id, tenantId)).length;
		if (await repos.loginBonus.findStreak(child.id, tenantId)) loginStreaks++;
		voices += (await repos.voice.findAllByChild(child.id, tenantId)).length;
	}
	const checklistTemplates = (await repos.checklist.findTemplatesByTenant(tenantId, true)).length;

	return {
		children: childList.length,
		activityLogs,
		pointLedger,
		statuses,
		loginStreaks,
		checklistTemplates,
		voices,
	};
}

/**
 * テナント内の全ユーザーデータを削除する。
 *
 * #739: 従来は children テーブルだけを削除していたため、トップレベルの
 * テナントスコープデータ（trial_history, settings, checklists, special_rewards
 * テンプレート等）が残ってしまい、アカウント削除との意味論ズレが発生していた。
 *
 * この関数は「家族グループはそのまま残す（テナント・メンバーシップ・招待・認証は維持）が、
 * 中に入っているデータを全部リセットする」という意味を持つ。
 * - 子供＋そのカスケードを削除
 * - テナントスコープのデータ（trial_history 含む）を削除
 *
 * システムマスタ（デフォルト活動・実績・アバターアイテム等）は保持される。
 */
export async function clearAllFamilyData(tenantId: string): Promise<ClearResult> {
	logger.info('[data-clear] データクリア開始', { context: { tenantId } });

	// 1. テナントスコープのデータ（children に紐づかないもの）を削除
	//    trial_history / settings / checklist templates / special_rewards
	//    templates 等が対象 (#2295: tenant_events 削除済 2026-05-19 / #3213: auto_challenges 削除済)
	//    ⚠ voice.deleteByChild は children の ID を参照するため、
	//      children 削除より先に実行する必要がある（#739 review fix）
	const deletedOther = await deleteTenantScopedData(tenantId);

	// 2. 子供データ（ファイル含む）を削除
	//    子供のカスケード削除により activity_logs / point_ledger / statuses /
	//    stamp_cards / child_achievements / login_streaks 等も消える
	const deletedChildren = await deleteAllChildrenData(tenantId);

	logger.info('[data-clear] データクリア完了', {
		context: { deletedChildren, deletedOther },
	});

	return {
		deleted: {
			children: deletedChildren,
			other: deletedOther,
		},
	};
}
