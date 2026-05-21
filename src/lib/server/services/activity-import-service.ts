// src/lib/server/services/activity-import-service.ts
// 活動単体インポートサービス（#0224）
//
// @deprecated #2365 (ADR-0052): activity-pack を新 `ImportStrategy` 経由に移行。
//   本 service は `$lib/marketplace/strategies/activity-pack-strategy.ts` の内部実装として
//   並行稼働中だが、外部からの直接呼出は `+page.server.ts` 1 ヶ所のみに集約済 (Strangler Fig)。
//   1 release 経過後 (別 Issue) に撤去予定。新規 callsite を増やさないこと。

import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findActivities, insertActivity } from '$lib/server/db/activity-repo';
import { logger } from '$lib/server/logger';

const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

export interface ActivityImportPreview {
	total: number;
	newActivities: number;
	duplicates: number;
	duplicateNames: string[];
	byCategory: Record<string, number>;
}

export interface ActivityImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/**
 * インポート対象の活動をプレビュー（実際にはDBに書き込まない）
 *
 * @deprecated #2365 (ADR-0052): activity-pack Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/activity-pack-strategy` 経由で本関数を呼び出し、
 *   戻り値は `ImportPreview` shape に正規化されます。1 release 経過後撤去予定。
 */
export async function previewActivityImport(
	activities: ActivityPackItem[],
	tenantId: string,
): Promise<ActivityImportPreview> {
	const existing = await findActivities(tenantId);
	const existingNames = new Set(existing.map((a) => a.name));

	const duplicateNames: string[] = [];
	const byCategory: Record<string, number> = {};
	let newCount = 0;

	for (const a of activities) {
		const catName = a.categoryCode;
		byCategory[catName] = (byCategory[catName] ?? 0) + 1;

		if (existingNames.has(a.name)) {
			duplicateNames.push(a.name);
		} else {
			newCount++;
		}
	}

	return {
		total: activities.length,
		newActivities: newCount,
		duplicates: duplicateNames.length,
		duplicateNames,
		byCategory,
	};
}

/**
 * 活動インポートのオプション
 *
 * @property presetId マーケットプレイスプリセット由来の場合、パックID
 *                    （#1254 G1: import 時の preset_duplicate 検知に利用）
 * @property applyMustDefault 親側 UI のチェックボックスが ON のとき true。
 *                            true の場合、`ActivityPackItem.mustDefault === true` の活動は
 *                            `priority='must'` でインポートされる（#1758 / #1709-D）。
 *                            false / 未指定の場合は全活動が `priority='optional'`。
 */
export interface ImportActivitiesOptions {
	presetId?: string;
	applyMustDefault?: boolean;
}

/**
 * 活動をインポート（mergeモード: 重複はスキップ）
 *
 * @deprecated #2365 (ADR-0052): activity-pack Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/activity-pack-strategy` が本関数を内部 callee として参照中。
 *   外部 callsite は `+page.server.ts` 1 ヶ所のみ (Strangler Fig)。1 release 経過後撤去予定。
 *
 * @param activities インポート対象の活動配列（marketplace activity-pack の payload.activities など）
 * @param tenantId   テナントID
 * @param options    presetId（preset_duplicate 検知）と applyMustDefault（must 推奨採用）
 *                   後方互換のため `string` を渡した場合は presetId として扱う。
 */
export async function importActivities(
	activities: ActivityPackItem[],
	tenantId: string,
	options?: ImportActivitiesOptions | string,
): Promise<ActivityImportResult> {
	const opts: ImportActivitiesOptions =
		typeof options === 'string' ? { presetId: options } : (options ?? {});
	const presetId = opts.presetId;
	const applyMustDefault = opts.applyMustDefault === true;

	const existing = await findActivities(tenantId);
	const existingNames = new Set(existing.map((a) => a.name));
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	for (const a of activities) {
		if (existingNames.has(a.name)) {
			skipped++;
			continue;
		}

		const categoryId = CATEGORY_CODE_TO_ID[a.categoryCode];
		if (!categoryId) {
			errors.push(`「${a.name}」: カテゴリ「${a.categoryCode}」が不明`);
			continue;
		}

		// #1758 (#1709-D): mustDefault が true かつ親側で ON のとき priority='must'。
		// それ以外（OFF / mustDefault undefined / false）は schema default の 'optional'。
		const priority = applyMustDefault && a.mustDefault === true ? 'must' : 'optional';

		try {
			await insertActivity(
				{
					name: a.name,
					categoryId,
					icon: a.icon,
					basePoints: a.basePoints,
					ageMin: a.ageMin,
					ageMax: a.ageMax,
					triggerHint: a.triggerHint ?? null,
					sourcePresetId: presetId ?? null,
					priority,
				},
				tenantId,
			);
			imported++;
			existingNames.add(a.name);
		} catch (e) {
			errors.push(`「${a.name}」: ${String(e)}`);
		}
	}

	logger.info('[activity-import] インポート完了', {
		context: {
			tenantId,
			imported,
			skipped,
			errors: errors.length,
			presetId: presetId ?? null,
			applyMustDefault,
		},
	});

	return { imported, skipped, errors };
}
