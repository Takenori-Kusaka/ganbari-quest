<script lang="ts">
// cspell:ignore dismissable
// ↑ `@zag-js/dismissable` は実在の package 名。英語としては dismissible が正しいが、
//   参照している実装の名前なので綴りは変えない (global words には足さない = file scope)。
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { type ActivityId, asChildId, type CategoryId, type ChildId } from '$lib/domain/ids';
import {
	APP_LABELS,
	CHILD_HOME_LABELS,
	FEATURES_LABELS,
	getErrorNotifyLabels,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import { getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import SiblingCelebration from '$lib/features/challenge/SiblingCelebration.svelte';
import HabitCertificateNoticeBanner from '$lib/features/child/HabitCertificateNoticeBanner.svelte';
import TutorialHintBanner from '$lib/features/child/TutorialHintBanner.svelte';
import BabyHomePage from '$lib/features/child-home/BabyHomePage.svelte';
import OverlaysSection from '$lib/features/child-home/components/OverlaysSection.svelte';
// Issue #2084 (ADR-0046 follow-up): 本番 child home の共通 UI を派生コンポーネントに集約
import ProdDashboardSections from '$lib/features/child-home/components/ProdDashboardSections.svelte';
import XpGainRow from '$lib/features/child-home/components/XpGainRow.svelte';
import { DialogFSM, type DialogType } from '$lib/features/child-home/dialog-state-machine';
import { shouldShowHabitCertificateNotice } from '$lib/features/child-home/habit-certificate-notice';
import { resolveSiblingDisplayName } from '$lib/features/child-home/sibling-display-name';
import { shouldShowUiModeChangeNotice } from '$lib/features/child-home/ui-mode-change-notice';
import { getModeVariant } from '$lib/features/child-home/variants';
import { getScreenshotMode } from '$lib/features/demo/screenshot-mode';
import {
	animateBalanceChange,
	captureFlightOrigin,
} from '$lib/features/point-flight/point-flight.svelte';
// #4448: 獲得ぶんを結果ダイアログの数字からヘッダー残高へ飛ばし、残高をカウントアップする
import type { FlightRect } from '$lib/features/point-flight/point-flight-plan';
// Issue #2084: 本番 ProductionDashboardService を Context に再注入 (todayRecorded を含む正しい snapshot)
import { setDashboardService } from '$lib/services/context';
import { createProductionDashboardService } from '$lib/services/production/DashboardService';
import AdventureStartOverlay from '$lib/ui/components/AdventureStartOverlay.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
// #2295 (EPIC #2294 ①): EventBanner / MonthlyRewardDialog 削除済 (2026-05-19)
import ParentMessageOverlay from '$lib/ui/components/ParentMessageOverlay.svelte';
import SiblingCheerOverlay from '$lib/ui/components/SiblingCheerOverlay.svelte';
import { notifyApiError, notifyNetworkError } from '$lib/ui/error-notify';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// #2097 EPIC PR-B1 hotfix (2026-05-17): LP SS 撮影時 (`?screenshot=*`) は本番 UI 内の
// auto-open dialog (SiblingCheerOverlay / MonthlyRewardDialog 等) を抑止する。
// 子供画面の demo data には常に pending cheer が 1 件含まれるため、撮影タイミングで
// dialog が画面中央に被って主要 UI が隠れる事故が発生 (PO 2026-05-17 指摘)。
const isScreenshotMode = $derived(getScreenshotMode());

// Issue #2084 (ADR-0046 follow-up): 本番側で getDashboardService().getHomeData() 経由で
// child / todayRecorded / pointSettings を参照するため、page スコープで Service を再注入する。
// (child)/+layout.svelte で配備済みの service は todayRecorded を空配列で持つため、
// home page のみが取得できる todayRecorded を含めて上書きする。
// getter 関数を渡すことで invalidateAll() / form action 完了後の data 変化に追従できる
// (Svelte 5 state_referenced_locally 警告を回避)。
setDashboardService(
	createProductionDashboardService(() => ({
		child: data.child ?? null,
		todayRecorded: data.todayRecorded ?? [],
		pointSettings: data.pointSettings,
	})),
);

const variant = $derived(getModeVariant((data.uiMode ?? 'preschool') as UiMode));
const f = $derived(variant.features);

// --- Dialog FSM: single source of truth for overlay state (#671) ---
const fsm = new DialogFSM();

/**
 * #4433: FSM の `current` を描画用に mirror した `$state`。
 *
 * `DialogFSM` は素の class instance なので Svelte 5 の `$state` proxy が掛からず、
 * `fsm.current` への代入は再描画を起こさない。従来は「他の `$state` が偶然更新される
 * ついでに `{#if fsm.current === ...}` が再評価される」ことに依存しており、
 * FSM を閉じただけのときは次の 1 枚が出なかった (#4313 は個別 flag で回避していた)。
 *
 * FSM を触ったら必ず `syncDialog()` を通し、**描画は本 `$state` だけを見る**。
 */
let currentDialog = $state<DialogType>('idle');
function syncDialog() {
	currentDialog = fsm.current;
}
/** FSM を進める操作は必ずこの 2 つを経由する (`fsm` を直接触ると描画が同期しない)。 */
function openDialog(type: DialogType, payload?: unknown) {
	fsm.transition(type, payload);
	syncDialog();
}
function closeDialog() {
	fsm.close();
	syncDialog();
}

// First record special celebration (must be before celebEffect)
let isFirstRecord = $state(false);

const celebEffect = $derived(
	isFirstRecord ? ('legend' as CelebrationType) : ('default' as CelebrationType),
);
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const displayConfig = $derived(parseDisplayConfig(data.child?.displayConfig, data.child?.age ?? 4));

// Tutorial hint banner (one-time, localStorage)
// svelte-ignore state_referenced_locally
const tutorialHintKey = `child_tutorial_hint_shown_${data.child?.id ?? 0}`;
let showTutorialHint = $state(false);
$effect(() => {
	if (typeof window !== 'undefined') {
		showTutorialHint = !localStorage.getItem(tutorialHintKey);
	}
});
function dismissTutorialHint() {
	showTutorialHint = false;
	if (typeof window !== 'undefined') localStorage.setItem(tutorialHintKey, '1');
}

// #4261 ③: 習慣化告知 — Push が届かない家庭でも残高が増えた理由を 1 回だけ伝える。
// **閉じる操作を挟まない** (ADR-0012) ため、× ではなく「表示できた」時点で既読にする。
const showHabitCertificateNotice = $derived(
	shouldShowHabitCertificateNotice({
		notice: data.habitCertificateNotice ?? null,
		birthdayPending: Boolean(data.birthdayBonus),
		isScreenshotMode,
	}),
);
let habitNoticeAcknowledged = false;
$effect(() => {
	if (!showHabitCertificateNotice || habitNoticeAcknowledged) return;
	habitNoticeAcknowledged = true;
	// `keepalive` が要る: 子供は「記録して数秒で閉じる」(ADR-0012) ため、既読化が届く前に
	// 画面遷移・タブ終了が起きる。通常の fetch はそこで中断され、**次回また同じ告知が出る**
	// (実機で観測済)。失敗しても画面は壊さない — 届かなければ次回に再掲する (無音よりまし)。
	fetch('?/ackHabitCertificateNotice', {
		method: 'POST',
		body: new FormData(),
		keepalive: true,
	}).catch(() => {});
});

// Sibling cheer overlay
let showCheerOverlay = $state(true);

// Sibling celebration (all siblings complete)
// #2458-B: per-child instance に flip。
// #4410: 表示可否の根拠は **load 側** (`resolveCelebrationChallenge`、celebration_shown_at IS NULL)
// に移した。旧実装は `showCelebration = $state(true)` がマウントのたび true に戻るため、ホームに
// 入るたび全画面モーダルが割り込んでいた (ADR-0012 anti-engagement 違反)。local state は「閉じた
// 直後に即座に消す」ためだけの一時 flag で、次の load では data 側が null を返して出なくなる。
const celebrationChallenge = $derived(data.celebrationChallenge ?? null);
let celebrationDismissed = $state(false);

// #3333 fix (B): 個別完了したチャレンジのごほうび受取導線（旧 ChallengeBanner の per-instance claim 復元）。
// per-child 報酬モデル（ADR-0055）+ #2488 must-1 の設計意図 = 「自身の instance が completed=1 かつ
// rewardClaimed=0 なら受取可能」。この card を claim の単一経路（永続 claim 導線）にする。
// SiblingCelebration は dismissible な祝福演出のみを担い claim form を持たないため、単一児
// （allCompleted=自身完了）でも dismiss で受取不能（dead-end）にならない。完了済・未受取なら
// 兄弟全完了 / 個別完了いずれでも常に card で受取できる（`!allCompleted` 排他を撤去、二重導線も排除）。
// server は claim-first で原子化済（既請求は付与せず error）。
let challengeClaiming = $state(false);
const claimableChallenge = $derived(
	data.activeChallenges?.find(
		(c: { childId: ChildId; completed: number; rewardClaimed: number }) =>
			c.childId === (data.child?.id ?? '') && c.completed === 1 && c.rewardClaimed === 0,
	) ?? null,
);

// Pin context menu state
let pinMenuOpen = $state(false);
let pinMenuActivity = $state<{ id: ActivityId; name: string; isPinned: boolean } | null>(null);
let pinSubmitting = $state(false);

// Confirm dialog state (non-baby modes) — kept separate from FSM
// because confirm/result/levelUp are a sequential user-initiated flow
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: ActivityId;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);

// Baby mode: pending activity for inline form
let pendingActivityId = $state<ActivityId | null>(null);

// #4448: 結果ダイアログのポイント数字 (出発点) と、レベルアップを挟んだときの持ち越し
let resultPointEl = $state<HTMLElement | null>(null);
let pendingFlightOrigin: FlightRect | null = null;

/**
 * #4448: 残高を取り込みつつ、変化ぶんを `+N` / `-N` としてヘッダー残高へ飛ばす。
 * 演出できない状況 (baby / ?screenshot / reduced-motion) では invalidateAll() だけが走る。
 */
async function syncBalanceWithFlight(originRect: FlightRect | null) {
	await animateBalanceChange({
		balanceBefore: data.balance,
		originRect,
		settings: ps,
		commit: () => invalidateAll(),
		readBalance: () => data.balance,
	});
}

// Record result overlay
let resultOpen = $state(false);
let resultData = $state<{
	logId: string;
	activityName: string;
	totalPoints: number;
	streakDays: number;
	streakBonus: number;
	masteryBonus: number;
	masteryLevel: number;
	masteryLeveledUp: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
	cancelableUntil: string;
	comboBonus: {
		categoryCombo: { categoryId: CategoryId; name: string; bonus: number }[];
		crossCategoryCombo: { name: string; bonus: number } | null;
		miniCombo: { uniqueCount: number; bonus: number } | null;
		hints: { message: string }[];
		totalNewBonus: number;
	} | null;
} | null>(null);

// Error state
let errorMessage = $state('');

// Submitting state (多重送信防止)
let submitting = $state(false);

// Cancel state
let cancelCountdown = $state(0);
let cancelTimerId = $state<ReturnType<typeof setInterval> | null>(null);
let cancelledMessage = $state(false);

// Login stamp data (populated by form action result)
let stampPressData = $state<{
	stampRarity: string;
	stampName: string;
	stampOmikujiRank: string | null;
	instantPoints: number;
	consecutiveDays: number;
	multiplier: number;
	cardFilledSlots: number;
	cardTotalSlots: number;
	cardEntries: { slot: number; emoji: string; rarity: string; omikujiRank: string | null }[];
	weeklyRedeem: {
		points: number;
		filledSlots: number;
		totalSlots: number;
		completeBonus: number;
	} | null;
} | null>(null);
let bonusClaiming = $state(false);
// Issue #2097 B-14a: single-attempt guard for loginStamp form auto-claim.
// `bonusClaiming` is cleared unconditionally on form completion (success / failure),
// and `data.loginBonusStatus.claimedToday` is loaded from server (not reactive to form result).
// Without this guard, a failed loginStamp action triggers `$effect` re-evaluation →
// `triggerLoginBonus()` → form re-submit → another failure → infinite retry storm
// (observed 17-52 consecutive HTTP 500 on demo Lambda, ISSUE-002).
let loginStampAttempted = $state(false);

// Mission complete result state
let missionResult = $state<{
	missionCompleted: boolean;
	allComplete: boolean;
	bonusAwarded: number;
} | null>(null);

// Level up overlay state (kept separate — part of user-initiated record flow)
let levelUpData = $state<{
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
	categoryId?: CategoryId;
	categoryName?: string;
} | null>(null);

// XP gain animation state
let xpGainData = $state<{
	categoryId: CategoryId;
	categoryName: string;
	xpBefore: number;
	xpAfter: number;
	maxValue: number;
	levelBefore: number;
	levelAfter: number;
} | null>(null);
let xpAnimatingCategoryId = $state<CategoryId | null>(null);

/** categoryXp にアニメーション用の上書き値を適用 */
function getCategoryXpWithAnim(
	categoryId: CategoryId,
): import('$lib/server/services/status-service').CategoryXpInfo | null {
	const base = data.categoryXp?.[categoryId] ?? null;
	if (!base) return null;
	if (xpGainData && xpGainData.categoryId === categoryId && xpAnimatingCategoryId === categoryId) {
		return {
			...base,
			value: xpGainData.xpAfter,
			level: xpGainData.levelAfter,
		};
	}
	return base;
}

// Build recorded counts map: activityId → count
// Issue #2084: ProdDashboardSections は service 経由で参照するが、page 内のオーバーレイ
// (result dialog 内の todayTotalCount / xp animation 等) で同じ値を使うため、page 側でも
// data.todayRecorded から派生値を計算する (ADR-0046 reactive 設計と一致)。
const recordedMap = $derived(new Map(data.todayRecorded.map((r) => [r.activityId, r.count])));
const todayTotalCount = $derived(data.todayRecorded.reduce((sum, r) => sum + r.count, 0));

function getCount(activityId: ActivityId): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: ActivityId; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false;
	return getCount(activity.id) >= limit;
}

// #2295 (EPIC #2294 ①): activeEventBadge 削除済 (2026-05-19) — シーズンイベント機構撤去
const activeEventBadge: string | null = null;

// Per-category mission counts (ProdDashboardSections で props として渡す)
function getCategoryMissionCount(categoryId: CategoryId) {
	return data.activities.filter((a) => a.categoryId === categoryId && a.isMission).length;
}
function getCategoryCompletedMissionCount(categoryId: CategoryId) {
	return data.activities.filter((a) => a.categoryId === categoryId && a.isMission && isCompleted(a))
		.length;
}

// #3333: チャレンジ対象カテゴリ → 進捗。旧 ChallengeBanner 横長バナーの代替として、
// 対象カテゴリの CategorySection ヘッダーに静的バッジ + インライン進捗を表示する
// (#2146/#2168 カード演出統合思想)。
const challengeTargetByCategory = $derived(
	new Map(
		(
			data.challengeTargets ??
			([] as {
				categoryId: CategoryId;
				currentValue: number;
				targetValue: number;
				completed: boolean;
				title: string;
			}[])
		).map((t) => [t.categoryId, t]),
	),
);
function getChallengeTarget(categoryId: CategoryId) {
	const t = challengeTargetByCategory.get(categoryId);
	if (!t) return null;
	return {
		current: t.currentValue,
		target: t.targetValue,
		remaining: Math.max(0, t.targetValue - t.currentValue),
		completed: t.completed,
	};
}

function handleActivityTap(activity: { id: ActivityId; name: string; icon: string }) {
	if (submitting || confirmOpen || resultOpen) return;
	soundService.play('tap');
	selectedActivity = activity;
	confirmOpen = true;
}

function handleActivityLongPress(activity: {
	id: ActivityId;
	name: string;
	isPinned?: boolean | number;
}) {
	if (!f.showPin) return;
	soundService.play('tap');
	pinMenuActivity = { id: activity.id, name: activity.name, isPinned: !!activity.isPinned };
	pinMenuOpen = true;
}

async function handlePinToggle() {
	if (!pinMenuActivity) return;
	pinSubmitting = true;
	const formData = new FormData();
	formData.set('activityId', String(pinMenuActivity.id));
	formData.set('pinned', String(!pinMenuActivity.isPinned));
	// #3225 ②b: 失敗を silent にしない。子供画面なので age-tier 対応 (preschool/baby=ひらがな) の
	//   error 文言を使う (DESIGN.md §8)。form action の raw fetch でも !res.ok で汎用文言にフォールバック。
	const errorLabels = getErrorNotifyLabels(data.uiMode ?? 'preschool');
	try {
		const res = await fetch('?/togglePin', { method: 'POST', body: formData });
		if (!res.ok) {
			await notifyApiError(res, { labels: errorLabels });
		}
	} catch {
		notifyNetworkError({ labels: errorLabels });
	} finally {
		pinSubmitting = false;
		pinMenuOpen = false;
		pinMenuActivity = null;
		await invalidateAll();
	}
}

function handleConfirmClose() {
	confirmOpen = false;
	selectedActivity = null;
}

function startCancelCountdown(until: string) {
	const remaining = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
	cancelCountdown = remaining;

	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = setInterval(() => {
		cancelCountdown--;
		if (cancelCountdown <= 0) {
			if (cancelTimerId) clearInterval(cancelTimerId);
			cancelTimerId = null;
		}
	}, 1000);
}

function handleResultClose() {
	// #4448: 閉じる前に、結果ダイアログのポイント数字の座標を掴む (閉じたら要素は消える)
	const originRect = captureFlightOrigin(resultPointEl);

	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = null;
	resultOpen = false;
	missionResult = null;

	// XPバーアニメーションを開始
	if (xpGainData) {
		xpAnimatingCategoryId = xpGainData.categoryId;
		setTimeout(() => {
			xpAnimatingCategoryId = null;
		}, 900);
	}

	// レベルアップがあれば FSM 経由で表示
	if (levelUpData) {
		// レベルアップ表示中は残高を更新しない (ダイアログの表示データが入れ替わるため)。
		// 出発点だけ持ち越し、レベルアップを閉じたときにまとめて反映する。
		pendingFlightOrigin = originRect;
		openDialog('levelUp', levelUpData);
	} else {
		isFirstRecord = false;
		resultData = null;
		xpGainData = null;
		void syncBalanceWithFlight(originRect);
	}
}

function handleLevelUpClose() {
	const originRect = pendingFlightOrigin;
	pendingFlightOrigin = null;
	closeDialog();
	levelUpData = null;
	isFirstRecord = false;
	resultData = null;
	xpGainData = null;
	void syncBalanceWithFlight(originRect);
}

function handleStampPressClose() {
	closeDialog();
	invalidateAll();
}

/**
 * #4410 AC6 (同 class 横展開): 「見せた」記録の POST を握り潰さない。
 *
 * 旧実装は `catch {}` で network 失敗も HTTP エラーも黙って捨てていたため、失敗すると
 * #4410 と同じ「毎回出る」症状になり、しかも原因が観測できなかった。ここでは
 *   (a) HTTP ステータスも失敗として扱い、(b) 1 回だけ再送し、(c) それでも駄目なら warn を残す。
 * 最終的に失敗しても画面は壊さず次回もう一度出す (安全側 = 無音の消失より再掲、#4261 と同方針)。
 */
async function postShown(url: string): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(url, { method: 'POST' });
			if (res.ok) return;
		} catch {
			// 次の attempt で再送する
		}
	}
	console.warn(`[child-home] 表示済みの記録に失敗しました (次回もう一度表示されます): ${url}`);
}

async function handleMessageClose() {
	if (data.latestMessage) {
		await postShown(`/api/v1/messages/${data.latestMessage.id}/shown`);
	}
	closeDialog();
	invalidateAll();
}

async function handleRewardClose() {
	if (data.latestReward) {
		await postShown(`/api/v1/special-rewards/${data.latestReward.id}/shown`);
	}
	closeDialog();
}

function handleAdventureClose() {
	closeDialog();
	triggerLoginBonus();
}

function triggerLoginBonus() {
	// Issue #2097 B-14a: enforce single-attempt per page mount.
	// If the loginStamp action fails, `bonusClaiming` is reset to false and
	// `data.loginBonusStatus.claimedToday` remains false (no invalidate on failure),
	// so without this guard the auto-claim would retry indefinitely.
	if (loginStampAttempted) return;
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		loginStampAttempted = true;
		bonusClaiming = true;
		tick().then(() => {
			document.getElementById('claim-bonus-btn')?.click();
		});
	}
}

function handleBirthdayOpen() {
	openDialog('birthday', data.birthdayBonus);
}

// #4313: 年齢帯 UI 切替の告知を閉じる。閉じた時点で server 側の pending notice を既読化し、
// 以後どの日に再ログインしても再表示されない (ADR-0012: 1 回で終わる)。
// × / Esc / ボタンのどれで閉じても呼ばれ得るため、既読化は 1 回だけ走らせる。
//
// `DialogFSM` は素の class instance で `$state` proxy が効かないため、`fsm.current` の
// 変化は OverlaysSection まで伝播しない。「同時に 1 枚」の arbitration は FSM に任せ、
// **描画用の開閉は本 $state が持つ** (FSM が uiModeChange を current にできたときだけ true)。
let uiModeChangeOpen = $state(false);
let uiModeChangeDismissed = $state(false);
async function handleUiModeChangeClose() {
	uiModeChangeOpen = false;
	closeDialog();
	if (uiModeChangeDismissed) return;
	uiModeChangeDismissed = true;
	try {
		await fetch('?/dismissUiModeChangeNotice', { method: 'POST', body: new FormData() });
	} catch {
		// 既読化に失敗しても画面は閉じる。次回ログインで再度表示される（安全側）。
	}
}

// #1757 (#1709-C): 「今日のおやくそく」全達成 bonus が**この load で初回付与された**ときだけ
// toast を 1 回鳴らす。Anti-engagement (ADR-0012):
// - granted === true の判定は server 側で point_ledger に書き込んだ瞬間のみ true。
// - 同日 2 回目以降の load では granted=false が返るため toast 再演出なし。
// - モーダルを出さず Toast (3s 自動消失) のみで完結 → タップ離脱阻害なし。
let mustToastShown = $state(false);
$effect(() => {
	if (typeof window === 'undefined') return;
	if (mustToastShown) return;
	const must = data.mustStatus;
	if (must?.granted && must.points > 0) {
		mustToastShown = true;
		showToast(
			`${CHILD_HOME_LABELS.mustAllCompleteEmoji} ${CHILD_HOME_LABELS.mustAllComplete}`,
			CHILD_HOME_LABELS.mustBonusGranted(must.points),
			'success',
		);
	}
});

// --- Page load: enqueue auto-triggered dialogs via FSM (#671) ---
$effect(() => {
	if (typeof window === 'undefined') return;

	// Build triggers from page data
	const shouldShowAdventure = f.showAdventureStart && data.isFirstTime;
	const shouldShowReward = data.latestReward && !bonusClaiming;
	const shouldShowMessage = f.showParentMessages && data.latestMessage;

	// #4313: 誕生日で年齢帯 UI が切り替わったことの告知。
	// 誕生日ボーナスが未受取の回では出さない (ADR-0012: ダイアログを 2 枚連続で見せない)。
	// notice は既読化されず server に残るため、次回ログインで単独表示される。
	const shouldShowUiModeChange = shouldShowUiModeChangeNotice({
		notice: data.uiModeChangeNotice ?? null,
		birthdayPending: Boolean(data.birthdayBonus),
		isScreenshotMode,
	});

	// #4433: 達成祝福も FSM の arbitration に載せる。従来は FSM の外で
	// `{#if celebrationChallenge}` だけを見て描画していたため、ログインボーナス
	// (`stampPress`) と**同時に開く**ことがあった。Ark UI (zag-js) の dismissable-layer は
	// 「最後に開いた layer」以外を `pointer-events: none` にするので、後から開いた
	// ログインボーナスに祝福の click が吸われ、子供が祝福を閉じられなくなっていた
	// (z-index では解決しない。docs/DESIGN.md §10「侵襲的演出を重ねない」)。
	const shouldShowCelebration = f.showSiblingFeatures && celebrationChallenge;
	// 兄弟の応援 overlay も同じ class の defect (FSM 外で開くため祝福と重なりうる) なので
	// 同時に arbitration へ載せる (ADR-0061: 同 class は 1 件目で guard 化する)。
	const shouldShowCheer =
		!isScreenshotMode &&
		f.showSiblingFeatures &&
		showCheerOverlay &&
		data.unshownCheers &&
		data.unshownCheers.length > 0;

	fsm.onDataLoad({
		adventure: shouldShowAdventure ? { childName: data.child?.nickname ?? '' } : undefined,
		specialReward: shouldShowReward ? data.latestReward : undefined,
		parentMessage: shouldShowMessage ? data.latestMessage : undefined,
		uiModeChange: shouldShowUiModeChange ? data.uiModeChangeNotice : undefined,
		siblingCheer: shouldShowCheer ? data.unshownCheers : undefined,
		celebration: shouldShowCelebration ? celebrationChallenge : undefined,
		// birthday は自動トリガーから除外 — バナークリック(handleBirthdayOpen)でのみ開く
	});
	syncDialog();

	// FSM が uiModeChange を current にできたときだけ描画する (他ダイアログが出る回は queue
	// に入るだけで表示しない = 2 枚連続演出を作らない、ADR-0012)。既読化済みなら再表示しない。
	// `currentDialog` ではなく `fsm.current` を読む: 本 $effect は `syncDialog()` で
	// `currentDialog` を **書く** ため、ここで読むと自己依存になって再実行が連鎖しうる。
	// FSM 側は非リアクティブなので読んでも依存に入らない。
	if (!uiModeChangeDismissed) {
		uiModeChangeOpen = fsm.current === 'uiModeChange';
	}

	// If adventure is not showing and login bonus unclaimed, trigger it
	// Note: use shouldShowAdventure (not currentDialog) to avoid circular $effect dependency
	if (
		!shouldShowAdventure &&
		data.loginBonusStatus &&
		!data.loginBonusStatus.claimedToday &&
		!bonusClaiming
	) {
		triggerLoginBonus();
	}
});

/** Record result handler shared by confirm dialog and baby inline forms */
function handleRecordResult(result: { type: string; data?: Record<string, unknown> }) {
	submitting = false;
	pendingActivityId = null;
	confirmOpen = false;
	if (result.type === 'success' && result.data && 'success' in result.data) {
		const d = result.data as {
			logId: string;
			activityName: string;
			totalPoints: number;
			streakDays: number;
			streakBonus: number;
			masteryBonus?: number;
			masteryLevel?: number;
			masteryLeveledUp?: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
			cancelableUntil: string;
			comboBonus: {
				categoryCombo: { categoryId: CategoryId; name: string; bonus: number }[];
				crossCategoryCombo: { name: string; bonus: number } | null;
				miniCombo: { uniqueCount: number; bonus: number } | null;
				hints: { message: string }[];
				totalNewBonus: number;
			} | null;
			missionComplete: {
				missionCompleted: boolean;
				allComplete: boolean;
				bonusAwarded: number;
			} | null;
			levelUp: {
				oldLevel: number;
				oldTitle: string;
				newLevel: number;
				newTitle: string;
				categoryId?: CategoryId;
				categoryName?: string;
				spGranted?: number;
			} | null;
			xpGain?: {
				categoryId: CategoryId;
				categoryName: string;
				xpBefore: number;
				xpAfter: number;
				maxValue: number;
				levelBefore: number;
				levelAfter: number;
			};
		};
		resultData = {
			logId: d.logId,
			activityName: d.activityName,
			totalPoints: d.totalPoints,
			streakDays: d.streakDays,
			streakBonus: d.streakBonus,
			masteryBonus: d.masteryBonus ?? 0,
			masteryLevel: d.masteryLevel ?? 1,
			masteryLeveledUp: d.masteryLeveledUp ?? null,
			cancelableUntil: d.cancelableUntil,
			comboBonus: d.comboBonus ?? null,
		};
		missionResult = d.missionComplete ?? null;
		levelUpData = d.levelUp ?? null;
		xpGainData = d.xpGain ?? null;
		startCancelCountdown(d.cancelableUntil);
		soundService.playRecordComplete();
		setTimeout(() => soundService.play('point-gain'), 300);
		resultOpen = true;
	} else if (result.type === 'failure' && result.data && 'error' in result.data) {
		errorMessage = String(result.data.error);
		soundService.play('error');
		setTimeout(() => {
			errorMessage = '';
		}, 3000);
		invalidateAll();
	} else {
		invalidateAll();
	}
	selectedActivity = null;
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.childHome}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

{#if data.uiMode === 'baby'}
<BabyHomePage child={data.child ?? { nickname: '', age: 0 }} balance={data.balance} />
{:else}
<div class="px-[var(--sp-sm)] py-1" data-testid="{data.uiMode}-home-page">
	<!-- Birthday bonus banner -->
	<!-- #3017: `?screenshot=*` 中は抑止 — 撮影日が demo fixture の誕生日 window (誕生日から 3 日間)
	     に重なると banner が出現して全要素を押し下げ、LP/child-home/app の visual regression
	     baseline と diff >10% で誤 fail する (年 5 回再発する撮影日依存 flake)。screenshot mode は
	     「決定的に再現可能な演出のみ ON」(#1893) が趣旨であり、日付依存演出は OFF が整合的。
	     通常表示 (screenshot mode off) の挙動は不変。 -->
	{#if data.birthdayBonus && !isScreenshotMode}
		<BirthdayBanner
			nickname={data.child?.nickname ?? ''}
			newAge={data.birthdayBonus.newAge ?? 0}
			totalPoints={data.birthdayBonus.totalPoints ?? 0}
			onclick={handleBirthdayOpen}
		/>
	{/if}

	<!-- Error toast -->
	{#if errorMessage}
		<div class="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-stat-red)] text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold animate-bounce-in">
			{errorMessage}
		</div>
	{/if}

	<!-- Login stamp auto-claim form (hidden) — unified bonus + stamp -->
	{#if bonusClaiming && currentDialog !== 'stampPress'}
		<form
			method="POST"
			action="?/loginStamp"
			use:enhance={() => {
				return async ({ result }) => {
					// Issue #2097 B-14a: gate stampPress transition on truthy `loginStamp` field.
					// Server may return `{ success: false, loginStamp: false, reason: 'no-child-selected' }`
					// for anonymous/demo flow without selectedChildId (previously HTTP 400 → client retry storm).
					if (result.type === 'success' && result.data && result.data.loginStamp === true) {
						const d = result.data as Record<string, unknown>;
						const cardData = d.cardData as { filledSlots: number; totalSlots: number; entries: { slot: number; emoji: string; rarity: string; omikujiRank: string | null }[] } | null;
						stampPressData = {
							stampRarity: (d.stampRarity as string) || 'N',
							stampName: (d.stampName as string) || '',
							stampOmikujiRank: (d.omikujiRank as string) ?? null,
							instantPoints: (d.instantPoints as number) || 0,
							consecutiveDays: (d.consecutiveLoginDays as number) || 0,
							multiplier: (d.multiplier as number) || 1,
							cardFilledSlots: cardData?.filledSlots ?? 0,
							cardTotalSlots: cardData?.totalSlots ?? 5,
							cardEntries: cardData?.entries ?? [],
							weeklyRedeem: d.weeklyRedeem as { points: number; filledSlots: number; totalSlots: number; completeBonus: number } | null,
						};
						openDialog('stampPress', stampPressData);
					}
					bonusClaiming = false;
				};
			}}
			class="hidden"
		>
			<Button type="submit" id="claim-bonus-btn" variant="ghost" size="sm">claim</Button>
		</form>
	{/if}

	<!-- #4261 ③: 習慣化告知 (次回起動で 1 回だけ / 閉じる操作なし) -->
	<HabitCertificateNoticeBanner
		visible={showHabitCertificateNotice}
		uiMode={data.uiMode as Exclude<UiMode, 'baby'>}
		amount={formatPointValue(data.habitCertificateNotice?.points ?? 0, ps.mode, ps.currency, ps.rate)}
	/>

	<!-- Tutorial hint banner (one-time) -->
	<TutorialHintBanner visible={showTutorialHint} onDismiss={dismissTutorialHint} />

	<!--
		Issue #2084 (ADR-0046 follow-up): 共通 dashboard sections は派生コンポーネント
		ProdDashboardSections に集約。activity grid / SiblingRanking / ActivityEmptyState
		の render を含む。
		(#2146: 旧 MustProgressBar 専用セクションは撤廃。priority='must' は ActivityCard
		自身の isMust prop で ribbon badge 表示する設計に統合済み)。
		本派生は getDashboardService() 経由で child / todayRecorded / pointSettings を参照。
	-->
	<ProdDashboardSections
		uiMode={data.uiMode as UiMode}
		activities={data.activities}
		siblingRanking={data.siblingRanking}
		{activeEventBadge}
		{displayConfig}
		features={{
			showPin: f.showPin,
			showConfirmDialog: f.showConfirmDialog,
			showSiblingFeatures: f.showSiblingFeatures,
			// #2295 (EPIC #2294 ①): showEvents 削除済 (2026-05-19)
		}}
		isPremium={data.isPremium}
		childId={data.child?.id ?? asChildId('')}
		{submitting}
		{pendingActivityId}
		{getCategoryXpWithAnim}
		{xpAnimatingCategoryId}
		{getCategoryMissionCount}
		{getCategoryCompletedMissionCount}
		{getChallengeTarget}
		onActivityTap={handleActivityTap}
		onActivityLongPress={handleActivityLongPress}
		onRecordSubmit={(activityId) => {
			submitting = true;
			pendingActivityId = activityId;
		}}
		onRecordResult={handleRecordResult}
	/>

	<!-- #2295 (EPIC #2294 ①): Season event banner 削除済 (2026-05-19) -->
	<!--
		#3333: 旧 ChallengeBanner 横長バナーを撤去。チャレンジ対象は対象カテゴリの
		CategorySection ヘッダーに静的バッジ + インライン進捗で統合（ProdDashboardSections 経由、
		#2146/#2168 カード演出統合思想）。ごほうび受取は下のコンパクトな永続 claim-card が単一経路で担う
		（#2488 must-1 / per-child 報酬 ADR-0055）。SiblingCelebration は祝福演出のみで claim を持たない。
	-->

	<!-- #3333 fix (B): 完了済・未受取チャレンジのごほうび受取（旧 ChallengeBanner per-instance claim の復元）。
	     横長 banner ではなくコンパクトなカード演出（fitness function denylist 非該当 / #2146/#2168 整合）。
	     単一児 / 多子いずれも completed=1 && rewardClaimed=0 なら常時表示の永続 claim 導線（dead-end 回避）。
	     claim はこの card 単一経路に集約し二重導線 / 二重 POST を排除。server は claim-first で原子化。 -->
	{#if claimableChallenge}
		<div
			class="mx-auto my-[var(--sp-sm)] max-w-xs rounded-[var(--radius-md)] bg-[var(--color-surface-success)] px-[var(--sp-md)] py-[var(--sp-sm)] text-center"
			data-testid="challenge-reward-claim-card"
		>
			<p class="text-sm font-bold text-[var(--color-feedback-success-text)]">
				<span aria-hidden="true">{CONCEPT_ICONS.challenge}</span>
				{claimableChallenge.title}
			</p>
			<form
				method="POST"
				action="?/claimChallengeReward"
				use:enhance={() => {
					if (challengeClaiming) return ({ update }) => update();
					challengeClaiming = true;
					return async ({ result, update }) => {
						await update();
						challengeClaiming = false;
						// #3361 (ux-4): claim 失敗 (fail400 = 既請求 / 未達 / IDOR 等) を可視化して
						// dead-end (押しても無反応) を回避する (NN/G #1、Toast は role="alert")。
						if (result.type === 'failure') {
							const err = result.data?.error;
							showToast(
								FEATURES_LABELS.challenge.claimErrorTitle,
								typeof err === 'string' ? err : FEATURES_LABELS.challenge.claimErrorFallback,
								'error',
							);
						}
					};
				}}
			>
				<input type="hidden" name="challengeId" value={claimableChallenge.id} />
				<Button
					type="submit"
					variant="primary"
					size="sm"
					class="mt-[var(--sp-sm)] w-full"
					disabled={challengeClaiming}
					data-testid="challenge-reward-claim-btn"
				>
					{FEATURES_LABELS.challenge.celebrationClaimBtn}
				</Button>
			</form>
		</div>
	{/if}
</div>

<!-- Pin context menu (non-baby) -->
{#if f.showPin}
<Dialog bind:open={pinMenuOpen} closable={true} title="">
	{#if pinMenuActivity}
		<div class="flex flex-col items-center gap-3 text-center py-2">
			<p class="text-base font-bold">{pinMenuActivity.name}</p>
			<Button
				variant={pinMenuActivity.isPinned ? 'ghost' : 'warning'}
				size="md"
				class="w-full {pinMenuActivity.isPinned ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]' : 'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]'}"
				disabled={pinSubmitting}
				onclick={handlePinToggle}
			>
				{#if pinSubmitting}
					<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
				{:else if pinMenuActivity.isPinned}
					{CHILD_HOME_LABELS.pinActionUnpin}
				{:else}
					{CHILD_HOME_LABELS.pinActionPin}
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="w-full text-[var(--color-text-muted)]"
				onclick={() => { pinMenuOpen = false; pinMenuActivity = null; }}
			>
				{CHILD_HOME_LABELS.pinCloseButton}
			</Button>
		</div>
	{/if}
</Dialog>
{/if}

<!-- Confirm dialog (non-baby) -->
{#if f.showConfirmDialog}
<Dialog bind:open={confirmOpen} closable={false} title="" testid="confirm-dialog">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center">
			<CompoundIcon icon={selectedActivity.icon} size="xl" />
			<p class="text-lg font-bold">{CHILD_HOME_LABELS.confirmTitleBr(selectedActivity.displayName ?? selectedActivity.name)}<br />{CHILD_HOME_LABELS.confirmTitleBrLine2}</p>
			<div class="flex gap-[var(--sp-sm)] w-full">
				<Button
					variant="ghost"
					size="md"
					class="flex-1 bg-[var(--color-surface-tertiary)]"
					data-testid="confirm-cancel-btn"
					disabled={submitting}
					onclick={handleConfirmClose}
				>
					{CHILD_HOME_LABELS.confirmCancelButton}
				</Button>
				<form
					method="POST"
					action="?/record"
					class="flex-1"
					use:enhance={() => {
						if (submitting) return ({ update }) => update();
						submitting = true;
						soundService.ensureContext();
						soundService.play('tap');
						return async ({ result }) => {
							handleRecordResult(result);
						};
					}}
				>
					<input type="hidden" name="activityId" value={selectedActivity.id} />
					<Button
						type="submit"
						disabled={submitting}
						variant="primary"
						size="md"
						data-testid="confirm-record-btn"
						class="w-full {submitting ? 'animate-btn-pulse' : ''}"
					>
						{#if submitting}
							<span class="pending-dot" aria-hidden="true"></span>
							{CHILD_HOME_LABELS.confirmSubmitLoading}
						{:else}
							{CHILD_HOME_LABELS.confirmSubmitButton}
						{/if}
					</Button>
				</form>
			</div>
		</div>
	{/if}
</Dialog>
{/if}

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	{#if resultData}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center py-[var(--sp-md)]">
			{#if cancelledMessage}
				<span class="text-5xl">{CHILD_HOME_LABELS.resultCancelledIcon}</span>
				<p class="text-lg font-bold">{CHILD_HOME_LABELS.resultCancelledTitle}</p>
				<Button
					variant="ghost"
					size="md"
					class="w-full bg-[var(--color-surface-tertiary)] mt-[var(--sp-sm)]"
					onclick={() => {
						cancelledMessage = false;
						resultOpen = false;
						resultData = null;
						// #4448: 取り消しで戻ったぶんも `-N` として残高につなぐ (出発点は残高の少し下)
						void syncBalanceWithFlight(null);
					}}
				>
					{CHILD_HOME_LABELS.resultCancelledClose}
				</Button>
			{:else}
				<div class="relative w-24 h-24 flex items-center justify-center">
					<CelebrationEffect type={celebEffect} />
				</div>
				{#if isFirstRecord}
					<p class="text-lg font-bold text-[var(--theme-accent)]">{CHILD_HOME_LABELS.resultFirstRecord}</p>
					<p class="text-sm font-bold">{CHILD_HOME_LABELS.resultActivityRecorded(resultData.activityName)}</p>
				{:else}
					<p class="text-lg font-bold">{CHILD_HOME_LABELS.resultActivityRecorded(resultData.activityName)}</p>
				{/if}
				<!-- #4448: この数字がヘッダー残高へ飛ぶ (出発点) -->
				<div class="animate-point-pop" bind:this={resultPointEl} data-testid="result-point-value">
					<p class="text-2xl font-bold text-[var(--color-point)]">{fmtPts(resultData.totalPoints)}</p>
				</div>
				{#if resultData.streakDays >= 2}
					<p class="text-sm text-[var(--theme-accent)]">
						{CHILD_HOME_LABELS.resultStreakBonus(resultData.streakDays, resultData.streakBonus)}
					</p>
				{/if}
				{#if resultData.masteryBonus > 0}
					<p class="text-sm text-[var(--color-stat-purple)]">
						{CHILD_HOME_LABELS.resultMasteryBonus(resultData.masteryBonus, resultData.masteryLevel)}
					</p>
				{/if}
				{#if resultData.masteryLeveledUp}
					<div class="bg-[var(--color-stat-purple-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-[var(--color-stat-purple)]">
							{CHILD_HOME_LABELS.resultMasteryLevelUp(resultData.activityName, resultData.masteryLeveledUp.newLevel)}
						</p>
					</div>
				{/if}
				{#if resultData.comboBonus}
					<div class="bg-[var(--theme-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						{#each resultData.comboBonus.categoryCombo as cc}
							<p class="text-sm font-bold text-[var(--theme-accent)]">
								{CHILD_HOME_LABELS.resultComboCategoryCombo(cc.name, getCategoryById(cc.categoryId)?.name ?? '')} {fmtPts(cc.bonus)}
							</p>
						{/each}
						{#if resultData.comboBonus.crossCategoryCombo}
							<p class="text-sm font-bold text-[var(--color-point)]">
								{resultData.comboBonus.crossCategoryCombo.name + CHILD_HOME_LABELS.crossComboBang} {fmtPts(resultData.comboBonus.crossCategoryCombo.bonus)}
							</p>
						{/if}
					</div>
				{/if}
				{#if missionResult}
					<div class="bg-[var(--color-feedback-warning-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-[var(--color-feedback-warning-text)]">
							{CHILD_HOME_LABELS.resultMissionComplete}
							{#if missionResult.bonusAwarded > 0}
								{fmtPts(missionResult.bonusAwarded)}
							{/if}
						</p>
						{#if missionResult.allComplete}
							<p class="text-xs font-bold text-[var(--color-feedback-warning-text)]">{CHILD_HOME_LABELS.resultMissionAllClear}</p>
						{/if}
					</div>
				{/if}

				{#if xpGainData}
					<!-- #4509 ①: 増分は XpGainRow が xpAfter - xpBefore から導出する (旧: +0.3 固定リテラル) -->
					<XpGainRow xp={xpGainData} />
				{/if}

				<p class="text-xs text-[var(--color-text-muted)]">{CHILD_HOME_LABELS.resultTodayCount(todayTotalCount + 1)}</p>

				<div class="flex gap-[var(--sp-sm)] w-full mt-[var(--sp-sm)]">
					<!-- Cancel button with countdown -->
					{#if cancelCountdown > 0}
						<form
							method="POST"
							action="?/cancelRecord"
							class="flex-1"
							use:enhance={() => {
								return async ({ result }) => {
									if (result.type === 'success' && result.data && 'cancelled' in result.data) {
										if (cancelTimerId) clearInterval(cancelTimerId);
										cancelTimerId = null;
										cancelledMessage = true;
									}
								};
							}}
						>
							<input type="hidden" name="logId" value={resultData.logId} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								data-testid="activity-cancel-btn"
								class="w-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]"
							>
								{CHILD_HOME_LABELS.resultCancelButton(cancelCountdown)}
							</Button>
						</form>
					{/if}
					<Button
						variant="primary"
						size="md"
						class="flex-1"
						data-testid="activity-confirm-btn"
						onclick={handleResultClose}
					>
						{CHILD_HOME_LABELS.resultConfirmButton}
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</Dialog>

<OverlaysSection
	current={currentDialog}
	{levelUpData}
	onLevelUpClose={handleLevelUpClose}
	latestReward={data.latestReward}
	onRewardClose={handleRewardClose}
	{stampPressData}
	onStampPressClose={handleStampPressClose}
	birthdayBonus={data.birthdayBonus}
	onBirthdayClose={() => closeDialog()}
	uiModeChangeNotice={data.uiModeChangeNotice ?? null}
	{uiModeChangeOpen}
	onUiModeChangeClose={handleUiModeChangeClose}
	nickname={data.child?.nickname ?? ''}
	uiMode={data.uiMode}
/>

<!-- Adventure start overlay (first-time users, non-baby) -->
{#if f.showAdventureStart && data.isFirstTime && currentDialog === 'adventure'}
	<AdventureStartOverlay
		open={true}
		childName={data.child?.nickname ?? ''}
		onClose={handleAdventureClose}
	/>
{/if}

<!-- Parent message overlay (non-baby) -->
<!-- #2097 PR-B1 hotfix: isScreenshotMode で抑止 (FSM-gated だが安全側で抑止) -->
{#if !isScreenshotMode && f.showParentMessages && data.latestMessage && currentDialog === 'parentMessage'}
	<ParentMessageOverlay
		open={true}
		messageType={data.latestMessage.messageType}
		stampLabel={data.latestMessage.stampLabel}
		body={data.latestMessage.body}
		icon={data.latestMessage.icon}
		onClose={handleMessageClose}
	/>
{/if}

<!--
	Sibling celebration (all siblings complete, non-baby)
	#4433: FSM が current にした回だけ描画する。ログインボーナス等と同時に開くと、
	後から開いた側に click を吸われて子供が祝福を閉じられなくなる (DESIGN.md §10)。
	他の演出が出ている回は queue に入り、それを閉じた時点で本祝福が出る。
-->
{#if f.showSiblingFeatures && !celebrationDismissed && celebrationChallenge && currentDialog === 'celebration'}
	<SiblingCelebration
		challengeId={celebrationChallenge.id}
		challengeTitle={celebrationChallenge.title}
		showClaimHint={celebrationChallenge.rewardClaimed === 0}
		siblings={celebrationChallenge.siblings.map((s: { childId: ChildId; completed: number }) => ({
			// #4509 ⑤: 名前が引けない回に内部 ID を子供へ見せない (DESIGN.md §6)
			name: resolveSiblingDisplayName(data.allChildren, s.childId),
			completed: s.completed === 1,
		}))}
		onDismiss={() => { celebrationDismissed = true; closeDialog(); }}
	/>
{/if}

<!-- Sibling cheer overlay (non-baby) -->
<!-- #2097 PR-B1 hotfix: isScreenshotMode で抑止 (LP SS の overlay 被り対策) -->
{#if !isScreenshotMode && f.showSiblingFeatures && showCheerOverlay && data.unshownCheers && data.unshownCheers.length > 0 && currentDialog === 'siblingCheer'}
	<SiblingCheerOverlay
		cheers={data.unshownCheers}
		onDismiss={() => { showCheerOverlay = false; closeDialog(); }}
	/>
{/if}

<!-- #2295 (EPIC #2294 ①): Monthly premium reward modal 削除済 (2026-05-19) -->
{/if}

<style>
	/* #3225 b2: baby-card global animations moved to app.css (max-style-lines + SSOT for
	   .baby-card-* rendered by ProdDashboardSections). Only page-local .pending-dot remains. */
	.pending-dot {
		display: inline-block;
		width: 0.7em;
		height: 0.7em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
		margin-right: 4px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
