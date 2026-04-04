// src/lib/server/services/data-service.ts
// テナントデータクリア・サマリーサービス (#0205)
// 重要: ファクトリ層 (factory.ts) 経由でDBアクセスすること。
// $lib/server/db/client を直接importしてはならない（DynamoDB環境でクラッシュする）。

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { deleteChildFiles } from './child-service';

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
 * テナント内の全ユーザーデータを削除する
 * システムマスタ（デフォルト活動・実績・アバターアイテム等）は保持
 */
export async function clearAllFamilyData(tenantId: string): Promise<ClearResult> {
	logger.info('[data-clear] データクリア開始', { context: { tenantId } });

	const repos = getRepos();

	// 1. ファイル削除（子供ごとのアバター・音声・生成画像）
	const allChildren = await repos.child.findAllChildren(tenantId);
	for (const child of allChildren) {
		try {
			await deleteChildFiles(child.id, tenantId);
		} catch (e) {
			logger.warn(`[data-clear] ファイル削除失敗 childId=${child.id}: ${String(e)}`);
		}
	}

	// 2. 子供を削除（リポジトリ経由でカスケード削除）
	let deletedChildren = 0;
	for (const child of allChildren) {
		try {
			await repos.child.deleteChild(child.id, tenantId);
			deletedChildren++;
		} catch (e) {
			logger.warn(`[data-clear] 子供削除失敗 childId=${child.id}: ${String(e)}`);
		}
	}

	logger.info('[data-clear] データクリア完了', {
		context: { deletedChildren },
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
			other: 0,
		},
	};
}
