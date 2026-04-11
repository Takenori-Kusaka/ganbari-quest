// src/lib/server/services/tenant-cleanup-service.ts
// テナントデータクリーンアップ共通ヘルパー (#739)
//
// このモジュールは「テナント配下のデータを削除する」ための共通ユーティリティを提供する。
// 設計意図: account-deletion-service と data-service の双方から呼び出される "下位関数"
// を一箇所に集約し、削除スコープの不整合を防ぐ。
//
// ## 削除スコープ
//
// - `deleteAllChildrenData(tenantId)`:
//     - children テーブル + ファイル（アバター/音声/画像）
//     - child_repo のカスケード削除経由で子供に紐づく全データ（activity_logs,
//       point_ledger, statuses, status_history, stamp_cards, stamp_entries,
//       child_achievements, login_bonuses, character_images, evaluations,
//       special_rewards, checklist_logs, checklist_overrides）が消える。
//
// - `deleteTenantScopedData(tenantId)`:
//     - children に紐づかない "テナント直下" のレコードを削除する。
//     - activities / viewerTokens / cloudExports / pushSubscriptions /
//       voice / settings / checklists (templates+items) / dailyMissions /
//       evaluations (rest_days) / points / stampCards / statuses /
//       loginBonuses / specialRewards (templates) / activityPref /
//       activityMastery / message / tenantEvent / trialHistory /
//       siblingChallenge / siblingCheer / autoChallenge /
//       reportDailySummary / seasonEvent / image。
//
// ## 呼び出し側の使い分け
//
// - **「家族のデータを全部クリアしたい」（admin/settings の「データ全削除」）**
//     → `deleteAllChildrenData` + `deleteTenantScopedData` の両方を呼ぶ
//     → テナント・ユーザー・メンバーシップ・招待は残す（再利用するため）
//
// - **「アカウントを完全に削除したい」（/admin/account/delete）**
//     → 上記に加えて メンバーシップ / 招待 / Cognito / tenant レコード
//        も削除する（`fullTenantDeletion` で実装）

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { invalidateRequestCaches } from '$lib/server/request-context';
import { deleteChildFiles } from './child-service';

const repos = () => getRepos();

/**
 * テナント内の全子供データとファイルを削除する。
 *
 * 子供テーブルの cascade delete により、子供に紐づく activity_logs / point_ledger /
 * statuses / status_history / stamp_cards / achievements / login_bonuses /
 * character_images / evaluations / special_rewards / checklist_logs /
 * checklist_overrides が同時に消える。
 *
 * ファイル削除と DB 削除は独立してエラーハンドリングされるため、
 * ストレージ側のファイル削除が失敗しても DB 側の子供削除は実行される。
 *
 * @returns 削除に成功した子供の件数（DB レコード基準）
 */
export async function deleteAllChildrenData(tenantId: string): Promise<number> {
	const children = await repos().child.findAllChildren(tenantId);
	let deleted = 0;

	// 1. ファイル削除（失敗は warn ログのみで処理続行）
	for (const child of children) {
		try {
			await deleteChildFiles(child.id, tenantId);
		} catch (err) {
			logger.warn(`[tenant-cleanup] 子供ファイル削除失敗 childId=${child.id}: ${String(err)}`);
		}
	}

	// 2. DB レコード削除（cascade delete で関連データも消える）
	for (const child of children) {
		try {
			await repos().child.deleteChild(child.id, tenantId);
			deleted++;
		} catch (err) {
			logger.warn(`[tenant-cleanup] 子供DB削除失敗 childId=${child.id}: ${String(err)}`);
		}
	}

	return deleted;
}

/**
 * テナントスコープの全データを削除する（子供・認証以外）。
 *
 * 各リポジトリの deleteByTenantId / findByTenant + deleteById 系メソッドを使って
 * テナント配下のレコードをクリーンアップする。各リポジトリの削除は独立しており、
 * 個別の失敗が他の削除をブロックしない（warn ログを残して継続）。
 *
 * テナント直下のメタデータ（trial_history, specialReward templates, settings,
 * checklist templates 等）もここで削除されるため、クリア後のユーザーは
 * トライアルを再度使えないか、使えてしまうかが確定する。
 *
 * @returns 削除を試みた操作数（エラーを含む）
 */
export async function deleteTenantScopedData(tenantId: string): Promise<number> {
	let deleted = 0;
	const r = repos();

	// Activities（テナントスコープで find + delete 可能）
	try {
		const activities = await r.activity.findActivities(tenantId);
		for (const act of activities) {
			await r.activity.deleteActivity(act.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[tenant-cleanup] activities 削除失敗: ${String(err)}`);
	}

	// Viewer tokens（findByTenant + deleteById 可能）
	try {
		const tokens = await r.viewerToken.findByTenant(tenantId);
		for (const token of tokens) {
			await r.viewerToken.deleteById(token.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[tenant-cleanup] viewerTokens 削除失敗: ${String(err)}`);
	}

	// Cloud exports（findByTenant + deleteById 可能）
	try {
		const exports = await r.cloudExport.findByTenant(tenantId);
		for (const exp of exports) {
			await r.cloudExport.deleteById(exp.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[tenant-cleanup] cloudExports 削除失敗: ${String(err)}`);
	}

	// Push subscriptions（findByTenant + deleteByEndpoint 可能）
	try {
		const subs = await r.pushSubscription.findByTenant(tenantId);
		for (const sub of subs) {
			await r.pushSubscription.deleteByEndpoint(sub.endpoint, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[tenant-cleanup] pushSubscriptions 削除失敗: ${String(err)}`);
	}

	// Voice（子供ごとに deleteByChild 可能）
	try {
		const children = await r.child.findAllChildren(tenantId);
		for (const child of children) {
			await r.voice.deleteByChild(child.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[tenant-cleanup] voice 削除失敗: ${String(err)}`);
	}

	// Settings
	try {
		await r.settings.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] settings 削除失敗: ${String(err)}`);
	}

	// Checklists（templates, items, logs, overrides）
	try {
		await r.checklist.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] checklists 削除失敗: ${String(err)}`);
	}

	// Daily missions
	try {
		await r.dailyMission.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] dailyMissions 削除失敗: ${String(err)}`);
	}

	// Evaluations（evaluations + rest_days）
	try {
		await r.evaluation.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] evaluations 削除失敗: ${String(err)}`);
	}

	// Points（point_ledger）
	try {
		await r.point.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] points 削除失敗: ${String(err)}`);
	}

	// Stamp cards + entries
	try {
		await r.stampCard.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] stampCards 削除失敗: ${String(err)}`);
	}

	// Status（statuses + status_history + market_benchmarks）
	try {
		await r.status.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] status 削除失敗: ${String(err)}`);
	}

	// Login bonuses
	try {
		await r.loginBonus.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] loginBonus 削除失敗: ${String(err)}`);
	}

	// Special rewards
	try {
		await r.specialReward.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] specialReward 削除失敗: ${String(err)}`);
	}

	// Activity preferences（pin settings）
	try {
		await r.activityPref.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] activityPref 削除失敗: ${String(err)}`);
	}

	// Activity mastery
	try {
		await r.activityMastery.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] activityMastery 削除失敗: ${String(err)}`);
	}

	// Parent messages
	try {
		await r.message.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] message 削除失敗: ${String(err)}`);
	}

	// Tenant events + progress
	try {
		await r.tenantEvent.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] tenantEvent 削除失敗: ${String(err)}`);
	}

	// Trial history
	try {
		await r.trialHistory.deleteByTenantId(tenantId);
		// #788: 同一リクエスト内のキャッシュも破棄（後続処理が stale 値を見ないよう防衛）
		invalidateRequestCaches(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] trialHistory 削除失敗: ${String(err)}`);
	}

	// Sibling challenges + progress
	try {
		await r.siblingChallenge.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] siblingChallenge 削除失敗: ${String(err)}`);
	}

	// Sibling cheers
	try {
		await r.siblingCheer.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] siblingCheer 削除失敗: ${String(err)}`);
	}

	// Auto challenges
	try {
		await r.autoChallenge.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] autoChallenge 削除失敗: ${String(err)}`);
	}

	// Report daily summaries
	try {
		await r.reportDailySummary.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] reportDailySummary 削除失敗: ${String(err)}`);
	}

	// Season events + child_event_progress
	try {
		await r.seasonEvent.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] seasonEvent 削除失敗: ${String(err)}`);
	}

	// Character images
	try {
		await r.image.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[tenant-cleanup] image 削除失敗: ${String(err)}`);
	}

	return deleted;
}
