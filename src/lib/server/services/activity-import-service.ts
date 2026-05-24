// src/lib/server/services/activity-import-service.ts
// 活動単体インポートサービス（#0224）
//
// @deprecated #2365 (ADR-0052): activity-pack を新 `ImportStrategy` 経由に移行。
//   本 service は `$lib/marketplace/strategies/activity-pack-strategy.ts` の内部実装として
//   並行稼働中だが、外部からの直接呼出は `+page.server.ts` 1 ヶ所のみに集約済 (Strangler Fig)。
//   1 release 経過後 (別 Issue) に撤去予定。新規 callsite を増やさないこと。
//
// #2362 PR-3 (ADR-0055): per-child instance への配信を `options.childIds` で受領可能化。
//   - childIds 未指定: 旧来通り family master `activities` table へ insert (legacy path 維持)
//   - childIds 指定: family master insert に加え、各 child の `child_activities` にも複製
//     (Phase 3 並存期間、Phase 6/7 で family master insert は drop 予定)

import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findActivities, insertActivity } from '$lib/server/db/activity-repo';
import { getRepos } from '$lib/server/db/factory';
import type { InsertChildActivityInput } from '$lib/server/db/types';
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
 * @property childIds #2362 PR-3 (ADR-0055): per-child instance への配信先。
 *                    1 件以上指定された場合、family master insert に加え、
 *                    各 child の `child_activities` table にも 1 instance ずつ複製する。
 *                    未指定の場合は legacy 動作 (family master のみ insert) を維持。
 *                    Phase 6/7 で family master insert は drop し本フィールド必須化予定。
 */
export interface ImportActivitiesOptions {
	presetId?: string;
	applyMustDefault?: boolean;
	childIds?: readonly number[];
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
/**
 * options 正規化 (後方互換: string も presetId として受領)
 */
function normalizeOptions(options?: ImportActivitiesOptions | string): ImportActivitiesOptions {
	return typeof options === 'string' ? { presetId: options } : (options ?? {});
}

/**
 * 1 件分の activity の validate + family master insert を試みる。
 * 成功時に per-child instance input も組み立てて返す (childIds 未指定なら空配列)。
 */
async function importOneActivity(
	a: ActivityPackItem,
	tenantId: string,
	presetId: string | undefined,
	applyMustDefault: boolean,
	childIds: readonly number[],
): Promise<{
	ok: boolean;
	skipReason?: 'duplicate' | 'invalid-category' | 'insert-failed';
	error?: string;
	categoryId?: number;
	priority?: 'must' | 'optional';
	childInputs?: InsertChildActivityInput[];
}> {
	const categoryId = CATEGORY_CODE_TO_ID[a.categoryCode];
	if (!categoryId) {
		return {
			ok: false,
			skipReason: 'invalid-category',
			error: `「${a.name}」: カテゴリ「${a.categoryCode}」が不明`,
		};
	}

	// #1758 (#1709-D): mustDefault が true かつ親側で ON のとき priority='must'。
	// それ以外（OFF / mustDefault undefined / false）は schema default の 'optional'。
	const priority: 'must' | 'optional' =
		applyMustDefault && a.mustDefault === true ? 'must' : 'optional';

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
	} catch (e) {
		return {
			ok: false,
			skipReason: 'insert-failed',
			error: `「${a.name}」: ${String(e)}`,
		};
	}

	// per-child 並存配信: 各 child の instance を組み立て
	const childInputs: InsertChildActivityInput[] =
		childIds.length > 0
			? childIds.map((cid) => ({
					childId: cid,
					name: a.name,
					categoryId,
					icon: a.icon,
					basePoints: a.basePoints,
					triggerHint: a.triggerHint ?? null,
					sourcePresetId: presetId ?? null,
					priority,
				}))
			: [];

	return { ok: true, categoryId, priority, childInputs };
}

/**
 * per-child 配信 (#2362 PR-3): 各 child に instance を bulk insert。
 * child 単位で失敗しても他は継続 (partial success)。
 */
async function dispatchPerChildBulk(
	inputsByChild: Map<number, InsertChildActivityInput[]>,
	tenantId: string,
	errors: string[],
): Promise<void> {
	const repos = getRepos();
	for (const [cid, inputs] of inputsByChild) {
		if (inputs.length === 0) continue;
		try {
			await repos.childActivity.insertActivitiesBulk(inputs, tenantId);
		} catch (e) {
			errors.push(`[child=${cid}] per-child instance 作成失敗: ${String(e)}`);
		}
	}
}

export async function importActivities(
	activities: ActivityPackItem[],
	tenantId: string,
	options?: ImportActivitiesOptions | string,
): Promise<ActivityImportResult> {
	const opts = normalizeOptions(options);
	const { presetId, childIds = [] } = opts;
	const applyMustDefault = opts.applyMustDefault === true;

	const existing = await findActivities(tenantId);
	const existingNames = new Set(existing.map((a) => a.name));
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	// #2362 PR-3 (ADR-0055): per-child instance バッチ。
	const childInputsByChild: Map<number, InsertChildActivityInput[]> = new Map();
	for (const cid of childIds) childInputsByChild.set(cid, []);

	for (const a of activities) {
		if (existingNames.has(a.name)) {
			skipped++;
			continue;
		}
		const r = await importOneActivity(a, tenantId, presetId, applyMustDefault, childIds);
		if (!r.ok) {
			if (r.error) errors.push(r.error);
			continue;
		}
		imported++;
		existingNames.add(a.name);
		// per-child 入力を子供別マップに振り分け
		if (r.childInputs && r.childInputs.length > 0) {
			for (const input of r.childInputs) {
				childInputsByChild.get(input.childId)?.push(input);
			}
		}
	}

	if (childIds.length > 0) {
		await dispatchPerChildBulk(childInputsByChild, tenantId, errors);
	}

	logger.info('[activity-import] インポート完了', {
		context: {
			tenantId,
			imported,
			skipped,
			errors: errors.length,
			presetId: presetId ?? null,
			applyMustDefault,
			childIdsCount: childIds.length,
		},
	});

	return { imported, skipped, errors };
}
