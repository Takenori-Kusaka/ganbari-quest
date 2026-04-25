// src/lib/server/services/age-recalc-service.ts
// #1381: 子供の年齢自動インクリメントサービス (Sub B-3)
//
// 毎日 00:00 JST に /api/cron/age-recalc から呼ばれる。
// 全テナントの全 child を走査し、calculateAge() で得た年齢が child.age と異なる場合に:
//   - age を更新
//   - uiModeManuallySet=false の場合のみ uiMode を recalcUiMode() で再計算
//
// birthday-bonus-service.claimBirthdayBonus() との責務分担:
//   - claimBirthdayBonus: 誕生日ボーナス付与 + age/uiMode 更新（uiModeManuallySet を無視して常に上書き）
//   - 本サービス: age の日次同期 + uiModeManuallySet を考慮した uiMode 再計算
//   詳細は docs/design/26-ゲーミフィケーション設計書.md §13.9 を参照

import { todayDateJST } from '$lib/domain/date-utils';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { recalcUiMode } from '$lib/domain/validation/age-tier';
import { getRepos } from '$lib/server/db/factory';
import type { IChildRepo } from '$lib/server/db/interfaces/child-repo.interface';
import type { Child } from '$lib/server/db/types/index';
import { logger } from '$lib/server/logger';
import { calculateAge } from '$lib/server/services/birthday-bonus-service';

export interface AgeRecalcResult {
	/** 走査した child 総数（birthDate がない child を含む） */
	scanned: number;
	/** birthDate がないためスキップした child 数 */
	skipped: number;
	/** age が変化したため更新した child 数 */
	updated: number;
	/** 更新に失敗した child 数 */
	failures: number;
	/** dryRun=true の場合は実際には更新しない */
	dryRun: boolean;
}

export interface AgeRecalcOptions {
	/** true の場合、更新を実行せず件数カウントのみ返す */
	dryRun?: boolean;
	/** テスト用: "今日" を上書きする (YYYY-MM-DD) */
	today?: string;
}

interface ProcessChildParams {
	child: Child;
	tenantId: string;
	today: string;
	dryRun: boolean;
	childRepo: IChildRepo;
}

interface ProcessChildResult {
	skipped: boolean;
	updated: boolean;
	failed: boolean;
}

/** 単一 child の年齢再計算処理（複雑度分割のためメインループから抽出） */
async function processChild(params: ProcessChildParams): Promise<ProcessChildResult> {
	const { child, tenantId, today, dryRun, childRepo } = params;

	if (!child.birthDate) {
		return { skipped: true, updated: false, failed: false };
	}

	const newAge = calculateAge(child.birthDate, today);
	if (newAge === child.age) {
		return { skipped: false, updated: false, failed: false };
	}

	// Child.uiMode は string 型だが、DB 上では UiMode の値しか入らない
	const newUiMode = recalcUiMode(
		{ uiMode: child.uiMode as UiMode, uiModeManuallySet: child.uiModeManuallySet },
		newAge,
	);

	if (dryRun) {
		return { skipped: false, updated: true, failed: false };
	}

	try {
		await childRepo.updateChild(child.id, { age: newAge, uiMode: newUiMode }, tenantId);
		logger.info('[age-recalc] updated child', {
			service: 'age-recalc',
			tenantId,
			context: {
				childId: child.id,
				oldAge: child.age,
				newAge,
				oldUiMode: child.uiMode,
				newUiMode,
				uiModeManuallySet: child.uiModeManuallySet,
			},
		});
		return { skipped: false, updated: true, failed: false };
	} catch (e) {
		logger.error('[age-recalc] failed to update child', {
			service: 'age-recalc',
			tenantId,
			error: e instanceof Error ? e.message : String(e),
			context: { childId: child.id },
		});
		return { skipped: false, updated: false, failed: true };
	}
}

/**
 * 全テナントの全 child を走査し、age を現在日付から再計算する。
 * uiModeManuallySet=false の場合のみ uiMode も再計算する。
 * retention-cleanup-service と同様に listAllTenants → findAllChildren の 2 段階走査を行う。
 */
export async function recalcAllChildrenAges(
	options: AgeRecalcOptions = {},
): Promise<AgeRecalcResult> {
	const dryRun = options.dryRun ?? false;
	const today = options.today ?? todayDateJST();

	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();

	let scanned = 0;
	let skipped = 0;
	let updated = 0;
	let failures = 0;

	for (const tenant of tenants) {
		const children = await repos.child.findAllChildren(tenant.tenantId);

		for (const child of children) {
			scanned++;
			const res = await processChild({
				child,
				tenantId: tenant.tenantId,
				today,
				dryRun,
				childRepo: repos.child,
			});
			if (res.skipped) skipped++;
			if (res.updated) updated++;
			if (res.failed) failures++;
		}
	}

	return { scanned, skipped, updated, failures, dryRun };
}
