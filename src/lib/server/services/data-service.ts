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

export interface DataSummary {
	children: number;
	activityLogs: number;
	pointLedger: number;
	statuses: number;
	achievements: number;
	loginBonuses: number;
	checklistTemplates: number;
	voices: number;
}

export interface ClearResult {
	deleted: {
		children: number;
		activityLogs: number;
		pointLedger: number;
		statuses: number;
		statusHistory: number;
		achievements: number;
		loginBonuses: number;
		checklistTemplates: number;
		other: number;
	};
}

// ============================================================
// Service
// ============================================================

/**
 * テナント内のユーザーデータ件数を取得（ファクトリ経由）
 *
 * DynamoDB ではフルスキャンが高コストなため、子供数・チェックリスト数のみ正確に返し、
 * その他は 0 を返す（UI側で「-」表示にする想定）。
 */
export async function getDataSummary(tenantId: string): Promise<DataSummary> {
	try {
		const repos = getRepos();
		const childList = await repos.child.findAllChildren(tenantId);

		return {
			children: childList.length,
			activityLogs: 0,
			pointLedger: 0,
			statuses: 0,
			achievements: 0,
			loginBonuses: 0,
			checklistTemplates: 0,
			voices: 0,
		};
	} catch (err) {
		logger.error('[data-service] getDataSummary failed', { error: String(err) });
		return {
			children: 0,
			activityLogs: 0,
			pointLedger: 0,
			statuses: 0,
			achievements: 0,
			loginBonuses: 0,
			checklistTemplates: 0,
			voices: 0,
		};
	}
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
	//    templates / tenant_events / auto_challenges 等が対象
	//    ⚠ voice.deleteByChild は children の ID を参照するため、
	//      children 削除より先に実行する必要がある（#739 review fix）
	const deletedOther = await deleteTenantScopedData(tenantId);

	// 2. 子供データ（ファイル含む）を削除
	//    子供のカスケード削除により activity_logs / point_ledger / statuses /
	//    stamp_cards / child_achievements / login_bonuses 等も消える
	const deletedChildren = await deleteAllChildrenData(tenantId);

	logger.info('[data-clear] データクリア完了', {
		context: { deletedChildren, deletedOther },
	});

	return {
		deleted: {
			children: deletedChildren,
			activityLogs: 0,
			pointLedger: 0,
			statuses: 0,
			statusHistory: 0,
			achievements: 0,
			loginBonuses: 0,
			checklistTemplates: 0,
			other: deletedOther,
		},
	};
}
