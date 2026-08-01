// src/lib/server/services/activity-record-dsql.ts
// EPIC #3424 / 実装 #3541 Phase Z (+ #3550 ①) / 設計 SSOT: dsql-data-model.md §8
//
// DATA_SOURCE=dsql の recordActivity 経路 (activity-log-service.ts から dispatch される):
//
//   1. 事前 guard + bonus 計算 = prepareActivityRecord (read-only、sqlite 経路と共有 SSOT)。
//   2. core 5 行 (activity_logs / activity_mastery / point_ledger + total_point / statuses /
//      status_history) を recordActivityCore の単一 txn で all-or-nothing 書込 (§8 最大の質的改善)。
//      冪等性の正は core の txn 内 re-read (ALREADY_RECORDED / DAILY_LIMIT_REACHED は core 判定)。
//   3. optional (combo / mission / challenge進捗 / focus / 証明書 / 通知 / special_reward /
//      activation 計測) は core commit 後の独立 best-effort (SAVEPOINT 非対応 spike#4)。
//      失敗は runOptionalWrite で隔離し、fitness#11 counter
//      (optional-write-alert: logger.error + Discord) に emit する。core は rollback しない。
//   4. RecordActivityResult は「確定値のみ描画」(§8 演出契約): core Result の確定値
//      (logId / totalPoints / masteryLevel / totalXp / statusLevel) + optional 結果から組み立て、
//      optional 失敗 field は null / [] で返す (sqlite 経路の try-catch swallow と同じ UI 契約)。
//
// fitness#7: 本 module に runInTransaction callsite は無い (txn 内 await は core / optional
// プリミティブの内部のみ)。fitness#16: DB アクセスは repo facade / dsql プリミティブ経由。

import type { ActivityId, ChildId } from '$lib/domain/ids';
import {
	CANCEL_WINDOW_MS,
	calcMasteryLevel,
	getActivityDisplayName,
	getCategoryById,
	MASTERY_MILESTONE_LEVELS,
} from '$lib/domain/validation/activity';
import { calcLevelFromXp } from '$lib/domain/validation/status';
import { getDsqlTransactionRunner } from '$lib/server/db/dsql/connection';
import { runOptionalWrite } from '$lib/server/db/dsql/optional-write-guard';
import { recordActivityCore } from '$lib/server/db/dsql/record-activity-core';
import type { RecordActivityResult, XpGainInfo } from '$lib/server/services/activity-log-service';
import {
	type PreparedActivityRecord,
	prepareActivityRecord,
} from '$lib/server/services/activity-record-preparation';
import { checkAndGrantCombo } from '$lib/server/services/combo-service';
import { checkMissionCompletion } from '$lib/server/services/daily-mission-service';
import { createOptionalWriteFailureHandler } from '$lib/server/services/optional-write-alert';
import type { LevelUpInfo } from '$lib/server/services/status-service';

/** status-service updateStatus の maxValue と同一値 (xpGain 契約、UI ゲージ上限)。 */
const STATUS_MAX_VALUE = 100000;

/**
 * DATA_SOURCE=dsql の活動記録。error 契約 (ALREADY_RECORDED / DAILY_LIMIT_REACHED /
 * NOT_FOUND) と RecordActivityResult shape は sqlite 経路と同一 (frontend 契約不変)。
 */
export async function recordActivityDsql(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<
	| RecordActivityResult
	| { error: 'ALREADY_RECORDED' }
	| { error: 'DAILY_LIMIT_REACHED' }
	| { error: 'NOT_FOUND'; target: string }
> {
	// 1. 書込前計算 (sqlite 経路と共有。cheap guard: 明白な重複はここで弾く)
	const prep = await prepareActivityRecord(childId, activityId, tenantId);
	if ('error' in prep) return prep;

	// 2. core 5 行の単一 txn (冪等性の正 = txn 内 re-read、§8)
	const now = new Date().toISOString();
	const core = await recordActivityCore(getDsqlTransactionRunner(), {
		familyId: tenantId,
		childId: String(childId),
		activityId: String(activityId),
		categoryId: String(prep.activity.categoryId),
		basePoints: prep.effectiveBasePoints,
		streakBonus: prep.streakBonus,
		masteryBonus: prep.masteryBonus,
		streakDays: prep.streakDays,
		recordedDate: prep.today,
		now,
		dailyLimit: prep.activity.dailyLimit ?? null,
		description: prep.ledgerDescription,
		changeType: 'activity_record',
		masteryLevelFor: calcMasteryLevel,
		statusLevelFor: (totalXp) => calcLevelFromXp(totalXp).level,
	});
	if (!core.ok) return { error: core.reason };

	// 3. 演出契約 (§8): levelUp / xpGain / masteryLeveledUp は core 確定値から組み立てる
	const xpAfter = core.totalXp;
	const xpBefore = xpAfter - core.totalPoints;
	const beforeLevel = calcLevelFromXp(xpBefore);
	const afterLevel = calcLevelFromXp(xpAfter);
	const catDef = getCategoryById(prep.activity.categoryId);
	const levelUp: LevelUpInfo | null =
		afterLevel.level > beforeLevel.level
			? {
					oldLevel: beforeLevel.level,
					oldTitle: beforeLevel.title,
					newLevel: afterLevel.level,
					newTitle: afterLevel.title,
					categoryId: prep.activity.categoryId,
					categoryName: catDef?.name ?? '',
					spGranted: 0,
				}
			: null;
	const xpGain: XpGainInfo = {
		categoryId: prep.activity.categoryId,
		categoryName: catDef?.name ?? '',
		xpBefore,
		xpAfter,
		maxValue: STATUS_MAX_VALUE,
		levelBefore: beforeLevel.level,
		levelAfter: afterLevel.level,
	};
	const masteryLeveledUp =
		core.masteryLevel > prep.currentMasteryLevel
			? {
					oldLevel: prep.currentMasteryLevel,
					newLevel: core.masteryLevel,
					isMilestone: MASTERY_MILESTONE_LEVELS.has(core.masteryLevel),
				}
			: null;

	// 4. optional phase (core commit 後の独立 best-effort、失敗は fitness#11 counter へ)
	const optional = await runOptionalPhase({
		childId,
		activityId,
		tenantId,
		prep,
		totalPoints: core.totalPoints,
		levelUp,
		xpGain,
	});

	return {
		id: core.logId,
		childId,
		activityId,
		activityName: getActivityDisplayName(prep.activity, prep.child.age),
		basePoints: prep.effectiveBasePoints,
		streakDays: prep.streakDays,
		streakBonus: prep.streakBonus,
		masteryBonus: prep.masteryBonus,
		masteryLevel: core.masteryLevel,
		masteryLeveledUp,
		totalPoints: core.totalPoints,
		recordedAt: now,
		cancelableUntil: new Date(Date.now() + CANCEL_WINDOW_MS).toISOString(),
		// 実績システム廃止（#322）— 常に空配列
		unlockedAchievements: [],
		comboBonus: optional.comboBonus,
		missionComplete: optional.missionComplete,
		// #2295 (EPIC #2294 ①): シーズン/カレンダーイベント撤去済 — 型整合のため空配列
		eventMissions: [],
		calendarEvents: [],
		siblingChallenges: optional.siblingChallenges,
		focusBonus: optional.focusBonus,
		levelUp,
		xpGain,
		// #1782: カスタム実績機能廃止 — 常に空配列
		customUnlocked: [],
	};
}

interface OptionalPhaseInput {
	childId: ChildId;
	activityId: ActivityId;
	tenantId: string;
	prep: PreparedActivityRecord;
	totalPoints: number;
	levelUp: LevelUpInfo | null;
	xpGain: XpGainInfo;
}

interface OptionalPhaseResult {
	comboBonus: RecordActivityResult['comboBonus'];
	missionComplete: RecordActivityResult['missionComplete'];
	siblingChallenges: RecordActivityResult['siblingChallenges'];
	focusBonus: RecordActivityResult['focusBonus'];
}

/**
 * optional 書込群を sqlite 経路と同順で実行する。各項目は runOptionalWrite で隔離され、
 * 失敗しても他項目・core 結果に波及しない (§8。欠落は fitness#11 counter に emit)。
 */
async function runOptionalPhase(input: OptionalPhaseInput): Promise<OptionalPhaseResult> {
	const { childId, activityId, tenantId, prep, totalPoints, levelUp, xpGain } = input;
	const onFailure = createOptionalWriteFailureHandler({ childId: String(childId), tenantId });
	const catDef = getCategoryById(prep.activity.categoryId);

	// コンボボーナスチェック
	const comboRaw = await runOptionalWrite(
		'combo_bonus',
		() => checkAndGrantCombo(childId, prep.today, tenantId),
		onFailure,
	);

	// デイリーミッション判定
	const missionRaw = await runOptionalWrite(
		'mission_bonus',
		() => checkMissionCompletion(childId, activityId, tenantId),
		onFailure,
	);

	// per-child チャレンジ進捗チェック (#2458-B / #3213: child_challenges 一本化)
	const siblingChallenges =
		(await runOptionalWrite(
			'challenge_progress',
			async () => {
				const { updateChildChallengeProgress } = await import(
					'$lib/server/services/child-challenge-service'
				);
				const perChildResults = await updateChildChallengeProgress(
					childId,
					activityId,
					prep.activity.categoryId,
					tenantId,
				);
				// shape adapter: per-child completed → allSiblingsComplete 互換 (sqlite 経路と同一)
				return perChildResults.map((r) => ({
					challengeId: r.challengeId,
					allSiblingsComplete: r.completed,
					challengeTitle: r.challengeTitle,
				}));
			},
			onFailure,
		)) ?? [];

	// フォーカスモードおすすめ3件達成ボーナスチェック
	const focusBonus =
		(await runOptionalWrite(
			'focus_bonus',
			async () => {
				const { checkAndGrantFocusBonus, selectRecommendations } = await import(
					'$lib/server/services/recommendation-service'
				);
				const { getChildActivities } = await import('$lib/server/services/activity-service');
				const childActs = await getChildActivities(childId, tenantId, {
					childAge: prep.child.age,
				});
				const recs = selectRecommendations(childActs, prep.today, 3);
				return checkAndGrantFocusBonus(
					childId,
					recs.map((r) => r.activityId),
					tenantId,
				);
			},
			onFailure,
		)) ?? null;

	// プッシュ通知: 達成通知・レベルアップ通知
	await runOptionalWrite(
		'achievement_notification',
		async () => {
			const { sendAchievementNotification } = await import(
				'$lib/server/services/notification-service'
			);
			await sendAchievementNotification(tenantId, {
				childName: prep.child.nickname,
				activityName: getActivityDisplayName(prep.activity, prep.child.age),
				totalPoints,
				levelUp,
				unlockedAchievements: [],
			});
		},
		onFailure,
	);

	// がんばり証明書: ストリーク・レベルアップ・カテゴリマスター自動発行
	await runOptionalWrite(
		'certificate',
		async () => {
			const {
				checkAndIssueStreakCertificates,
				checkAndIssueLevelCertificates,
				issueCategoryMasterCertificate,
			} = await import('$lib/server/services/certificate-service');
			if (prep.isFirstToday && prep.streakDays >= 7) {
				await checkAndIssueStreakCertificates(childId, prep.streakDays, tenantId);
			}
			if (levelUp) {
				await checkAndIssueLevelCertificates(childId, levelUp.newLevel, tenantId);
			}
			if (xpGain.levelAfter >= 5 && xpGain.levelBefore < 5 && catDef) {
				await issueCategoryMasterCertificate(childId, String(catDef.id), catDef.name, tenantId);
			}
		},
		onFailure,
	);

	// #4172: 固定間隔自動ごほうび (棚への自動 INSERT + 50pt 発行) は撤去。sqlite 経路 (activity-log-service)
	// と同じく optional write 1 件分が減る。達成の表現は MILESTONES 通知が担う (報酬を発行しない)。

	return {
		comboBonus:
			comboRaw && (comboRaw.totalNewBonus > 0 || comboRaw.hints.length > 0) ? comboRaw : null,
		missionComplete: missionRaw?.missionCompleted ? missionRaw : null,
		siblingChallenges,
		focusBonus,
	};
}
