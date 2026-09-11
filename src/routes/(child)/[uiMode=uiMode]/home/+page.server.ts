import { fail } from '@sveltejs/kit';
import { todayDateJST } from '$lib/domain/date-utils';
import { formIdString } from '$lib/domain/form-value';
import { asActivityId, asCategoryId, asChildId, type CategoryId } from '$lib/domain/ids';
import { getChildActionErrorLabels } from '$lib/domain/labels';
import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireValidChildCookieFormat } from '$lib/server/auth/child-cookie-guard';
import { isValidUuidFormField } from '$lib/server/auth/child-form-field-guard';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	hasAnyActivityRecords,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import {
	ActivityPinError,
	MAX_PINS_PER_CATEGORY,
	sortActivitiesWithPreferences,
	toggleActivityPin,
} from '$lib/server/services/activity-pin-service';
import {
	getChildActivities,
	tryGrantMustCompletionBonus,
} from '$lib/server/services/activity-service';
import {
	claimBirthdayBonus,
	getBirthdayBonusStatus,
} from '$lib/server/services/birthday-bonus-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
// #2295 (EPIC #2294 ①): season-event-service / seasonal-content-service 撤去済 (2026-05-19)
// #2458-B: sibling-challenge-service (legacy family-wide) → child-challenge-service (per-child instance) 移行
import type { ChallengeClaimErrorCode } from '$lib/server/services/child-challenge-service';
import {
	claimChildChallengeReward,
	getActiveChildChallengesWithSiblings,
	getOrCreateWeeklyChildChallenge,
	markChallengeCelebrationShown,
	resolveCelebrationChallenge,
	resolveChallengeDisplayTitle,
} from '$lib/server/services/child-challenge-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import {
	clearHabitCertificateNotice,
	getHabitCertificateNotice,
} from '$lib/server/services/habit-certificate-notice-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownMessage } from '$lib/server/services/message-service';
import { selectRecommendations } from '$lib/server/services/recommendation-service';
import { getWeeklyRanking, isRankingEnabled } from '$lib/server/services/sibling-ranking-service';
import type { SpecialRewardResult } from '$lib/server/services/special-reward-service';
import {
	autoRedeemPreviousWeek,
	getStampCardStatus,
	redeemStampCard,
	stampToday,
} from '$lib/server/services/stamp-card-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import {
	clearUiModeChangeNotice,
	getUiModeChangeNotice,
} from '$lib/server/services/ui-mode-change-notice-service';
import type { Actions, PageServerLoad } from './$types';

/**
 * #4020: この route の「今日」は `date-utils.ts` の SSOT (`todayDateJST`) を直接呼ぶ。
 *
 * 旧実装は `todayDate()` というファイル内ローカル関数を持ち、中身は `new Date()` の
 * ローカル日付要素だった。本番 Lambda は TZ 未設定 (= UTC) のため **JST 00:00〜09:00 の
 * 9 時間**は前日を「今日」と見なし、活動記録の**書き込み側** (`activity-record-preparation.ts`
 * の JST 固定) と食い違って「記録したのに今日のおやくそくが埋まらない」が起きていた。
 *
 * **`todayDate` という名前をこのファイルに残さない。** `validation/activity.ts:314` に
 * `export { todayDateJST as todayDate }` という**同名の JST 別名**が存在するため、
 * ローカル関数が同名で居ると呼び出し側の見た目が JST 版と完全に一致し、grep でも
 * 目視でも区別できない。この「名前による隠蔽」が #4020 が 5 か月間検出されなかった
 * 直接の機構であり (Issue 5 Whys の 4)、wrapper として名前だけ残すと機構は残る。
 *
 * `(child)` 配下の他 route (checklist / status / history) は既に JST 経由。
 */
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
			celebrationChallenge: null,
			challengeTargets: [],
			siblingRanking: null,
			mustStatus: null,
			uiModeChangeNotice: null,
			habitCertificateNotice: null,
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
			celebrationChallenge: null,
			challengeTargets: [],
			siblingRanking: null,
			familyStreak: null,
			mustStatus: null,
			// #4313: 年齢は減らないため「切替後が baby」の notice は発生しない。
			// 3 歳の baby → preschool は切替後が preschool なので本分岐に入らない。
			uiModeChangeNotice: null,
			habitCertificateNotice: null,
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
		rawActiveChallenges,
		familyStreakData,
		uiModeChangeNotice,
		habitCertificateNotice,
	] = await Promise.all([
		// #2471: per-child API に絞り込み (旧 getActivities(tenantId) は tenant 全 child を
		// aggregate して同名 activity が child 数分重複 render される bug の根本原因)
		getChildActivities(child.id, tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		// #4172: 陳列は通貨を発行しなくなったため、overlay の `+N ポイント！` は嘘になる。
		// AC11' 決裁「親のみ。子への演出は出さない」に従い、子側の演出は出さない。
		// 経路 (getUnshownReward / markRewardShown) と受け手側 (latestReward を読む overlay /
		// handleRewardClose) は残す — 演出を再開する判断が出たら、この 1 行を
		// `getUnshownReward(child.id, tenantId)` に戻すだけで済む。
		// 型は戻したときと同じ (SpecialRewardResult | null) に保つ。null 固定にすると受け手側が
		// `never` に狭まり、再開時に型エラーとして掘り起こす羽目になる。
		Promise.resolve<SpecialRewardResult | null>(null),
		getUnshownMessage(child.id, tenantId),
		getChecklistsForChild(child.id, todayDateJST(), tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
		hasAnyActivityRecords(child.id, tenantId),
		getBirthdayBonusStatus(child.id, tenantId),
		getActiveChildChallengesWithSiblings(child.id, tenantId),
		getFamilyStreak(tenantId),
		// #4313: 誕生日で年齢帯 UI が切り替わったことの未読告知 (settings KV)
		getUiModeChangeNotice(child.id, tenantId),
		// #4261 ③: Push を許可していない家庭では、子は残高が増えた理由を知る手段が無い。
		// 既存の Promise.all に相乗りさせる (往復を増やさない)。
		getHabitCertificateNotice(child.id, tenantId),
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
	const recommendations = selectRecommendations(rawActivities, todayDateJST());
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
			todayDateJST(),
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
	// #4690 (QM #4809): claim card / SiblingCelebration / 対象バッジに出る title は保存値 (漢字固定)
	// ではなく targetConfig の構造値から年齢帯の文体で解決し直す。
	const activeChallenges = rawActiveChallenges.map((c) => ({
		...c,
		title: resolveChallengeDisplayTitle(c, parentData.uiMode),
	}));
	const challengeTargets = activeChallenges
		.map((c) => {
			let categoryId: CategoryId | null = null;
			try {
				// #3575: 旧行の targetConfig は numeric categoryId を含むため境界で as* 変換する
				const cfg = JSON.parse(c.targetConfig) as { categoryId?: string | number };
				categoryId =
					typeof cfg.categoryId === 'number' || typeof cfg.categoryId === 'string'
						? asCategoryId(cfg.categoryId)
						: null;
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
		// #4410: 祝福ダイアログを出すべき instance は **load 側で** `celebrationShownAt IS NULL`
		// を含めて解決する (getUnshownMessage と同型)。client の $state を
		// 表示可否の唯一の根拠にしないことで、ページ遷移・リロード・invalidateAll のたびに
		// 再表示される問題 (ADR-0012 違反) を構造的に断つ。
		celebrationChallenge: resolveCelebrationChallenge(activeChallenges, child.id),
		challengeTargets,
		siblingRanking,
		familyStreak: familyStreakData
			? {
					...familyStreakData,
					nextMilestone: getNextMilestone(familyStreakData.currentStreak),
				}
			: null,
		mustStatus,
		uiModeChangeNotice,
		habitCertificateNotice,
	};
};

/**
 * #4716 (QM): 失敗文言を年齢モードで出し分ける (docs/DESIGN.md §8)。
 * 本 route は `[uiMode=uiMode]` 配下なので URL パラメータがそのまま年齢帯になる。
 */
function childErrors(params?: { uiMode?: string }) {
	// 本関数は **失敗経路でしか呼ばれない**。ここで throw すると 400 が 500 に化けて
	// 「入力を直せば済む」拒否が障害に見えるため、uiMode を取れないときは既定 (ひらがな) に落とす。
	return getChildActionErrorLabels(params?.uiMode);
}

export const actions: Actions = {
	record: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.record'));
		const activityId = asActivityId(formIdString(formData.get('activityId')));

		if (!childId || !activityId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		// #3799: form-field 由来 activityId が dsql の uuid 列 (child_activities.activity_id) へ
		// 直達し 22P02 → 500 になる CWE-20 を trust 境界で断つ (自己誘発改竄なので 400 正規化)。
		if (!isValidUuidFormField(activityId, 'route.home.record.activityId')) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		const result = await recordActivity(childId, activityId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_RECORDED') {
				return fail(409, { error: childErrors(params).alreadyRecordedToday });
			}
			if (result.error === 'DAILY_LIMIT_REACHED') {
				return fail(409, { error: childErrors(params).dailyLimitReached });
			}
			return fail(404, { error: childErrors(params).notFound });
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

	cancelRecord: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.cancelRecord'));
		const logId = formIdString(formData.get('logId'));

		if (!childId || !logId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		// #3799: form-field 由来 logId が dsql の uuid 列 (activity_logs.log_id) へ直達し
		// 22P02 → 500 になる CWE-20 を trust 境界で断つ。
		if (!isValidUuidFormField(logId, 'route.home.cancelRecord.logId')) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		// 表示中の子供の記録に限る。logId だけで消せると、cookie を差し替えるだけで
		// 兄弟の記録をとりけせてしまう (id-only mutation 禁止、#2845 と同じ扱い)。
		const result = await cancelActivityLog(logId, tenantId, childId);
		if ('error' in result) {
			if (result.error === 'CANCEL_EXPIRED') {
				return fail(410, { error: childErrors(params).cancelWindowPassed });
			}
			return fail(404, { error: childErrors(params).notFound });
		}

		return { success: true, cancelled: true, refundedPoints: result.refundedPoints };
	},

	claimBonus: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.claimBonus'));
		if (!childId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		const result = await claimLoginBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED') {
				return fail(409, { error: childErrors(params).bonusAlreadyClaimed });
			}
			return fail(404, { error: childErrors(params).notFound });
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
	loginStamp: async ({ cookies, locals, params }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化
		// (stampToday → getOrCreateCurrentCard → findCardByChildAndWeek へ生 id が直達し 22P02 → 500 に
		// なる CWE-20 を trust 境界で断つ)。非 dsql (demo/anonymous 等) では空文字を返し下記 no-op 契約を保持。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.loginStamp'));
		// Issue #2097 B-14a: anonymous / demo flow without selectedChildId cookie is expected.
		// Previously returned fail(400) which triggered client retry storm (17-52 retries observed).
		// Return a successful no-op shape so client skips stampPress transition without retrying.
		if (!childId) {
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
			return fail(409, { error: childErrors(params).stampAlreadyToday });
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

		// #4687 ②: 押印できない日 (週 5 枠が埋まった CARD_FULL / 今日は押印済 ALREADY_STAMPED) は
		// stamp=null になる。旧実装はそのまま返していたため演出が「今週 0回目！ / +0pt /
		// あと5回でコンプリート！」と空カードになり、ヘッダー (5/5) と画面内で矛盾していた。
		// 今のカードを読み直して渡し、埋まっていれば演出側で「コンプリート」を出す。
		const currentCard = stamp ? null : await getStampCardStatus(childId, tenantId);
		const cardData = stamp?.cardData ?? currentCard;
		const cardFull = !stamp && !!currentCard && currentCard.filledSlots >= currentCard.totalSlots;

		return {
			success: true,
			loginStamp: true,
			stampRarity: stamp?.stamp.rarity ?? 'N',
			stampName: stamp?.stamp.name ?? '',
			omikujiRank: stamp?.stamp.omikujiRank ?? null,
			instantPoints: stamp?.instantPoints ?? 0,
			consecutiveLoginDays: bonus?.consecutiveLoginDays ?? 0,
			multiplier: bonus?.multiplier ?? 1,
			cardData,
			// #4687 ②③: 台帳に載る付与を演出に全部出す (表示額 = stamp_instant + login_bonus の増分)。
			// おみくじの結果 (吉 / 大吉 …) も返し、子供が「何を引いたか」を画面で見られるようにする。
			cardFull,
			loginBonusPoints: bonus?.totalPoints ?? 0,
			loginBonusRank: bonus?.rank ?? null,
			weeklyRedeem,
		};
	},

	togglePin: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.togglePin'));
		const activityId = asActivityId(formIdString(formData.get('activityId')));
		const pinned = formData.get('pinned') === 'true';

		if (!childId || !activityId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		// #3799: form-field 由来 activityId が dsql の uuid 列 (child_activities.activity_id /
		// child_activity_preferences.activity_id) へ直達し 22P02 になる CWE-20 を trust 境界で断つ。
		if (!isValidUuidFormField(activityId, 'route.home.togglePin.activityId')) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		try {
			const result = await toggleActivityPin(childId, activityId, pinned, tenantId);
			return { success: true, isPinned: result.isPinned };
		} catch (err) {
			// #4716 item 15 / ADR-0062: 旧実装は err.message をそのまま返し、想定外の
			// 例外の内部文言と漢字のサービス層文言を子供画面に出していた。
			if (err instanceof ActivityPinError) {
				return fail(400, {
					error:
						err.code === 'PIN_LIMIT_EXCEEDED'
							? childErrors(params).pinLimitExceeded(MAX_PINS_PER_CATEGORY)
							: childErrors(params).pinActivityNotFound,
				});
			}
			logger.error('[child-home] togglePin failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			return fail(400, { error: childErrors(params).unexpected });
		}
	},

	stampCard: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化
		// (stampToday → getOrCreateCurrentCard → findCardByChildAndWeek へ生 id が直達し 22P02 → 500 に
		// なる CWE-20 を trust 境界で断つ)。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.stampCard'));
		if (!childId) return fail(400, { error: childErrors(params).invalidInput });

		const result = await stampToday(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_STAMPED')
				return fail(409, { error: childErrors(params).stampAlreadyPressed });
			if (result.error === 'CARD_FULL') return fail(409, { error: childErrors(params).cardFull });
			if (result.error === 'NO_STAMPS_AVAILABLE') {
				logger.error('[stampCard] NO_STAMPS_AVAILABLE — onboarding seed missing', {
					context: { childId, tenantId },
				});
				return fail(503, { error: childErrors(params).stampUnavailable });
			}
			return fail(400, { error: childErrors(params).stampFailed });
		}

		return {
			success: true,
			stampName: result.stamp.name,
			stampRarity: result.stamp.rarity,
			omikujiRank: result.stamp.omikujiRank ?? null,
		};
	},

	redeemStampCard: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.redeemStampCard'));
		if (!childId) return fail(400, { error: childErrors(params).invalidInput });

		const result = await redeemStampCard(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_REDEEMED')
				return fail(409, { error: childErrors(params).alreadyRedeemed });
			if (result.error === 'EMPTY_CARD') return fail(400, { error: childErrors(params).emptyCard });
			return fail(400, { error: childErrors(params).redeemFailed });
		}

		return {
			success: true,
			totalPoints: result.points,
			stampPoints: result.stampPoints,
			completeBonus: result.completeBonus,
		};
	},

	claimBirthday: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(requireValidChildCookieFormat(cookies, 'route.home.claimBirthday'));
		if (!childId) return fail(400, { error: childErrors(params).invalidInput });

		const result = await claimBirthdayBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED')
				return fail(409, { error: childErrors(params).bonusAlreadyReceived });
			if (result.error === 'NOT_ELIGIBLE')
				return fail(400, { error: childErrors(params).noBirthdayBonus });
			return fail(400, { error: childErrors(params).bonusClaimFailed });
		}

		return {
			success: true,
			birthdayClaimed: true,
			newAge: result.newAge,
			totalPoints: result.totalPoints,
			multiplier: result.multiplier,
		};
	},

	/**
	 * #4313: 年齢帯 UI 切替の告知を既読にする。
	 * ダイアログを閉じた時点で 1 回だけ呼ばれ、以後どの日に再ログインしても再表示されない。
	 */
	dismissUiModeChangeNotice: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = asChildId(
			requireValidChildCookieFormat(cookies, 'route.home.dismissUiModeChangeNotice'),
		);
		if (!childId) return fail(400, { error: childErrors(params).invalidInput });

		await clearUiModeChangeNotice(childId, tenantId);
		return { success: true, uiModeChangeNoticeDismissed: true };
	},

	// #2295 (EPIC #2294 ①): claimEventReward action 削除済 (2026-05-19)

	claimChallengeReward: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(
			requireValidChildCookieFormat(cookies, 'route.home.claimChallengeReward'),
		);
		const challengeId = formIdString(formData.get('challengeId'));

		if (!childId || !challengeId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		// #3799: form-field 由来 challengeId が dsql の uuid 列 (child_challenges.challenge_id) へ
		// 直達し 22P02 になる CWE-20 を trust 境界で断つ。下の try/catch は 22P02 を握り潰し
		// 生 err.message を fail(400) に載せる (ADR-0062 内部例外 leak) ため、事前 guard で防ぐ。
		if (!isValidUuidFormField(challengeId, 'route.home.claimChallengeReward.challengeId')) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		try {
			// #2458-B: per-child instance ごとに claim (旧 sibling-challenge service の family scope claim から flip)
			const result = await claimChildChallengeReward(challengeId, childId, tenantId);
			if ('error' in result) {
				// #4716 (QM #4802): service の文言 (保護者向けの漢字 + 「お子さま」) を 4 歳に素通ししない。
				// code から年齢帯の文言に解決する
				return fail(400, { error: challengeClaimErrorLabel(childErrors(params), result.code) });
			}
			return {
				success: true,
				challengeRewardClaimed: true,
				rewardPoints: result.points,
				rewardMessage: result.message ?? '',
			};
		} catch (err) {
			// #4716 item 15 / ADR-0062: 生の例外 message を顧客に見せない (内部情報 leak)。
			logger.error('[child-home] claimChallengeReward failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			return fail(400, { error: childErrors(params).unexpected });
		}
	},

	/**
	 * #4410: 達成祝福 (SiblingCelebration) を「見せた」ことを記録する。
	 *
	 * `markCheersShown` と同型 (form action + use:enhance)。旧実装は「閉じる」が client の
	 * `$state` を false にするだけで、ホームに入るたび全画面モーダルが再表示されていた
	 * (ADR-0012 anti-engagement 違反 / docs/DESIGN.md §10 連続演出禁止)。
	 */
	markChallengeCelebrationShown: async ({ params, request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = asChildId(
			requireValidChildCookieFormat(cookies, 'route.home.markChallengeCelebrationShown'),
		);
		const challengeId = formIdString(formData.get('challengeId'));

		if (!childId || !challengeId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		// #3799 と同型: form-field 由来 id が dsql uuid 列へ直達して 22P02 になる CWE-20 を断つ。
		if (
			!isValidUuidFormField(challengeId, 'route.home.markChallengeCelebrationShown.challengeId')
		) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		// 他 child の instance / 存在しない id は false (IDOR 防止)。
		const marked = await markChallengeCelebrationShown(challengeId, childId, tenantId);
		if (!marked) {
			return fail(400, { error: childErrors(params).invalidInput });
		}
		return { success: true, challengeCelebrationShown: true };
	},

	/**
	 * #4261 ③: 習慣化告知を既読にする。
	 *
	 * **子に閉じる操作をさせない** (ADR-0012「記録する → 数秒で閉じる」を伸ばさない) ため、
	 * × ボタンではなく**表示できた時点**で client が自動で 1 回だけ叩く。
	 * 失敗しても画面は壊さず、次回起動でもう一度出す (安全側 = 無音より再掲)。
	 */
	ackHabitCertificateNotice: async ({ params, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childId = asChildId(
			requireValidChildCookieFormat(cookies, 'route.home.ackHabitCertificateNotice'),
		);
		if (!childId) {
			return fail(400, { error: childErrors(params).invalidInput });
		}

		await clearHabitCertificateNotice(childId, tenantId);
		return { success: true };
	},

	// #2295 (EPIC #2294 ①): claimMonthlyReward action 削除済 (2026-05-19)
};

/** claimChildChallengeReward の失敗 code → 年齢帯の子供向け文言 (網羅は Record で型強制)。 */
function challengeClaimErrorLabel(
	labels: ReturnType<typeof getChildActionErrorLabels>,
	code: ChallengeClaimErrorCode,
): string {
	const byCode: Record<ChallengeClaimErrorCode, string> = {
		NOT_FOUND: labels.challengeNotFound,
		WRONG_CHILD: labels.challengeWrongChild,
		NOT_COMPLETED: labels.challengeNotCompleted,
		ALREADY_CLAIMED: labels.challengeAlreadyClaimed,
	};
	return byCode[code];
}
