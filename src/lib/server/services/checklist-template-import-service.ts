// src/lib/server/services/checklist-template-import-service.ts
// #2137 (MP-2): event-checklist 一括追加サービス
//
// activity-import-service.ts を template として横展開（ADR-0014 整合）。
// マーケットプレイス checklist 系プリセット (event-pool / event-school-start / event-field-trip
// など) を `checklist_templates` + `checklist_template_items` に一括投入する。
// 重複検出は `checklist_templates.sourcePresetId` (#1254 G1 整備済) を使い、
// 同一 (childId × presetId) のテンプレートが既に存在する場合は丸ごとスキップする。
//
// @deprecated #2367 (EPIC #2362 P3): 本 service は Strangler Fig pattern により
//   `$lib/marketplace/strategies/checklist-strategy.ts` に rewrap された。
//   新規 callsite は `dispatchImport({ typeCode: 'checklist', ... })` 経由で呼ぶこと。
//   本 service は 1 release 並行稼働後 (別 Issue で撤去) 完全削除予定。
//   現状の callsite (`+page.server.ts` 2 ヶ所) はすべて新 Strategy 経由に移行済み。

import { getMarketplaceItem } from '$lib/data/marketplace';
import type { ChecklistPayload, MarketplaceItem } from '$lib/domain/marketplace-item';
import { findTemplatesByTenant } from '$lib/server/db/checklist-repo';
import { logger } from '$lib/server/logger';
import { addTemplateItem, createTemplate } from '$lib/server/services/checklist-service';

export interface ChecklistImportPreview {
	/** Preset itemId (例: 'event-pool') */
	presetId: string;
	/** Preset 表示名 (例: 'プールの もちもの') */
	presetName: string;
	/** Preset icon (例: '🏊') */
	presetIcon: string;
	/** Preset 内の item 数 (例: 10) */
	itemCount: number;
	/** 既に同 (childId × presetId) で取込済か */
	alreadyImported: boolean;
	/** 既に取込済の場合、その template の表示名（衝突告知用） */
	existingTemplateName?: string;
}

export interface ChecklistImportResult {
	/** 新規追加された template 数 (0 or 1。重複 import 時は 0) */
	imported: number;
	/** スキップされた template 数 (重複時 1) */
	skipped: number;
	/** 追加された item 数 */
	importedItems: number;
	/** エラーメッセージ (item 個別失敗のみ。template 全体失敗時は throw) */
	errors: string[];
	/** 作成された template ID (imported=1 時のみ) */
	templateId?: number;
}

/**
 * インポート対象の checklist preset をプレビュー（DB 書き込みなし）
 *
 * @deprecated #2367 (ADR-0052): checklist Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/checklist-strategy` 経由で本関数を呼び出し、
 *   戻り値は `ImportPreview` shape (`duplicates === total` で alreadyImported 判定) に正規化されます。
 *   1 release 経過後撤去予定。
 *
 * @param presetId  Marketplace item ID (例: 'event-pool')
 * @param childId   インポート先の子供 ID
 * @param tenantId  テナント ID
 */
export async function previewChecklistImport(
	presetId: string,
	childId: number,
	tenantId: string,
): Promise<ChecklistImportPreview | null> {
	const item = getMarketplaceItem('checklist', presetId);
	if (!item) {
		return null;
	}
	const payload = item.payload as ChecklistPayload;

	// #2362 PR-5: family master 化後は preset の重複は **tenant scope** で判定する
	// (childId が異なっても同 preset の family checklist が既に存在すれば重複扱い)。
	// Phase 1 では legacy 互換 hint として childId を受け取るが、判定は family scope。
	// Phase 2 admin UX で childId 引数自体を撤去予定。
	void childId;
	const existingTemplates = await findTemplatesByTenant(tenantId, true);
	const existing = existingTemplates.find((t) => t.sourcePresetId === presetId);

	return {
		presetId,
		presetName: item.name,
		presetIcon: item.icon,
		itemCount: payload.items.length,
		alreadyImported: existing != null,
		existingTemplateName: existing?.name,
	};
}

/**
 * チェックリストインポートのオプション
 *
 * @property timeSlot  ChecklistPayload.timing (morning/evening/weekend/daily/weekly) を
 *                     `checklist_templates.timeSlot` (morning/afternoon/evening/anytime) に
 *                     正規化した値。指定なしの場合は 'anytime' を使用。
 */
export interface ImportChecklistTemplateOptions {
	timeSlot?: string;
}

/**
 * Marketplace の ChecklistPayload.timing を checklist_templates.timeSlot に正規化する。
 *
 * checklist_templates.timeSlot の許容値は 'morning' | 'afternoon' | 'evening' | 'anytime' のみ
 * (`VALID_TIME_SLOTS` SSOT、checklist-service.ts)。event-* preset は全て timing='daily' のため
 * デフォルトで 'anytime' にマップする。
 */
function normalizeTimeSlot(timing: ChecklistPayload['timing']): string {
	if (timing === 'morning') return 'morning';
	if (timing === 'evening') return 'evening';
	// 'weekend' / 'daily' / 'weekly' は持ち物リスト用途では時間帯指定なしで扱う
	return 'anytime';
}

/**
 * Marketplace の checklist preset をテンプレート + items として一括投入する。
 *
 * 重複検出: 同一 (childId × sourcePresetId) のテンプレートが既に存在する場合は
 * 何も追加せず `imported=0 / skipped=1` で返却する。Items の個別重複検出は行わない
 * （preset は atomic unit として扱う、activity-import-service と同じ考え方）。
 *
 * @deprecated #2367 (ADR-0052): checklist Strategy 経由 (`dispatchImport`) を使用してください。
 *   `$lib/marketplace/strategies/checklist-strategy` 経由で本関数を呼び出し、
 *   戻り値は `ImportResult` shape (`imported / skipped / errors`) に正規化されます。
 *   1 release 経過後撤去予定。
 *
 * @param presetId  Marketplace item ID (例: 'event-pool')
 * @param childId   インポート先の子供 ID
 * @param tenantId  テナント ID
 * @param options   timeSlot 上書き等のオプション
 */
export async function importChecklistTemplate(
	presetId: string,
	childId: number,
	tenantId: string,
	options?: ImportChecklistTemplateOptions,
): Promise<ChecklistImportResult> {
	return importChecklistTemplateInternal(presetId, tenantId, {
		childIds: [childId],
		timeSlot: options?.timeSlot,
	});
}

/**
 * #2362 PR-5: family master 化に対応した新 import API。
 *   - Phase 2 admin UX で ChecklistDistributionDialog 経由で複数 child 配信時に使う想定
 *   - Phase 1 では `importChecklistTemplate` (single child binding 互換) の内部実装として使用
 *
 * 重複判定は **tenant scope** (同 preset の family checklist が既に存在すれば preset 全体 skip)。
 * 配信先 child 群は family checklist 作成と同時に assignments で記録する。
 */
export async function importChecklistTemplateForFamily(
	presetId: string,
	tenantId: string,
	options: {
		childIds: readonly number[];
		timeSlot?: string;
	},
): Promise<ChecklistImportResult> {
	return importChecklistTemplateInternal(presetId, tenantId, options);
}

async function importChecklistTemplateInternal(
	presetId: string,
	tenantId: string,
	options: {
		childIds: readonly number[];
		timeSlot?: string;
	},
): Promise<ChecklistImportResult> {
	const item: MarketplaceItem | null = getMarketplaceItem('checklist', presetId);
	if (!item) {
		throw new Error(`Marketplace preset 'checklist/${presetId}' が見つかりません`);
	}
	const payload = item.payload as ChecklistPayload;

	// #2362 PR-5: family scope 重複判定 (atomic unit = family-wide preset)
	const existingTemplates = await findTemplatesByTenant(tenantId, true);
	const duplicate = existingTemplates.find((t) => t.sourcePresetId === presetId);
	if (duplicate) {
		logger.info('[checklist-import] 既に同 preset で family scope 取込済 → スキップ', {
			context: { tenantId, presetId, existingTemplateId: duplicate.id },
		});
		return { imported: 0, skipped: 1, importedItems: 0, errors: [] };
	}

	const timeSlot = options.timeSlot ?? normalizeTimeSlot(payload.timing);

	// 1. family master template 本体を作成 + 配信先 child 群に assignment 自動付与
	const template = await createTemplate(
		{
			childIds: options.childIds,
			name: item.name,
			icon: item.icon,
			timeSlot,
			sourcePresetId: presetId,
		},
		tenantId,
	);

	// 2. items を順次追加
	const errors: string[] = [];
	let importedItems = 0;

	// preset の order 昇順に追加 (持ち物の表示順を維持)
	const sortedItems = [...payload.items].sort((a, b) => a.order - b.order);

	for (const ci of sortedItems) {
		try {
			await addTemplateItem(
				{
					templateId: template.id,
					name: ci.label,
					icon: ci.icon,
					frequency: 'daily',
					direction: 'bring',
					sortOrder: ci.order,
				},
				tenantId,
			);
			importedItems++;
		} catch (e) {
			errors.push(`「${ci.label}」: ${String(e)}`);
		}
	}

	logger.info('[checklist-import] インポート完了', {
		context: {
			tenantId,
			childIds: options.childIds,
			presetId,
			templateId: template.id,
			importedItems,
			errors: errors.length,
		},
	});

	return {
		imported: 1,
		skipped: 0,
		importedItems,
		errors,
		templateId: template.id,
	};
}
