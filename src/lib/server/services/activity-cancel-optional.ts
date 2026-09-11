// src/lib/server/services/activity-cancel-optional.ts
// #4686: 活動とりけし時の optional 付与 (コンボ / デイリーミッション / 週次チャレンジ進捗 /
// 今日のおやくそく全達成ボーナス / フォーカスボーナス) の**対称巻き戻し**。
//
// 記録経路 (activity-log-service.ts sqlite / activity-record-dsql.ts dsql) は core 書込の後に
// これらを optional (失敗しても core を巻き込まない) として付与する。とりけしはその逆操作を
// **付与した経路と同じ経路** (同じ service 関数 / 同じ ledger type / 同じ `[date]` prefix) で行う
// (#3787 の mastery 対称返金と同 class)。sqlite / dsql 両 cancel 経路から呼ばれる共有 SSOT。
//
// 各巻き戻しは runOptionalWrite で隔離し、失敗は optional-write-alert に emit する (記録経路と同じ
// 観測の形)。core (log-cancel / ledger 返金 / status / mastery) は既に確定済のため rollback しない。

import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import { runOptionalWrite } from '$lib/server/db/dsql/optional-write-guard';
import { revertMustCompletionBonusIfBroken } from '$lib/server/services/activity-service';
import { revertChildChallengeProgress } from '$lib/server/services/child-challenge-service';
import { reconcileComboBonus } from '$lib/server/services/combo-service';
import { revertMissionCompletion } from '$lib/server/services/daily-mission-service';
import { createOptionalWriteFailureHandler } from '$lib/server/services/optional-write-alert';

export interface CancelOptionalRevertResult {
	/** コンボ差分 (負 = 巻き戻し、0 = 変化なし) */
	comboDelta: number;
	/** ミッションボーナス差分 (負 or 0) + 達成を外したか */
	mission: { revertedMission: boolean; bonusDelta: number };
	/** 巻き戻したチャレンジ instance 数 */
	challengesReverted: number;
	/** 今日のおやくそく全達成ボーナス差分 (負 or 0) */
	mustBonusDelta: number;
	/** フォーカスボーナス差分 (負 or 0) */
	focusBonusDelta: number;
}

/**
 * 活動 log の cancel core 完了後に呼ぶ。optional 付与を記録前の状態へ戻す。
 * @param categoryId 活動の category (活動削除済で解決できない場合は null = チャレンジ巻き戻し skip)
 * @param today JST 日付 (record 時と同じ SSOT)
 */
export async function revertOptionalAwardsOnCancel(input: {
	childId: ChildId;
	activityId: ActivityId;
	categoryId: CategoryId | null;
	today: string;
	tenantId: string;
}): Promise<CancelOptionalRevertResult> {
	const { childId, activityId, categoryId, today, tenantId } = input;
	const onFailure = createOptionalWriteFailureHandler({ childId, tenantId });

	// コンボ: 当日 active log から再評価し、付与済み合計との差分を負方向に計上
	const combo = await runOptionalWrite(
		'combo_bonus_revert',
		() => reconcileComboBonus(childId, today, tenantId),
		onFailure,
	);

	// デイリーミッション: 同 activity の当日 active log が 0 件なら達成を外し、ボーナスを reconcile
	const mission = await runOptionalWrite(
		'mission_bonus_revert',
		() => revertMissionCompletion(childId, activityId, tenantId),
		onFailure,
	);

	// 週次チャレンジ進捗: 同 category の count 進捗を 1 戻す (未受取の完了は外す)
	const challenges = categoryId
		? await runOptionalWrite(
				'challenge_progress_revert',
				() => revertChildChallengeProgress(childId, categoryId, tenantId),
				onFailure,
			)
		: null;

	// 今日のおやくそく全達成ボーナス: 全達成が崩れていれば付与済み合計を負方向に計上
	const mustBonusDelta = await runOptionalWrite(
		'must_bonus_revert',
		() => revertMustCompletionBonusIfBroken(childId, today, tenantId),
		onFailure,
	);

	// フォーカスボーナス: おすすめ 3 件のどれかが未完了に戻っていれば付与済み合計を負方向に計上
	const focusBonusDelta = await runOptionalWrite(
		'focus_bonus_revert',
		async () => {
			const { revertFocusBonusIfBroken, selectRecommendations } = await import(
				'$lib/server/services/recommendation-service'
			);
			const { getChildActivities } = await import('$lib/server/services/activity-service');
			const { getChildById } = await import('$lib/server/services/child-service');
			const child = await getChildById(childId, tenantId);
			if (!child) return 0;
			const childActs = await getChildActivities(childId, tenantId, { childAge: child.age });
			const recs = selectRecommendations(childActs, today, 3);
			return revertFocusBonusIfBroken(
				childId,
				recs.map((r) => r.activityId),
				tenantId,
			);
		},
		onFailure,
	);

	return {
		comboDelta: combo?.totalNewBonus ?? 0,
		mission: mission ?? { revertedMission: false, bonusDelta: 0 },
		challengesReverted: challenges?.length ?? 0,
		mustBonusDelta: mustBonusDelta ?? 0,
		focusBonusDelta: focusBonusDelta ?? 0,
	};
}
