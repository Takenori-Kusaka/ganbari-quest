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

export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'anytime';

/** Single source of truth for valid TimeSlot values (used for server-side validation). */
export const VALID_TIME_SLOTS: readonly TimeSlot[] = ['morning', 'afternoon', 'evening', 'anytime'];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
	morning: 'あさ',
	afternoon: 'ひる',
	evening: 'よる',
	anytime: 'いつでも',
};

export const TIME_SLOT_ICONS: Record<TimeSlot, string> = {
	morning: '☀️',
	afternoon: '🌤️',
	evening: '🌙',
	anytime: '🕐',
};

/**
 * 現在の時間帯を JST ベースで判定する。
 * あさ: 5:00-11:59, ひる: 12:00-16:59, よる: 17:00-4:59
 */
export function getCurrentTimeSlot(): TimeSlot {
	const now = new Date();
	const jstHour = (now.getUTCHours() + 9) % 24;
	if (jstHour >= 5 && jstHour < 12) return 'morning';
	if (jstHour >= 12 && jstHour < 17) return 'afternoon';
	return 'evening';
}

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
	timeSlot: TimeSlot;
	// #1168: 'item' | 'routine' — 子供画面で種別グルーピング表示に使用
	kind: string;
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
	return DAY_NAMES[d.getUTCDay()] as string;
}

// ============================================================
// 当日チェックリスト生成
// ============================================================

/**
 * 当日のチェックリストを生成する。
 * テンプレートの frequency + overrides で当日に必要なアイテムを決定し、
 * チェック記録があれば反映する。
 */
export async function getTodayChecklist(
	childId: number,
	templateId: number,
	date: string,
	tenantId: string,
): Promise<TodayChecklist | { error: 'NOT_FOUND'; target: string }> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	if (template.childId !== childId) return { error: 'NOT_FOUND', target: 'template' };

	const dayOfWeek = getDayOfWeek(date);
	const allItems = await findTemplateItems(templateId, tenantId);

	// 1. daily + 当該曜日のアイテムをフィルタ
	const todayTemplateItems = allItems.filter(
		(item) => item.frequency === 'daily' || item.frequency === `weekday:${dayOfWeek}`,
	);

	// 2. overrides 適用
	const overrides = await findOverrides(childId, date, tenantId);
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
	const log = await findTodayLog(childId, templateId, date, tenantId);
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
		timeSlot: (template.timeSlot ?? 'anytime') as TimeSlot,
		kind: template.kind ?? 'routine',
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
 * 現在の時間帯に該当するテンプレートを先頭に、次に「いつでも」、その他を後ろにソートする。
 */
export async function getChecklistsForChild(
	childId: number,
	date: string,
	tenantId: string,
): Promise<TodayChecklist[]> {
	const templates = await findTemplatesByChild(childId, tenantId, false);
	const results: TodayChecklist[] = [];

	for (const tpl of templates) {
		const checklist = await getTodayChecklist(childId, tpl.id, date, tenantId);
		if ('error' in checklist) continue;
		results.push(checklist);
	}

	// 現在の時間帯に基づいてソート: 該当時間帯 → いつでも → その他
	const current = getCurrentTimeSlot();
	results.sort((a, b) => {
		const priority = (slot: TimeSlot) => {
			if (slot === current) return 0;
			if (slot === 'anytime') return 1;
			return 2;
		};
		return priority(a.timeSlot) - priority(b.timeSlot);
	});

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
// biome-ignore lint/complexity/useMaxParams: 既存コード、別Issueで対応予定
export async function toggleCheckItem(
	childId: number,
	templateId: number,
	itemId: number,
	date: string,
	checked: boolean,
	tenantId: string,
): Promise<CheckItemResult | { error: 'NOT_FOUND'; target: string }> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	if (template.childId !== childId) return { error: 'NOT_FOUND', target: 'template' };

	// 現在のチェックリストを取得
	const checklist = await getTodayChecklist(childId, templateId, date, tenantId);
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
	await upsertLog(
		{
			childId,
			templateId,
			checkedDate: date,
			itemsJson: JSON.stringify(checkedIds),
			completedAll: completedAll ? 1 : 0,
			pointsAwarded,
		},
		tenantId,
	);

	// 全完了時にポイント台帳に記録
	if (newlyCompleted) {
		await insertPointEntry(
			{
				childId,
				amount: pointsAwarded,
				type: 'checklist',
				description: `${template.name} 全完了！`,
			},
			tenantId,
		);
	} else if (wasCompletedAll && !completedAll) {
		// 全完了から戻った場合、ポイントを取り消す
		const previousPoints = checklist.pointsAwarded;
		if (previousPoints > 0) {
			await insertPointEntry(
				{
					childId,
					amount: -previousPoints,
					type: 'checklist_cancel',
					description: `${template.name} チェック解除`,
				},
				tenantId,
			);
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

export async function createTemplate(
	input: {
		childId: number;
		name: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		timeSlot?: string;
		// #1168: 'item' | 'routine' — default 'routine'
		kind?: string;
		sourcePresetId?: string | null;
	},
	tenantId: string,
) {
	return await insertTemplate(
		{
			childId: input.childId,
			name: input.name,
			icon: input.icon ?? '📋',
			pointsPerItem: input.pointsPerItem ?? 2,
			completionBonus: input.completionBonus ?? 5,
			timeSlot: input.timeSlot ?? 'anytime',
			kind: input.kind ?? 'routine',
			sourcePresetId: input.sourcePresetId ?? null,
		},
		tenantId,
	);
}

export async function editTemplate(
	id: number,
	input: {
		name?: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		timeSlot?: string;
		isActive?: number;
		kind?: string;
	},
	tenantId: string,
) {
	return await updateTemplate(id, input, tenantId);
}

export async function removeTemplate(id: number, tenantId: string) {
	await deleteTemplate(id, tenantId);
}

export async function addTemplateItem(
	input: {
		templateId: number;
		name: string;
		icon?: string;
		frequency?: string;
		direction?: string;
		sortOrder?: number;
	},
	tenantId: string,
) {
	return await insertTemplateItem(
		{
			templateId: input.templateId,
			name: input.name,
			icon: input.icon ?? '🏫',
			frequency: input.frequency ?? 'daily',
			direction: input.direction ?? 'bring',
			sortOrder: input.sortOrder ?? 0,
		},
		tenantId,
	);
}

export async function removeTemplateItem(id: number, tenantId: string) {
	await deleteTemplateItem(id, tenantId);
}

export async function addOverride(
	input: {
		childId: number;
		targetDate: string;
		action: string;
		itemName: string;
		icon?: string;
	},
	tenantId: string,
) {
	return await insertOverride(
		{
			childId: input.childId,
			targetDate: input.targetDate,
			action: input.action,
			itemName: input.itemName,
			icon: input.icon ?? '📦',
		},
		tenantId,
	);
}

export async function removeOverride(id: number, tenantId: string) {
	await deleteOverride(id, tenantId);
}
