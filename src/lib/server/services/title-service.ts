// src/lib/server/services/title-service.ts
// 称号コレクションサービス層

import { db } from '$lib/server/db';
import {
	findAllTitles,
	findUnlockedTitles,
	getActiveTitleId,
	insertChildTitle,
	isTitleUnlocked,
	setActiveTitleId,
} from '$lib/server/db/title-repo';
import { titles } from '$lib/server/db/schema';
import { getChildStatus } from '$lib/server/services/status-service';
import { activityLogs } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

// --- 型定義 ---

export interface UnlockedTitle {
	titleId: number;
	code: string;
	name: string;
	icon: string;
	rarity: string;
}

export interface TitleWithStatus {
	id: number;
	code: string;
	name: string;
	description: string | null;
	icon: string;
	conditionType: string;
	conditionValue: number;
	rarity: string;
	sortOrder: number;
	unlockedAt: string | null;
	isActive: boolean;
	conditionLabel: string;
	currentProgress: number;
}

export interface ActiveTitleInfo {
	id: number;
	name: string;
	icon: string;
	rarity: string;
}

// --- 称号チェック + 解除 ---

/** 全条件をチェックし、新規解除した称号を返す */
export function checkAndUnlockTitles(childId: number): UnlockedTitle[] {
	const allTitles = findAllTitles();
	const newlyUnlocked: UnlockedTitle[] = [];

	// ステータスデータを1回だけ取得
	const statusResult = getChildStatus(childId);
	if ('error' in statusResult) return newlyUnlocked;

	for (const title of allTitles) {
		if (isTitleUnlocked(childId, title.id)) continue;

		const met = evaluateCondition(childId, title, statusResult);
		if (met) {
			insertChildTitle(childId, title.id);
			newlyUnlocked.push({
				titleId: title.id,
				code: title.code,
				name: title.name,
				icon: title.icon,
				rarity: title.rarity,
			});
		}
	}

	return newlyUnlocked;
}

/** 全称号一覧（解除状態+進捗付き）を返す */
export function getChildTitles(childId: number): TitleWithStatus[] {
	const allTitles = findAllTitles();
	const unlocked = findUnlockedTitles(childId);
	const activeTitleId = getActiveTitleId(childId);

	const unlockedMap = new Map(unlocked.map((u) => [u.titleId, u.unlockedAt]));

	// ステータスデータを取得（進捗計算用）
	const statusResult = getChildStatus(childId);
	const status = 'error' in statusResult ? null : statusResult;

	return allTitles.map((title) => {
		const extra = title.conditionExtra ? JSON.parse(title.conditionExtra) : null;
		return {
			id: title.id,
			code: title.code,
			name: title.name,
			description: title.description,
			icon: title.icon,
			conditionType: title.conditionType,
			conditionValue: title.conditionValue,
			rarity: title.rarity,
			sortOrder: title.sortOrder,
			unlockedAt: unlockedMap.get(title.id) ?? null,
			isActive: title.id === activeTitleId,
			conditionLabel: getConditionLabel(title.conditionType, title.conditionValue, extra),
			currentProgress: status
				? getCurrentProgress(childId, title.conditionType, title.conditionValue, extra, status)
				: 0,
		};
	});
}

/** アクティブ称号を設定（解除済みのみ許可、nullで解除） */
export function setActiveTitle(
	childId: number,
	titleId: number | null,
): { success: true } | { error: string } {
	if (titleId !== null) {
		if (!isTitleUnlocked(childId, titleId)) {
			return { error: 'TITLE_NOT_UNLOCKED' };
		}
	}
	setActiveTitleId(childId, titleId);
	return { success: true };
}

/** アクティブ称号の情報を返す */
export function getActiveTitle(childId: number): ActiveTitleInfo | null {
	const titleId = getActiveTitleId(childId);
	if (titleId === null) return null;

	const title = db.select().from(titles).where(eq(titles.id, titleId)).get();
	if (!title) return null;

	return {
		id: title.id,
		name: title.name,
		icon: title.icon,
		rarity: title.rarity,
	};
}

// --- 内部ヘルパー ---

interface StatusResult {
	level: number;
	statuses: Record<number, { deviationScore: number }>;
}

function evaluateCondition(
	childId: number,
	title: { conditionType: string; conditionValue: number; conditionExtra: string | null },
	status: StatusResult,
): boolean {
	const extra = title.conditionExtra ? JSON.parse(title.conditionExtra) : null;

	switch (title.conditionType) {
		case 'category_deviation': {
			const categoryId = extra?.categoryId as number;
			if (!categoryId) return false;
			const catStatus = status.statuses[categoryId];
			return catStatus ? catStatus.deviationScore >= title.conditionValue : false;
		}
		case 'streak_days':
			return getMaxStreakDays(childId) >= title.conditionValue;
		case 'level_reach':
			return status.level >= title.conditionValue;
		case 'all_categories_deviation': {
			const categoryIds = [1, 2, 3, 4, 5];
			return categoryIds.every((catId) => {
				const catStatus = status.statuses[catId];
				return catStatus ? catStatus.deviationScore >= title.conditionValue : false;
			});
		}
		default:
			return false;
	}
}

function getCurrentProgress(
	childId: number,
	conditionType: string,
	conditionValue: number,
	extra: Record<string, unknown> | null,
	status: StatusResult,
): number {
	let current = 0;

	switch (conditionType) {
		case 'category_deviation': {
			const categoryId = extra?.categoryId as number;
			if (!categoryId) return 0;
			const catStatus = status.statuses[categoryId];
			current = catStatus?.deviationScore ?? 0;
			break;
		}
		case 'streak_days':
			current = getMaxStreakDays(childId);
			break;
		case 'level_reach':
			current = status.level;
			break;
		case 'all_categories_deviation': {
			// 全カテゴリの偏差値のうち最低値を進捗として返す
			const categoryIds = [1, 2, 3, 4, 5];
			const deviations = categoryIds.map(
				(catId) => status.statuses[catId]?.deviationScore ?? 0,
			);
			current = Math.min(...deviations);
			break;
		}
		default:
			return 0;
	}

	// パーセンテージで返す（100が達成）
	return Math.min(100, Math.round((current / conditionValue) * 100));
}

/** 最大連続日数を取得 */
function getMaxStreakDays(childId: number): number {
	const rows = db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.groupBy(activityLogs.recordedDate)
		.orderBy(activityLogs.recordedDate)
		.all();

	if (rows.length === 0) return 0;

	let maxStreak = 1;
	let currentStreak = 1;

	for (let i = 1; i < rows.length; i++) {
		const prev = new Date(`${rows[i - 1]?.recordedDate}T00:00:00Z`);
		const curr = new Date(`${rows[i]?.recordedDate}T00:00:00Z`);
		const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		if (diffDays === 1) {
			currentStreak++;
			if (currentStreak > maxStreak) maxStreak = currentStreak;
		} else {
			currentStreak = 1;
		}
	}

	return maxStreak;
}

function getConditionLabel(
	conditionType: string,
	conditionValue: number,
	extra: Record<string, unknown> | null,
): string {
	const categoryNames: Record<number, string> = {
		1: 'うんどう',
		2: 'べんきょう',
		3: 'せいかつ',
		4: 'こうりゅう',
		5: 'そうぞう',
	};

	switch (conditionType) {
		case 'category_deviation': {
			const catName = categoryNames[extra?.categoryId as number] ?? '?';
			return `${catName}のへんさち${conditionValue}いじょう`;
		}
		case 'streak_days':
			return `${conditionValue}にちれんぞくかつどう`;
		case 'level_reach':
			return `レベル${conditionValue}にとうたつ`;
		case 'all_categories_deviation':
			return `ぜんカテゴリへんさち${conditionValue}いじょう`;
		default:
			return '';
	}
}
