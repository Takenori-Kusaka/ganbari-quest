import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/services/daily-mission-service.ts
// デイリーミッション — 毎日3つのミッションを自動生成し、達成でボーナス付与

import { addDaysJST, prevDateJST, todayDateJST } from '$lib/domain/date-utils';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import {
	countTodayActiveRecords,
	insertPointLedger,
	sumPointLedgerByTypeAndDescriptionPrefix,
} from '$lib/server/db/activity-repo';
import {
	findAllMissionStatuses,
	findAllRecordedActivityIds,
	findChildForMission,
	findMissionByActivity,
	findPreviousDayMissionIds,
	findRecentActivityIds,
	findTodayMissions,
	findVisibleActivities,
	insertDailyMission,
	markMissionCompleted,
	markMissionUncompleted,
} from '$lib/server/db/daily-mission-repo';

const MISSION_COUNT = 3;

/** ボーナステーブル (達成数 → 当日のあるべき累計ボーナス) */
const MISSION_BONUS: Record<number, number> = {
	2: 5,
	3: 20,
};

/** point_ledger.type。付与も巻き戻しも同 type・同 `[date]` prefix で計上する (#4686)。 */
export const MISSION_LEDGER_TYPE = 'daily_mission';

/** 当日ミッションボーナス ledger の description prefix (JST 日付、付与 / 巻き戻し共通)。 */
function missionLedgerPrefix(date: string): string {
	return `[${date}]`;
}

/**
 * #4686: 当日のミッションボーナスを「あるべき額 (達成数に応じた MISSION_BONUS) − 当日付与済み合計」の
 * 差分で台帳に揃える。記録で達成数が増えれば正の差分、とりけしで達成数が減れば負の差分を
 * **同じ type / 同じ prefix** で計上する (付与した経路と同じ経路で取り消す)。
 * @returns 今回計上した差分 (0 = 変化なし)
 */
async function reconcileMissionBonus(
	childId: ChildId,
	date: string,
	completedCount: number,
	tenantId: string,
): Promise<number> {
	const desired = MISSION_BONUS[completedCount] ?? 0;
	const granted = await sumPointLedgerByTypeAndDescriptionPrefix(
		childId,
		MISSION_LEDGER_TYPE,
		missionLedgerPrefix(date),
		tenantId,
	);
	const delta = desired - granted;
	if (delta === 0) return 0;
	await insertPointLedger(
		{
			childId,
			amount: delta,
			type: MISSION_LEDGER_TYPE,
			description:
				delta > 0
					? `${missionLedgerPrefix(date)} ミッションボーナス (${completedCount}/${MISSION_COUNT}) +${delta}`
					: `${missionLedgerPrefix(date)} ミッションボーナスとりけし (${completedCount}/${MISSION_COUNT}) ${delta}`,
		},
		tenantId,
	);
	return delta;
}

export interface DailyMission {
	id: string;
	activityId: ActivityId;
	activityName: string;
	activityIcon: string;
	categoryId: CategoryId;
	completed: boolean;
}

export interface DailyMissionStatus {
	missions: DailyMission[];
	completedCount: number;
	allComplete: boolean;
	bonusAwarded: number;
}

/**
 * 今日のミッションを取得（未生成なら自動生成）
 */
export async function getTodayMissions(
	childId: ChildId,
	tenantId: string,
): Promise<DailyMissionStatus> {
	const today = todayDateJST();

	// 既存のミッションを確認
	let missions = await findTodayMissions(childId, today, tenantId);

	// なければ生成
	if (missions.length === 0) {
		await generateMissions(childId, today, tenantId);
		missions = await findTodayMissions(childId, today, tenantId);
	}

	const completedCount = missions.filter((m) => m.completed === 1).length;

	// 当日付与済みボーナス合計 (#4686: 付与 / 巻き戻しの正負込み)
	const bonusAwarded = await sumPointLedgerByTypeAndDescriptionPrefix(
		childId,
		MISSION_LEDGER_TYPE,
		missionLedgerPrefix(today),
		tenantId,
	);

	return {
		missions: missions.map((m) => ({
			id: m.id,
			activityId: m.activityId,
			activityName: m.activityName,
			activityIcon: m.activityIcon,
			categoryId: m.categoryId,
			completed: m.completed === 1,
		})),
		completedCount,
		allComplete: completedCount >= MISSION_COUNT,
		bonusAwarded,
	};
}

/**
 * 活動記録時にミッション達成を判定し、ボーナスを付与
 */
export async function checkMissionCompletion(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<{ missionCompleted: boolean; allComplete: boolean; bonusAwarded: number }> {
	const today = todayDateJST();

	// このactivityIdがミッションに含まれるか
	const mission = await findMissionByActivity(childId, today, activityId, tenantId);

	if (!mission || mission.completed === 1) {
		return { missionCompleted: false, allComplete: false, bonusAwarded: 0 };
	}

	// ミッション達成 (#2845 B1: (childId, date, activityId) composite key で tenant + child 束縛)
	await markMissionCompleted(childId, today, activityId, tenantId);

	// 全ミッションの達成状況を確認
	const allMissions = await findAllMissionStatuses(childId, today, tenantId);

	const completedCount = allMissions.filter((m) => m.completed === 1).length;
	const allComplete = completedCount >= MISSION_COUNT;

	// ボーナス計算（差分付与、#4686: 巻き戻しと同じ reconcile 経路）
	const bonusAwarded = await reconcileMissionBonus(childId, today, completedCount, tenantId);

	return { missionCompleted: true, allComplete, bonusAwarded };
}

/**
 * #4686: 活動とりけし時のミッション巻き戻し。
 * 当該 activity の当日 active log が 0 件になった場合のみ達成を外し (dailyLimit>1 で 1 件だけ
 * 取り消した場合は達成のまま)、ボーナスを達成数に応じた額へ reconcile する (負の差分を計上)。
 * @returns revertedMission: 達成を外したか / bonusDelta: 台帳に計上した差分 (負 or 0)
 */
export async function revertMissionCompletion(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<{ revertedMission: boolean; bonusDelta: number }> {
	const today = todayDateJST();
	const mission = await findMissionByActivity(childId, today, activityId, tenantId);
	if (!mission || mission.completed !== 1) {
		return { revertedMission: false, bonusDelta: 0 };
	}
	const remaining = await countTodayActiveRecords(childId, activityId, today, tenantId);
	if (remaining > 0) {
		return { revertedMission: false, bonusDelta: 0 };
	}
	await markMissionUncompleted(childId, today, activityId, tenantId);

	const allMissions = await findAllMissionStatuses(childId, today, tenantId);
	const completedCount = allMissions.filter((m) => m.completed === 1).length;
	const bonusDelta = await reconcileMissionBonus(childId, today, completedCount, tenantId);
	return { revertedMission: true, bonusDelta };
}

/**
 * ミッション生成（利用履歴ベースのアルゴリズム）
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function generateMissions(childId: ChildId, date: string, tenantId: string): Promise<void> {
	const child = await findChildForMission(childId, tenantId);
	if (!child) return;

	// #2565: getTodayMissions の check-then-generate は TOCTOU を持つため、同一 child home
	// への並行リクエストが両方ここに到達すると二重生成し mission が 3 件を超えて並ぶ
	// (重複 activity の UNIQUE violation 自体は insertDailyMission の onConflictDoNothing で
	// 回避されるが、ランダム選択で別 activity を選ぶと件数オーバーが残る)。generate 直前に
	// 既存 mission を再確認し、既に生成済みなら何もしない (二重生成ガード)。
	const existing = await findTodayMissions(childId, date, tenantId);
	if (existing.length > 0) return;

	// 対象児の表示可能な活動を取得
	// #2362 PR-3 Phase 7b-2c: ChildActivity (per-child instance) は ageMin/ageMax を持たない。
	// findVisibleActivities は全 child の活動を返すため、childId で filter する。
	// 旧 Activity master 系 (demo/dynamodb 未移行) は childId フィールド無しのため、
	// 後方互換 fallback として undefined 時は全件通す (Phase 7b-2d で全 repo を per-child 化予定)。
	const allVisibleActivities = await findVisibleActivities(tenantId);
	const allActivities = allVisibleActivities.filter((a) => {
		const aChildId = (a as { childId?: ChildId }).childId;
		return aChildId === undefined || aChildId === childId;
	});

	if (allActivities.length === 0) return;

	// 前日のミッションを取得（同じ組み合わせを避ける）
	const yesterday = getPreviousDate(date);
	const prevIds = new Set(await findPreviousDayMissionIds(childId, yesterday, tenantId));

	// 利用履歴を取得
	const sevenDaysAgo = getNDaysAgo(date, 7);
	const recentActivityIds = new Set(await findRecentActivityIds(childId, sevenDaysAgo, tenantId));
	const allRecordedIds = new Set(await findAllRecordedActivityIds(childId, tenantId));

	// 3つのプール分類
	const recentPool = allActivities.filter((a) => recentActivityIds.has(a.id) && !prevIds.has(a.id));
	const challengePool = allActivities.filter(
		(a) => allRecordedIds.has(a.id) && !recentActivityIds.has(a.id) && !prevIds.has(a.id),
	);
	const explorerPool = allActivities.filter((a) => !allRecordedIds.has(a.id) && !prevIds.has(a.id));

	const selected: ActivityId[] = [];

	// 1. 確実枠: 直近7日で記録した活動から
	if (recentPool.length > 0) {
		const pick = pickRandom(recentPool);
		if (pick) selected.push(pick.id);
	}

	// 2. チャレンジ枠: 過去に記録したが最近やっていない活動から
	if (challengePool.length > 0 && selected.length < MISSION_COUNT) {
		const remaining = challengePool.filter((a) => !selected.includes(a.id));
		const pick = pickRandom(remaining);
		if (pick) selected.push(pick.id);
	}

	// 3. 探検枠: 未経験の活動からランダム
	if (explorerPool.length > 0 && selected.length < MISSION_COUNT) {
		const remaining = explorerPool.filter((a) => !selected.includes(a.id));
		const pick = pickRandom(remaining);
		if (pick) selected.push(pick.id);
	}

	// フォールバック: 3つに満たない場合、カテゴリ分散でランダム補充
	if (selected.length < MISSION_COUNT) {
		const byCategory = new Map<CategoryId, typeof allActivities>();
		for (const a of allActivities) {
			if (selected.includes(a.id)) continue;
			const list = byCategory.get(a.categoryId) ?? [];
			list.push(a);
			byCategory.set(a.categoryId, list);
		}

		// 未選出のカテゴリを優先（カテゴリ分散を保証）
		const selectedCategoryIds = new Set(
			selected
				.map((id) => allActivities.find((a) => a.id === id)?.categoryId)
				.filter((v): v is CategoryId => v != null),
		);
		const allCategoryIds = CATEGORY_DEFS.map((c) => c.id);
		const unselectedCategories = shuffle(
			allCategoryIds.filter((cid) => byCategory.has(cid) && !selectedCategoryIds.has(cid)),
		);
		const alreadySelectedCategories = shuffle(
			allCategoryIds.filter((cid) => byCategory.has(cid) && selectedCategoryIds.has(cid)),
		);
		const remainingCategories = [...unselectedCategories, ...alreadySelectedCategories];

		for (const catId of remainingCategories) {
			if (selected.length >= MISSION_COUNT) break;
			const catActivities = byCategory.get(catId) ?? [];
			const pool = catActivities.filter((a) => !selected.includes(a.id));
			const pick = pickRandom(pool);
			if (pick) selected.push(pick.id);
		}
	}

	// さらに不足する場合、全活動からランダム補充
	if (selected.length < MISSION_COUNT) {
		const remaining = allActivities.filter((a) => !selected.includes(a.id));
		const shuffled = shuffle(remaining);
		for (const a of shuffled) {
			if (selected.length >= MISSION_COUNT) break;
			selected.push(a.id);
		}
	}

	// DB に挿入
	for (const activityId of selected) {
		await insertDailyMission(childId, date, activityId, tenantId);
	}
}

function pickRandom<T>(arr: T[]): T | undefined {
	if (arr.length === 0) return undefined;
	return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a;
}

// 旧実装は「ローカル深夜パース → ローカル setDate → UTC 文字列化」の混在で、
// TZ=Asia/Tokyo では 1 日ではなく 2 日戻っていた (#4127 残存 3)。JST SSOT に委譲する。
function getPreviousDate(dateStr: string): string {
	return prevDateJST(dateStr);
}

function getNDaysAgo(dateStr: string, n: number): string {
	return addDaysJST(dateStr, -n);
}
