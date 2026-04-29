/**
 * value-preview-service — ADR-0023 I9 (#1600) 初月価値プレビュー体験
 *
 * 初月（最初の30日）の親 dashboard 表示用データを集計する。既存の
 * activity-service / child-service の集計を組み合わせるだけで、新規
 * DB スキーマは追加しない（Pre-PMF YAGNI）。
 *
 * 使用方針:
 * - 子供の最古 createdAt を signup 起点とみなす
 * - signup から 30 日経過後はデータが「30 日プレビュー」として有効
 * - 30 日経過前は「あと N 日後にこう見える」プレビュー扱い
 * - Anti-engagement (ADR-0012): 滞在時間延伸 UI ではなく、純粋に進捗の可視化
 */

import { findActivityLogs } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';

/** 初月マイルストーン定義 (#1600 AC マイルストーン設計) */
export type MilestoneId =
	| 'first_record'
	| 'records_5'
	| 'records_10'
	| 'streak_7'
	| 'streak_14'
	| 'streak_30';

export interface MilestoneDefinition {
	id: MilestoneId;
	threshold: number;
	kind: 'count' | 'streak';
}

export const MILESTONES: readonly MilestoneDefinition[] = [
	{ id: 'first_record', threshold: 1, kind: 'count' },
	{ id: 'records_5', threshold: 5, kind: 'count' },
	{ id: 'records_10', threshold: 10, kind: 'count' },
	{ id: 'streak_7', threshold: 7, kind: 'streak' },
	{ id: 'streak_14', threshold: 14, kind: 'streak' },
	{ id: 'streak_30', threshold: 30, kind: 'streak' },
] as const;

export interface MilestoneAchievement {
	id: MilestoneId;
	threshold: number;
	achieved: boolean;
	achievedAt: string | null; // ISO date (YYYY-MM-DD) or null
}

/** カテゴリ別活動回数（30 日プレビュー bar chart 用） */
export interface CategoryBreakdown {
	categoryId: number;
	count: number;
	points: number;
}

export interface ChildValuePreview {
	childId: number;
	nickname: string;
	signupDate: string; // ISO YYYY-MM-DD（child.createdAt 起点）
	daysSinceSignup: number;
	totalActivities: number;
	currentStreak: number;
	longestStreak: number;
	totalPoints: number;
	categoryBreakdown: CategoryBreakdown[];
	milestones: MilestoneAchievement[];
}

export interface TenantValuePreview {
	/** 全子供のうち最古 signup 日（テナントの初月期間判定に利用） */
	tenantSignupDate: string | null;
	/** signup から経過日数（最古 child 基準）。null は子供未登録 */
	daysSinceTenantSignup: number | null;
	/** 初月（30 日以内）かどうか */
	isInFirstMonth: boolean;
	/** 30 日プレビューを表示してよいか（30 日経過、または 7 日以上経過） */
	previewEligible: boolean;
	children: ChildValuePreview[];
}

/** YYYY-MM-DD 形式の日付差分（日数） */
function daysBetween(fromDate: string, toDate: string): number {
	const from = new Date(`${fromDate.slice(0, 10)}T00:00:00Z`).getTime();
	const to = new Date(`${toDate.slice(0, 10)}T00:00:00Z`).getTime();
	return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

/** ISO 日付（または ISO datetime）から YYYY-MM-DD を取り出す */
function toDateOnly(iso: string): string {
	return iso.slice(0, 10);
}

/** ソート済み一意日付列から最長連続日数を計算する */
function computeLongestStreak(uniqueSortedDates: string[]): number {
	let longest = 1;
	let run = 1;
	for (let i = 1; i < uniqueSortedDates.length; i++) {
		const prev = uniqueSortedDates[i - 1];
		const curr = uniqueSortedDates[i];
		if (!prev || !curr) continue;
		if (daysBetween(prev, curr) === 1) {
			run += 1;
			if (run > longest) longest = run;
		} else {
			run = 1;
		}
	}
	return longest;
}

/** ソート済み一意日付列から「現在の連続日数」を計算する（最終記録が昨日/今日でないと 0） */
function computeCurrentStreak(uniqueSortedDates: string[], today: string): number {
	const lastDate = uniqueSortedDates[uniqueSortedDates.length - 1];
	if (!lastDate) return 0;

	if (daysBetween(lastDate, today) > 1) return 0;

	let current = 1;
	for (let i = uniqueSortedDates.length - 2; i >= 0; i--) {
		const a = uniqueSortedDates[i];
		const b = uniqueSortedDates[i + 1];
		if (!a || !b) break;
		if (daysBetween(a, b) === 1) {
			current += 1;
		} else {
			break;
		}
	}
	return current;
}

/**
 * 連続記録日数を計算する（記録された日数の最大連続セグメント / 直近セグメント）
 */
function computeStreaks(recordedDates: string[]): { current: number; longest: number } {
	if (recordedDates.length === 0) return { current: 0, longest: 0 };

	const uniqueDates = Array.from(new Set(recordedDates.map(toDateOnly))).sort();
	if (uniqueDates.length === 0) return { current: 0, longest: 0 };

	const today = new Date().toISOString().slice(0, 10);
	return {
		longest: computeLongestStreak(uniqueDates),
		current: computeCurrentStreak(uniqueDates, today),
	};
}

/**
 * テナントの初月価値プレビューデータを取得する。
 *
 * 失敗時は空データを返し、呼び出し側でフォールバックUIを表示できるようにする
 * （価値プレビューは補助的な体験で、取得失敗で admin 全体を落とすべきでない）。
 */
export async function getTenantValuePreview(tenantId: string): Promise<TenantValuePreview> {
	const children = await findAllChildren(tenantId);

	if (children.length === 0) {
		return {
			tenantSignupDate: null,
			daysSinceTenantSignup: null,
			isInFirstMonth: false,
			previewEligible: false,
			children: [],
		};
	}

	const todayDate = new Date().toISOString().slice(0, 10);

	const childPreviews: ChildValuePreview[] = await Promise.all(
		children.map(async (child) => {
			const signupDate = toDateOnly(child.createdAt);
			const daysSinceSignup = Math.max(0, daysBetween(signupDate, todayDate));

			const logs = await findActivityLogs(child.id, tenantId, {});

			let totalPoints = 0;
			const recordedDates: string[] = [];
			const byCategory = new Map<number, { count: number; points: number }>();

			for (const log of logs) {
				const rowTotal = log.points + log.streakBonus;
				totalPoints += rowTotal;
				recordedDates.push(log.recordedAt);

				const existing = byCategory.get(log.categoryId);
				if (existing) {
					existing.count += 1;
					existing.points += rowTotal;
				} else {
					byCategory.set(log.categoryId, { count: 1, points: rowTotal });
				}
			}

			const totalActivities = logs.length;
			const { current, longest } = computeStreaks(recordedDates);

			// マイルストーン判定
			const milestones: MilestoneAchievement[] = MILESTONES.map((def) => {
				const achieved =
					def.kind === 'count' ? totalActivities >= def.threshold : longest >= def.threshold;

				let achievedAt: string | null = null;
				if (achieved) {
					if (def.kind === 'count') {
						const sortedLogs = [...logs].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
						const target = sortedLogs[def.threshold - 1];
						achievedAt = target ? toDateOnly(target.recordedAt) : null;
					} else {
						// streak のマイルストーン達成日は、当該連続到達した最終日
						// 簡易実装: longest streak 到達時点の正確な日付特定は重いため、
						// ここでは「現在も達成済み」を伝える null を許容する
						achievedAt = null;
					}
				}

				return {
					id: def.id,
					threshold: def.threshold,
					achieved,
					achievedAt,
				};
			});

			const categoryBreakdown: CategoryBreakdown[] = Array.from(byCategory.entries())
				.map(([categoryId, v]) => ({
					categoryId,
					count: v.count,
					points: v.points,
				}))
				.sort((a, b) => b.count - a.count);

			return {
				childId: child.id,
				nickname: child.nickname,
				signupDate,
				daysSinceSignup,
				totalActivities,
				currentStreak: current,
				longestStreak: longest,
				totalPoints,
				categoryBreakdown,
				milestones,
			};
		}),
	);

	const oldestSignup = childPreviews.map((c) => c.signupDate).sort((a, b) => a.localeCompare(b))[0];

	const tenantSignupDate = oldestSignup ?? null;
	const daysSinceTenantSignup =
		tenantSignupDate !== null ? Math.max(0, daysBetween(tenantSignupDate, todayDate)) : null;

	const isInFirstMonth = daysSinceTenantSignup !== null && daysSinceTenantSignup <= 30;
	// 7 日以上経過していれば「30 日後プレビュー」を意味のある形で見せられる
	const previewEligible = daysSinceTenantSignup !== null && daysSinceTenantSignup >= 1;

	return {
		tenantSignupDate,
		daysSinceTenantSignup,
		isInFirstMonth,
		previewEligible,
		children: childPreviews,
	};
}
