// src/lib/server/services/activity-import-service.ts
// 活動単体インポートサービス（#0224）

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
 * 活動をインポート（mergeモード: 重複はスキップ）
 */
export async function importActivities(
	activities: ActivityPackItem[],
	tenantId: string,
): Promise<ActivityImportResult> {
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
		context: { tenantId, imported, skipped, errors: errors.length },
	});

	return { imported, skipped, errors };
}
