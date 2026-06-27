import { fail } from '@sveltejs/kit';
import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	hasAnyActivityRecords,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import {
	sortActivitiesWithPreferences,
	toggleActivityPin,
} from '$lib/server/services/activity-pin-service';
import {
	getChildActivities,
	tryGrantMustCompletionBonus,
} from '$lib/server/services/activity-service';
import { trackActivationFirstRewardSeen } from '$lib/server/services/analytics-service';
import {
	claimBirthdayBonus,
	getBirthdayBonusStatus,
} from '$lib/server/services/birthday-bonus-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
// #2295 (EPIC #2294 ①): season-event-service / seasonal-content-service 撤去済 (2026-05-19)
// #2458-B: sibling-challenge-service (legacy family-wide) → child-challenge-service (per-child instance) 移行
import {
	claimChildChallengeReward,
	getActiveChildChallengesWithSiblings,
	getOrCreateWeeklyChildChallenge,
} from '$lib/server/services/child-challenge-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownMessage } from '$lib/server/services/message-service';
import { selectRecommendations } from '$lib/server/services/recommendation-service';
import {
	getUnshownCheers,
	markCheersShown,
	sendCheer,
} from '$lib/server/services/sibling-cheer-service';
import { getWeeklyRanking, isRankingEnabled } from '$lib/server/services/sibling-ranking-service';
import {
	getSpecialRewardProgress,
	getUnshownReward,
} from '$lib/server/services/special-reward-service';
import {
	autoRedeemPreviousWeek,
	getStampCardStatus,
	redeemStampCard,
	stampToday,
} from '$lib/server/services/stamp-card-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import type { Actions, PageServerLoad } from './$types';

function todayDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const parentData = await parent();
	const { child } = parentData;
	if (!child)
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			latestMessage: null,
			hasChecklists: false,
			checklistProgress: null,
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
			gameLoopHints: null,
			focusMode: false,
			recommendedActivityIds: [],
			birthdayBonus: null,
			activeChallenges: [],
			challengeTargets: [],
			siblingRanking: null,
			unshownCheers: [],
			specialRewardProgress: null,
			mustStatus: null,
		};

	// baby モードは親向け準備ツール — ゲーミフィケーション DB 呼び出しをスキップ (#1300)
	// 「今日のおやくそく」バーも非表示 (#1757)
	if (parentData.uiMode === 'baby') {
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			latestMessage: null,
			hasChecklists: false,
			checklistProgress: null,
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
			gameLoopHints: null,
			isFirstTime: false,
			focusMode: false,
			recommendedActivityIds: [],
			birthdayBonus: null,
			activeChallenges: [],
			challengeTargets: [],
			siblingRanking: null,
			unshownCheers: [],
			familyStreak: null,
			specialRewardProgress: null,
			mustStatus: null,
		};
	}

	// #3195: アプリ週次自動生成。バナー/演出/報酬が読む前に当週 child_challenge を冪等生成する。
	await getOrCreateWeeklyChildChallenge(child.id, tenantId);

	// 独立したDB呼び出しを並列実行（LCP改善）
	// #2295 (EPIC #2294 ①): activeEvents / monthlyPremiumReward 削除済 (2026-05-19)
	const [
		rawActivities,
		todayRecorded,
		loginBonusStatus,
		latestReward,
		latestMessage,
		checklists,
		dailyMissions,
		stampCard,
		categoryXp,
		hasRecords,
		birthdayBonusStatus,
		activeChallenges,
		unshownCheers,
		familyStreakData,
		specialRewardProgress,
	] = await Promise.all([
		// #2471: per-child API に絞り込み (旧 getActivities(tenantId) は tenant 全 child を
		// aggregate して同名 activity が child 数分重複 render される bug の根本原因)
		getChildActivities(child.id, tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		getUnshownReward(child.id, tenantId),
		getUnshownMessage(child.id, tenantId),
		getChecklistsForChild(child.id, todayDate(), tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
		hasAnyActivityRecords(child.id, tenantId),
		getBirthdayBonusStatus(child.id, tenantId),
		getActiveChildChallengesWithSiblings(child.id, tenantId),
		getUnshownCheers(child.id, tenantId),
		getFamilyStreak(tenantId),
		getSpecialRewardProgress(child.id, tenantId),
	]);

	const sortedActivities = await sortActivitiesWithPreferences(rawActivities, child.id, tenantId);
	const activities = sortedActivities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
	}));
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;
	const hasChecklists = checklists.length > 0;
	const checklistProgress = hasChecklists
		? {
				checkedCount: checklists.reduce((sum, c) => sum + c.checkedCount, 0),
				totalCount: checklists.reduce((sum, c) => sum + c.totalCount, 0),
				allDone: checklists.every((c) => c.completedAll),
			}
		: null;
	// ミッション対象の活動IDセット
	const missionActivityIds = new Set(dailyMissions?.missions.map((m) => m.activityId) ?? []);

	// activitiesにisMissionフラグを付与
	const activitiesWithMission = activities.map((a) => ({
		...a,
		isMission: missionActivityIds.has(a.id),
	}));

	// メインクエストをリスト上部にソート
	activitiesWithMission.sort((a, b) => (b.isMainQuest ? 1 : 0) - (a.isMainQuest ? 1 : 0));

	// フォーカスモード: おすすめ活動の選定 (#0264)
	const recommendations = selectRecommendations(rawActivities, todayDate());
	const recommendedIds = new Set(recommendations.map((r) => r.activityId));

	const birthdayBonus =
		'error' in birthdayBonusStatus
			? null
			: birthdayBonusStatus.eligible
				? birthdayBonusStatus
				: null;

	// きょうだいランキング（#782: family プラン + 設定有効時のみ）
	// #789: planLimits は parent layout が解決済み。重複 DB アクセスを避けるため parentData を参照する。
	let siblingRanking: Awaited<ReturnType<typeof getWeeklyRanking>> | null = null;
	try {
		if (parentData.planLimits.canSiblingRanking) {
			const rankingOn = await isRankingEnabled(tenantId);
			if (rankingOn) {
				siblingRanking = await getWeeklyRanking(tenantId);
			}
		}
	} catch {
		// ランキング取得失敗はページ全体に影響させない
	}

	// #1757 (#1709-C): 「今日のおやくそく」N/M 集計 + 全達成ボーナス冪等付与
	// - total === 0 → バー非表示（mustStatus.total === 0 を UI 側で条件分岐）
	// - logged === total && total > 0 → 同日初回のみ point_ledger に bonus 加算
	// - 同日 2 回目以降の load では granted=false（演出は 1 回限り）
	// - baby は前段で早期 return しているため到達しない（バー非表示が保証される）
	let mustStatus: Awaited<ReturnType<typeof tryGrantMustCompletionBonus>> | null = null;
	try {
		mustStatus = await tryGrantMustCompletionBonus(
			child.id,
			todayDate(),
			parentData.uiMode as Parameters<typeof tryGrantMustCompletionBonus>[2],
			tenantId,
		);
	} catch (error) {
		// must 集計失敗はホーム全体を落とさない（バー非表示にフォールバック）
		logger.error('[child-home] tryGrantMustCompletionBonus failed', {
			error: String(error),
			context: { childId: child.id },
		});
		mustStatus = null;
	}

	// #3333: チャレンジ対象カテゴリをカード演出へ渡す派生。旧 ChallengeBanner 横長バナーを撤去し、
	// 対象カテゴリの CategorySection ヘッダーに静的バッジ + インライン進捗で表示する
	// (#2146/#2168 カード演出統合思想)。categoryId は targetConfig JSON 内に格納される。
	const challengeTargets = activeChallenges
		.map((c) => {
			let categoryId: number | null = null;
			try {
				const cfg = JSON.parse(c.targetConfig) as { categoryId?: number };
				categoryId = typeof cfg.categoryId === 'number' ? cfg.categoryId : null;
			} catch {
				categoryId = null;
			}
			if (categoryId === null) return null;
			return {
				categoryId,
				currentValue: c.currentValue,
				targetValue: c.targetValue,
				completed: c.completed === 1,
				title: c.title,
			};
		})
		.filter((t): t is NonNullable<typeof t> => t !== null);

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		latestMessage: latestMessage ?? null,
		hasChecklists,
		checklistProgress,
		dailyMissions,
		stampCard,
		categoryXp,
		gameLoopHints: null,
		isFirstTime: !hasRecords,
		focusMode: recommendations.length > 0,
		recommendedActivityIds: [...recommendedIds],
		birthdayBonus,
		activeChallenges,
		challengeTargets,
		siblingRanking,
		unshownCheers,
		familyStreak: familyStreakData
			? {
					...familyStreakData,
					nextMilestone: getNextMilestone(familyStreakData.currentStreak),
				}
			: null,
		specialRewardProgress,
		mustStatus,
	};
};

export const actions: Actions = {
	record: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const activityId = Number(formData.get('activityId'));

		if (Number.isNaN(childId) || Number.isNaN(activityId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await recordActivity(childId, activityId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_RECORDED') {
				return fail(409, { error: 'きょうはもうきろくしたよ！' });
			}
			if (result.error === 'DAILY_LIMIT_REACHED') {
				return fail(409, { error: 'きょうはこれいじょうきろくできないよ' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		// #831: Activation Funnel Step 4 — 報酬演出（レベルアップ時）
		// NOTE: 初回判定は集計層で dedup（Step 2/3 とは異なるアプローチ）
		if (result.levelUp) {
			trackActivationFirstRewardSeen(tenantId, 'level_up');
		}

		return {
			success: true,
			logId: result.id,
			activityName: result.activityName,
			totalPoints: result.totalPoints,
			streakDays: result.streakDays,
			streakBonus: result.streakBonus,
			cancelableUntil: result.cancelableUntil,
			comboBonus: result.comboBonus,
			missionComplete: result.missionComplete,
			focusBonus: result.focusBonus,
			levelUp: result.levelUp,
			masteryBonus: result.masteryBonus,
			masteryLevel: result.masteryLevel,
			masteryLeveledUp: result.masteryLeveledUp,
			xpGain: result.xpGain,
		};
	},

	cancelRecord: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const logId = Number(formData.get('logId'));

		if (Number.isNaN(childId) || Number.isNaN(logId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await cancelActivityLog(logId, tenantId);
		if ('error' in result) {
			if (result.error === 'CANCEL_EXPIRED') {
				return fail(410, { error: 'とりけしじかんがすぎたよ' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, cancelled: true, refundedPoints: result.refundedPoints };
	},

	claimBonus: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await claimLoginBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED') {
				return fail(409, { error: 'きょうのボーナスはもうもらったよ！' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return {
			success: true,
			bonusClaimed: true,
			rank: result.rank,
			basePoints: result.basePoints,
			multiplier: result.multiplier,
			totalPoints: result.totalPoints,
			consecutiveLoginDays: result.consecutiveLoginDays,
		};
	},

	/** Unified login stamp: records login + stamps card + auto-redeems previous week */
	loginStamp: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		// Issue #2097 B-14a: anonymous / demo flow without selectedChildId cookie is expected.
		// Previously returned fail(400) which triggered client retry storm (17-52 retries observed).
		// Return a successful no-op shape so client skips stampPress transition without retrying.
		if (Number.isNaN(childId)) {
			return { success: false, loginStamp: false, reason: 'no-child-selected' as const };
		}

		// 1. Record login (for consecutive day tracking + multiplier)
		const bonusResult = await claimLoginBonus(childId, tenantId);
		const bonus = 'error' in bonusResult ? null : bonusResult;

		// 2. Stamp the card (instant 5pt)
		// NO_STAMPS_AVAILABLE は onboarding seed 欠落の異常系 → 500 でなく成功 no-op で返し
		// 子供 home の login bonus は獲得済みのまま継続。本番 5xx を防ぐ defense in depth
		// (Issue: stamp_masters seed 不在で loginStamp 500 — fix で本ファイル経由でも復旧)
		const stampResult = await stampToday(childId, tenantId);
		const stamp = 'error' in stampResult ? null : stampResult;

		if ('error' in stampResult && stampResult.error === 'NO_STAMPS_AVAILABLE') {
			logger.error('[loginStamp] NO_STAMPS_AVAILABLE — onboarding seed missing', {
				context: { childId, tenantId },
			});
		}

		if (!bonus && !stamp) {
			return fail(409, { error: 'きょうはもうスタンプをおしたよ！' });
		}

		// 3. Auto-redeem previous week's card (if available)
		const loginMultiplier = bonus?.multiplier ?? 1;
		let weeklyRedeem: Awaited<ReturnType<typeof autoRedeemPreviousWeek>> = null;
		try {
			weeklyRedeem = await autoRedeemPreviousWeek(childId, tenantId, loginMultiplier);
		} catch (error) {
			logger.error('[stamp] autoRedeemPreviousWeek failed', {
				error: String(error),
				context: { childId, tenantId },
			});
			weeklyRedeem = null;
		}

		// #831: Activation Funnel Step 4 — 報酬演出（スタンプ押印成功時）
		// NOTE: 初回判定は集計層で dedup（Step 2/3 とは異なるアプローチ）
		if (stamp) {
			trackActivationFirstRewardSeen(tenantId, 'stamp');
		}

		return {
			success: true,
			loginStamp: true,
			stampRarity: stamp?.stamp.rarity ?? 'N',
			stampName: stamp?.stamp.name ?? '',
			omikujiRank: stamp?.stamp.omikujiRank ?? null,
			instantPoints: stamp?.instantPoints ?? 0,
			consecutiveLoginDays: bonus?.consecutiveLoginDays ?? 0,
			multiplier: bonus?.multiplier ?? 1,
			cardData: stamp?.cardData ?? null,
			weeklyRedeem,
		};
	},

	togglePin: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const activityId = Number(formData.get('activityId'));
		const pinned = formData.get('pinned') === 'true';

		if (Number.isNaN(childId) || Number.isNaN(activityId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const result = await toggleActivityPin(childId, activityId, pinned, tenantId);
			return { success: true, isPinned: result.isPinned };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ピン留めに失敗しました';
			return fail(400, { error: message });
		}
	},

	stampCard: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await stampToday(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_STAMPED') return fail(409, { error: 'きょうはもうおしたよ' });
			if (result.error === 'CARD_FULL') return fail(409, { error: 'カードがいっぱいだよ' });
			if (result.error === 'NO_STAMPS_AVAILABLE') {
				logger.error('[stampCard] NO_STAMPS_AVAILABLE — onboarding seed missing', {
					context: { childId, tenantId },
				});
				return fail(503, { error: 'いまスタンプをおせません。あとでもういちどためしてね' });
			}
			return fail(400, { error: 'スタンプをおせませんでした' });
		}

		// #831: Activation Funnel Step 4 — 報酬演出（スタンプ押印成功時）
		// NOTE: 初回判定は集計層で dedup（Step 2/3 とは異なるアプローチ）
		trackActivationFirstRewardSeen(tenantId, 'stamp');

		return {
			success: true,
			stampName: result.stamp.name,
			stampRarity: result.stamp.rarity,
			omikujiRank: result.stamp.omikujiRank ?? null,
		};
	},

	redeemStampCard: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await redeemStampCard(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_REDEEMED') return fail(409, { error: 'もうこうかんしたよ' });
			if (result.error === 'EMPTY_CARD') return fail(400, { error: 'スタンプがないよ' });
			return fail(400, { error: 'こうかんできませんでした' });
		}

		return {
			success: true,
			totalPoints: result.points,
			stampPoints: result.stampPoints,
			completeBonus: result.completeBonus,
		};
	},

	claimBirthday: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await claimBirthdayBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED') return fail(409, { error: 'もうもらったよ' });
			if (result.error === 'NOT_ELIGIBLE')
				return fail(400, { error: 'おたんじょうびボーナスはありません' });
			return fail(400, { error: 'ボーナスをもらえませんでした' });
		}

		return {
			success: true,
			birthdayClaimed: true,
			newAge: result.newAge,
			totalPoints: result.totalPoints,
			multiplier: result.multiplier,
		};
	},

	// #2295 (EPIC #2294 ①): claimEventReward action 削除済 (2026-05-19)

	claimChallengeReward: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const challengeId = Number(formData.get('challengeId'));

		if (Number.isNaN(childId) || Number.isNaN(challengeId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			// #2458-B: per-child instance ごとに claim (旧 sibling-challenge service の family scope claim から flip)
			const result = await claimChildChallengeReward(challengeId, childId, tenantId);
			if ('error' in result) {
				return fail(400, { error: result.error });
			}
			return {
				success: true,
				challengeRewardClaimed: true,
				rewardPoints: result.points,
				rewardMessage: result.message ?? '',
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ほうしゅうをうけとれませんでした';
			return fail(400, { error: message });
		}
	},

	sendCheer: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const toChildId = Number(formData.get('toChildId'));
		const stampCode = formData.get('stampCode')?.toString() ?? '';

		if (Number.isNaN(childId) || Number.isNaN(toChildId) || !stampCode) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await sendCheer(childId, toChildId, stampCode, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}

		return { success: true, cheerSent: true };
	},

	markCheersShown: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const cheerIdsStr = formData.get('cheerIds')?.toString() ?? '';
		const cheerIds = cheerIdsStr
			.split(',')
			.map(Number)
			.filter((n) => !Number.isNaN(n));

		if (cheerIds.length === 0) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		await markCheersShown(cheerIds, tenantId);
		return { success: true };
	},

	// #2295 (EPIC #2294 ①): claimMonthlyReward action 削除済 (2026-05-19)
};
