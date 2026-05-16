// src/lib/server/services/checklist-template-import-service.ts
// #2137 (MP-2): event-checklist 一括追加サービス
//
// activity-import-service.ts を template として横展開（ADR-0014 整合）。
// マーケットプレイス checklist 系プリセット (event-pool / event-school-start / event-field-trip
// など) を `checklist_templates` + `checklist_template_items` に一括投入する。
// 重複検出は `checklist_templates.sourcePresetId` (#1254 G1 整備済) を使い、
// 同一 (childId × presetId) のテンプレートが既に存在する場合は丸ごとスキップする。

import { getMarketplaceItem } from '$lib/data/marketplace';
import type { ChecklistPayload, MarketplaceItem } from '$lib/domain/marketplace-item';
import { findTemplatesByChild } from '$lib/server/db/checklist-repo';
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

	// #1254 G1 sourcePresetId による既存判定（重複検出）
	const existingTemplates = await findTemplatesByChild(childId, tenantId, true);
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
	const item: MarketplaceItem | null = getMarketplaceItem('checklist', presetId);
	if (!item) {
		throw new Error(`Marketplace preset 'checklist/${presetId}' が見つかりません`);
	}
	const payload = item.payload as ChecklistPayload;

	// #1254 G1 sourcePresetId による既存判定（preset 全体スキップ）
	const existingTemplates = await findTemplatesByChild(childId, tenantId, true);
	const duplicate = existingTemplates.find((t) => t.sourcePresetId === presetId);
	if (duplicate) {
		logger.info('[checklist-import] 既に同 preset で取込済 → スキップ', {
			context: { tenantId, childId, presetId, existingTemplateId: duplicate.id },
		});
		return { imported: 0, skipped: 1, importedItems: 0, errors: [] };
	}

	const timeSlot = options?.timeSlot ?? normalizeTimeSlot(payload.timing);

	// 1. template 本体を作成
	const template = await createTemplate(
		{
			childId,
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
			childId,
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
