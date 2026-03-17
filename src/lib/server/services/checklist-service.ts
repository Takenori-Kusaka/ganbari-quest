// src/lib/server/services/checklist-service.ts
// チェックリスト サービス層

import {
	deleteOverride,
	deleteTemplate,
	deleteTemplateItem,
	findOverrides,
	findTemplateById,
	findTemplateItems,
	findTemplatesByChild,
	findTodayLog,
	insertOverride,
	insertTemplate,
	insertTemplateItem,
	updateTemplate,
	upsertLog,
} from '$lib/server/db/checklist-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';

// ============================================================
// Types
// ============================================================

export interface ChecklistItem {
	/** Template item ID (negative for override-added items) */
	id: number;
	name: string;
	icon: string;
	checked: boolean;
	source: 'template' | 'override';
}

export interface TodayChecklist {
	templateId: number;
	templateName: string;
	templateIcon: string;
	pointsPerItem: number;
	completionBonus: number;
	items: ChecklistItem[];
	checkedCount: number;
	totalCount: number;
	completedAll: boolean;
	pointsAwarded: number;
}

// ============================================================
// 曜日ユーティリティ
// ============================================================

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

function getDayOfWeek(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	return DAY_NAMES[d.getUTCDay()]!;
}

// ============================================================
// 当日チェックリスト生成
// ============================================================

/**
 * 当日のチェックリストを生成する。
 * テンプレートの frequency + overrides で当日に必要なアイテムを決定し、
 * チェック記録があれば反映する。
 */
export function getTodayChecklist(
	childId: number,
	templateId: number,
	date: string,
): TodayChecklist | { error: 'NOT_FOUND'; target: string } {
	const template = findTemplateById(templateId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	if (template.childId !== childId) return { error: 'NOT_FOUND', target: 'template' };

	const dayOfWeek = getDayOfWeek(date);
	const allItems = findTemplateItems(templateId);

	// 1. daily + 当該曜日のアイテムをフィルタ
	const todayTemplateItems = allItems.filter(
		(item) => item.frequency === 'daily' || item.frequency === `weekday:${dayOfWeek}`,
	);

	// 2. overrides 適用
	const overrides = findOverrides(childId, date);
	const removeNames = new Set(
		overrides.filter((o) => o.action === 'remove').map((o) => o.itemName),
	);

	// 3. テンプレートアイテム（removeされたものを除外）
	const items: ChecklistItem[] = todayTemplateItems
		.filter((item) => !removeNames.has(item.name))
		.map((item) => ({
			id: item.id,
			name: item.name,
			icon: item.icon,
			checked: false,
			source: 'template' as const,
		}));

	// 4. override の add アイテムを追加（負のIDで識別）
	const addOverrides = overrides.filter((o) => o.action === 'add');
	for (const ov of addOverrides) {
		items.push({
			id: -ov.id,
			name: ov.itemName,
			icon: ov.icon,
			checked: false,
			source: 'override',
		});
	}

	// 5. 本日のチェック記録を照会して反映
	const log = findTodayLog(childId, templateId, date);
	const checkedItemIds: number[] = log ? JSON.parse(log.itemsJson) : [];
	const checkedSet = new Set(checkedItemIds);

	for (const item of items) {
		if (checkedSet.has(item.id)) {
			item.checked = true;
		}
	}

	const checkedCount = items.filter((i) => i.checked).length;
	const totalCount = items.length;
	const completedAll = totalCount > 0 && checkedCount === totalCount;

	return {
		templateId: template.id,
		templateName: template.name,
		templateIcon: template.icon,
		pointsPerItem: template.pointsPerItem,
		completionBonus: template.completionBonus,
		items,
		checkedCount,
		totalCount,
		completedAll,
		pointsAwarded: log?.pointsAwarded ?? 0,
	};
}

/**
 * 子供のアクティブなテンプレート一覧と当日チェックリストを取得する。
 */
export function getChecklistsForChild(childId: number, date: string): TodayChecklist[] {
	const templates = findTemplatesByChild(childId);
	const results: TodayChecklist[] = [];

	for (const tpl of templates) {
		const checklist = getTodayChecklist(childId, tpl.id, date);
		if ('error' in checklist) continue;
		results.push(checklist);
	}

	return results;
}

// ============================================================
// チェック操作
// ============================================================

export interface CheckItemResult {
	checkedCount: number;
	totalCount: number;
	completedAll: boolean;
	pointsAwarded: number;
	newlyCompleted: boolean;
}

/**
 * アイテムをチェック/アンチェックする。
 * 全完了時にポイントを付与する。
 */
export function toggleCheckItem(
	childId: number,
	templateId: number,
	itemId: number,
	date: string,
	checked: boolean,
): CheckItemResult | { error: 'NOT_FOUND'; target: string } {
	const template = findTemplateById(templateId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	if (template.childId !== childId) return { error: 'NOT_FOUND', target: 'template' };

	// 現在のチェックリストを取得
	const checklist = getTodayChecklist(childId, templateId, date);
	if ('error' in checklist) return checklist;

	// アイテムの存在確認
	const item = checklist.items.find((i) => i.id === itemId);
	if (!item) return { error: 'NOT_FOUND', target: 'item' };

	// チェック状態を更新
	const wasCompletedAll = checklist.completedAll;
	item.checked = checked;

	const checkedIds = checklist.items.filter((i) => i.checked).map((i) => i.id);
	const checkedCount = checkedIds.length;
	const totalCount = checklist.items.length;
	const completedAll = totalCount > 0 && checkedCount === totalCount;
	const newlyCompleted = completedAll && !wasCompletedAll;

	// ポイント計算
	let pointsAwarded = checkedCount * template.pointsPerItem;
	if (completedAll) {
		pointsAwarded += template.completionBonus;
	}

	// ログを更新
	upsertLog({
		childId,
		templateId,
		checkedDate: date,
		itemsJson: JSON.stringify(checkedIds),
		completedAll: completedAll ? 1 : 0,
		pointsAwarded,
	});

	// 全完了時にポイント台帳に記録
	if (newlyCompleted) {
		insertPointEntry({
			childId,
			amount: pointsAwarded,
			type: 'checklist',
			description: `${template.name} 全完了！`,
		});
	} else if (wasCompletedAll && !completedAll) {
		// 全完了から戻った場合、ポイントを取り消す
		const previousPoints = checklist.pointsAwarded;
		if (previousPoints > 0) {
			insertPointEntry({
				childId,
				amount: -previousPoints,
				type: 'checklist_cancel',
				description: `${template.name} チェック解除`,
			});
		}
	}

	return {
		checkedCount,
		totalCount,
		completedAll,
		pointsAwarded,
		newlyCompleted,
	};
}

// ============================================================
// テンプレート管理（親画面用）
// ============================================================

export function createTemplate(input: {
	childId: number;
	name: string;
	icon?: string;
	pointsPerItem?: number;
	completionBonus?: number;
}) {
	return insertTemplate({
		childId: input.childId,
		name: input.name,
		icon: input.icon ?? '📋',
		pointsPerItem: input.pointsPerItem ?? 2,
		completionBonus: input.completionBonus ?? 5,
	});
}

export function editTemplate(
	id: number,
	input: {
		name?: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		isActive?: number;
	},
) {
	return updateTemplate(id, input);
}

export function removeTemplate(id: number) {
	deleteTemplate(id);
}

export function addTemplateItem(input: {
	templateId: number;
	name: string;
	icon?: string;
	frequency?: string;
	direction?: string;
	sortOrder?: number;
}) {
	return insertTemplateItem({
		templateId: input.templateId,
		name: input.name,
		icon: input.icon ?? '🏫',
		frequency: input.frequency ?? 'daily',
		direction: input.direction ?? 'bring',
		sortOrder: input.sortOrder ?? 0,
	});
}

export function removeTemplateItem(id: number) {
	deleteTemplateItem(id);
}

export function addOverride(input: {
	childId: number;
	targetDate: string;
	action: string;
	itemName: string;
	icon?: string;
}) {
	return insertOverride({
		childId: input.childId,
		targetDate: input.targetDate,
		action: input.action,
		itemName: input.itemName,
		icon: input.icon ?? '📦',
	});
}

export function removeOverride(id: number) {
	deleteOverride(id);
}
