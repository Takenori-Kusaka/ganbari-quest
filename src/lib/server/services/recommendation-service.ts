// src/lib/server/services/recommendation-service.ts
// #0264 G2: おすすめ活動の選定ロジック（カテゴリ分散・難易度・日替わり）

import { getSetting } from '$lib/server/db/settings-repo';
import type { Activity } from '$lib/server/db/types';

export interface RecommendedActivity {
	activityId: number;
	reason: 'category_diversity' | 'easy_win' | 'daily_rotation';
}

/**
 * フォーカスモードの有効/無効を判定
 * 初回アクセスから3日間有効（settings で制御）
 */
export async function isFocusModeActive(childId: number, tenantId: string): Promise<boolean> {
	const key = `focus_mode_start_${childId}`;
	const startDate = await getSetting(key, tenantId);
	if (!startDate) return true; // まだ開始日がない = 初回 → 有効
	const start = new Date(startDate);
	const now = new Date();
	const daysDiff = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
	return daysDiff < 3;
}

/**
 * フォーカスモード開始日を記録（初回のみ）
 */
export async function markFocusModeStart(childId: number, tenantId: string): Promise<void> {
	const { setSetting } = await import('$lib/server/db/settings-repo');
	const key = `focus_mode_start_${childId}`;
	const existing = await getSetting(key, tenantId);
	if (!existing) {
		const today = new Date().toISOString().split('T')[0] ?? '';
		await setSetting(key, today, tenantId);
	}
}

/**
 * おすすめ活動3件を選定
 *
 * 選定ルール:
 * 1. カテゴリ分散 — 異なるカテゴリから1件ずつ
 * 2. 難易度優先 — basePoints が低い（=簡単な）活動を優先
 * 3. 日替わり — 日付ベースのハッシュで毎日異なる組み合わせ
 */
export function selectRecommendations(
	activities: Activity[],
	date: string,
	count = 3,
): RecommendedActivity[] {
	if (activities.length === 0) return [];

	// 可視活動のみ
	const visible = activities.filter((a) => a.isVisible);
	if (visible.length === 0) return [];

	// カテゴリ別にグループ化
	const byCategory = new Map<number, Activity[]>();
	for (const a of visible) {
		const group = byCategory.get(a.categoryId) ?? [];
		group.push(a);
		byCategory.set(a.categoryId, group);
	}

	// 各カテゴリ内をポイント昇順にソート（簡単なものを優先）
	for (const group of byCategory.values()) {
		group.sort((a, b) => a.basePoints - b.basePoints);
	}

	// 日替わりシード: 日付文字列から簡易ハッシュ
	const seed = dateHash(date);
	const categoryIds = [...byCategory.keys()].sort((a, b) => a - b);

	// ラウンドロビンで各カテゴリから1件ずつ選択
	const selected: RecommendedActivity[] = [];
	let catIndex = seed % categoryIds.length;

	for (let i = 0; i < count && i < visible.length; i++) {
		const catId = categoryIds[catIndex % categoryIds.length];
		if (catId === undefined) break;
		const group = byCategory.get(catId);
		if (!group || group.length === 0) {
			catIndex++;
			continue;
		}

		// 日替わりオフセットでグループ内の位置を決定
		const itemIndex = (seed + i) % group.length;
		const activity = group[itemIndex];
		if (!activity) {
			catIndex++;
			continue;
		}

		// 重複チェック
		if (!selected.some((s) => s.activityId === activity.id)) {
			selected.push({
				activityId: activity.id,
				reason: i === 0 ? 'category_diversity' : i === 1 ? 'easy_win' : 'daily_rotation',
			});
		}

		catIndex++;
	}

	// カテゴリが少ない場合、不足分を未選択の活動から補充
	if (selected.length < count) {
		const selectedIds = new Set(selected.map((s) => s.activityId));
		for (const a of visible) {
			if (selected.length >= count) break;
			if (!selectedIds.has(a.id)) {
				selected.push({ activityId: a.id, reason: 'daily_rotation' });
				selectedIds.add(a.id);
			}
		}
	}

	return selected.slice(0, count);
}

/** 日付文字列から簡易ハッシュ値を生成（日替わり用） */
function dateHash(date: string): number {
	let hash = 0;
	for (let i = 0; i < date.length; i++) {
		const char = date.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return Math.abs(hash);
}
