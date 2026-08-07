import { jstDateToInstant, jstDayOfWeek, jstHour } from '$lib/domain/date-utils';
import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/checklist-service.ts
// チェックリスト サービス層

import {
	assignTemplateToChildren,
	deleteOverride,
	deleteTemplate,
	deleteTemplateItem,
	findAssignmentsByChild,
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

// #3424 DSQL 移管: TimeSlot SSOT は $lib/domain/constants/checklist-time-slot に移設
// (db 層の CHECK 生成 fitness#13 が参照するため、db → service の層逆転 import を回避)。
// 既存 import 互換のため本 module から re-export する。
import { type TimeSlot, VALID_TIME_SLOTS } from '$lib/domain/constants/checklist-time-slot';

export type { TimeSlot };
export { VALID_TIME_SLOTS };

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
	const hour = jstHour();
	if (hour >= 5 && hour < 12) return 'morning';
	if (hour >= 12 && hour < 17) return 'afternoon';
	return 'evening';
}

export interface ChecklistItem {
	/** Template item ID ('-' prefix for override-added items) */
	id: string;
	name: string;
	icon: string;
	checked: boolean;
	source: 'template' | 'override';
}

export interface TodayChecklist {
	templateId: string;
	templateName: string;
	templateIcon: string;
	timeSlot: TimeSlot;
	// #1755 (#1709-A): kind 削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管）
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
	return DAY_NAMES[jstDayOfWeek(jstDateToInstant(dateStr))] as string;
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
	childId: ChildId,
	templateId: string,
	date: string,
	tenantId: string,
): Promise<TodayChecklist | { error: 'NOT_FOUND'; target: string }> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	// #2362 PR-5 (ADR-0055): family master 化に伴い、child との関連は assignments で判定する。
	// 配信先 child でなければ NOT_FOUND を返す (per-child instance 時代と同等の挙動)。
	const childAssignments = await findAssignmentsByChild(childId, tenantId);
	if (!childAssignments.some((a) => a.templateId === templateId)) {
		return { error: 'NOT_FOUND', target: 'template' };
	}

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
			id: `-${ov.id}`,
			name: ov.itemName,
			icon: ov.icon,
			checked: false,
			source: 'override',
		});
	}

	// 5. 本日のチェック記録を照会して反映
	const log = await findTodayLog(childId, templateId, date, tenantId);
	// 旧行の itemsJson は number 配列 (legacy)。String 正規化で新旧どちらの保存形式も照合できる。
	const checkedItemIds: string[] = log
		? (JSON.parse(log.itemsJson) as (number | string)[]).map(String)
		: [];
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
	childId: ChildId,
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
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function toggleCheckItem(
	childId: ChildId,
	templateId: string,
	itemId: string,
	date: string,
	checked: boolean,
	tenantId: string,
): Promise<CheckItemResult | { error: 'NOT_FOUND'; target: string }> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return { error: 'NOT_FOUND', target: 'template' };
	// #2362 PR-5 (ADR-0055): family master 化に伴い、child との関連は assignments で判定する。
	const childAssignments = await findAssignmentsByChild(childId, tenantId);
	if (!childAssignments.some((a) => a.templateId === templateId)) {
		return { error: 'NOT_FOUND', target: 'template' };
	}

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

/**
 * #2362 PR-5 (ADR-0055): family master 化に伴い childId は配信先 child の hint として扱う。
 *   - 旧 API 互換: `childId` を渡すと family master template を作成し、その child に
 *     自動的に assignment を 1 件作成する (1:1 互換 view を提供)。
 *   - 新 API: `childIds` を渡すと複数 child に配信 (Phase 2 admin UX で `childIds` 経路を採用)。
 *   - `childId` も `childIds` も渡されない場合は family master のみ作成 (assignment 0 件)。
 */
export async function createTemplate(
	input: {
		/** legacy 互換: 単一 child binding (内部で childIds=[childId] と等価) */
		childId?: ChildId;
		/** family checklist の配信先 child 群 (#2362 PR-5) */
		childIds?: readonly ChildId[];
		name: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		timeSlot?: string;
		// #1755 (#1709-A): kind 削除 — 持ち物純化
		sourcePresetId?: string | null;
	},
	tenantId: string,
) {
	const template = await insertTemplate(
		{
			name: input.name,
			icon: input.icon ?? '📋',
			pointsPerItem: input.pointsPerItem ?? 2,
			completionBonus: input.completionBonus ?? 5,
			timeSlot: input.timeSlot ?? 'anytime',
			sourcePresetId: input.sourcePresetId ?? null,
		},
		tenantId,
	);

	const distributeTo: readonly ChildId[] = input.childIds ?? (input.childId ? [input.childId] : []);
	if (distributeTo.length > 0) {
		await assignTemplateToChildren(template.id, distributeTo, tenantId);
	}

	return template;
}

export async function editTemplate(
	id: string,
	input: {
		name?: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		timeSlot?: string;
		isActive?: number;
		// #1755 (#1709-A): kind 削除
	},
	tenantId: string,
) {
	return await updateTemplate(id, input, tenantId);
}

export async function removeTemplate(id: string, tenantId: string) {
	await deleteTemplate(id, tenantId);
}

export async function addTemplateItem(
	input: {
		templateId: string;
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

// #2845 B1: templateId 所有権検証付き (composite key)
export async function removeTemplateItem(templateId: string, id: string, tenantId: string) {
	await deleteTemplateItem(templateId, id, tenantId);
}

export async function addOverride(
	input: {
		childId: ChildId;
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

// #2845 B1: childId 所有権検証付き (composite key)
export async function removeOverride(childId: ChildId, id: string, tenantId: string) {
	await deleteOverride(childId, id, tenantId);
}
