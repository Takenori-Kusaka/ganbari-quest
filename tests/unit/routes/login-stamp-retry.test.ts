// tests/unit/routes/login-stamp-retry.test.ts
// Issue #2097 B-14a: loginStamp HTTP 500 retry storm regression test
//
// 背景 (ISSUE-002):
// - /preschool/home などで `POST ?/loginStamp` が 17-52 連続で 500/400 リトライ
// - 原因: form action 失敗時に `bonusClaiming` が false に戻り、
//   `data.loginBonusStatus.claimedToday` は load 結果のままなので
//   $effect 再評価 → triggerLoginBonus() が再発火 → 無限ループ
// - 防御策: `loginStampAttempted` フラグで page mount あたり 1 回に制限 (Fix 1)
//   + server 側で childId 欠落時に fail(400) ではなく success no-op を返す (Fix 2)
//
// 本テスト観点:
// - triggerLoginBonus は loginStampAttempted=true 状態では 2 回目以降 no-op (Fix 1)
// - bonusClaiming が false に戻っても再発火しない (Fix 1 のコア)
// - loginStamp action: childId 未設定で fail(400) ではなく success no-op (Fix 2)
// - success no-op result では stampPress 遷移しない (Fix 2 client guard)

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 action / state の最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Fix 1: triggerLoginBonus semantics (pure logic, no Svelte runtime) ----------
//
// `+page.svelte` の triggerLoginBonus() の本質的な振る舞いを単体関数として再現し、
// ガード (`loginStampAttempted`) が無いと無限再発火する、ある場合は 1 回で止まる、を確認する。

interface LoginBonusStatus {
	claimedToday: boolean;
}

interface TriggerState {
	loginStampAttempted: boolean;
	bonusClaiming: boolean;
	clickCount: number;
}

/**
 * `+page.svelte` の triggerLoginBonus() の純粋ロジック再現 (Fix 1 適用後)。
 * 実物 (lines 364-376) と同じ判定順序で `clickCount` を上げる。
 */
function triggerLoginBonus(
	state: TriggerState,
	loginBonusStatus: LoginBonusStatus | null | undefined,
): void {
	// Fix 1: single-attempt guard
	if (state.loginStampAttempted) return;
	if (loginBonusStatus && !loginBonusStatus.claimedToday && !state.bonusClaiming) {
		state.loginStampAttempted = true;
		state.bonusClaiming = true;
		state.clickCount += 1; // tick().then(() => click()) の模擬
	}
}

/**
 * 旧実装 (Fix 1 適用前) — `loginStampAttempted` 無し版。
 * 失敗ループ条件下で何回呼ばれても再発火するため、リグレッション比較用。
 */
function triggerLoginBonusLegacy(
	state: TriggerState,
	loginBonusStatus: LoginBonusStatus | null | undefined,
): void {
	if (loginBonusStatus && !loginBonusStatus.claimedToday && !state.bonusClaiming) {
		state.bonusClaiming = true;
		state.clickCount += 1;
	}
}

describe('Issue #2097 B-14a: triggerLoginBonus single-attempt guard (Fix 1)', () => {
	let state: TriggerState;
	const status: LoginBonusStatus = { claimedToday: false };

	beforeEach(() => {
		state = { loginStampAttempted: false, bonusClaiming: false, clickCount: 0 };
	});

	it('1 回目の呼び出しでフォーム送信が発火する', () => {
		triggerLoginBonus(state, status);
		expect(state.clickCount).toBe(1);
		expect(state.bonusClaiming).toBe(true);
		expect(state.loginStampAttempted).toBe(true);
	});

	it('bonusClaiming が中の 2 回目呼び出しは no-op (元から備わっていた防御)', () => {
		triggerLoginBonus(state, status);
		triggerLoginBonus(state, status);
		expect(state.clickCount).toBe(1);
	});

	it('CRITICAL: action 失敗で bonusClaiming=false に戻っても 2 回目は発火しない (Fix 1 コア)', () => {
		// 1 回目: 発火
		triggerLoginBonus(state, status);
		expect(state.clickCount).toBe(1);

		// loginStamp action 失敗を模擬: use:enhance callback (line 567) が `bonusClaiming = false` を実行
		state.bonusClaiming = false;
		// `data.loginBonusStatus.claimedToday` は load 結果のまま (invalidate 無し) なので false 維持

		// $effect 再評価 → triggerLoginBonus 再呼び出し (これがリトライストームの起点)
		triggerLoginBonus(state, status);
		// Fix 1 により loginStampAttempted=true ガードで no-op
		expect(state.clickCount).toBe(1);
	});

	it('CRITICAL: 失敗ループ 50 回想定でも 1 回のみ送信される', () => {
		// 17-52 連続 500 を模擬
		for (let i = 0; i < 50; i++) {
			triggerLoginBonus(state, status);
			state.bonusClaiming = false; // form failure callback
		}
		expect(state.clickCount).toBe(1);
	});

	it('claimedToday=true の場合は発火しない', () => {
		triggerLoginBonus(state, { claimedToday: true });
		expect(state.clickCount).toBe(0);
		expect(state.loginStampAttempted).toBe(false);
	});

	it('loginBonusStatus が null/undefined では発火しない', () => {
		triggerLoginBonus(state, null);
		triggerLoginBonus(state, undefined);
		expect(state.clickCount).toBe(0);
	});
});

describe('Issue #2097 B-14a: 旧実装 (Fix 1 適用前) はリトライストームを起こす - リグレッション証拠', () => {
	it('legacy 実装は失敗ループで 50 回送信してしまう (Fix 1 適用前の挙動再現)', () => {
		const state: TriggerState = {
			loginStampAttempted: false,
			bonusClaiming: false,
			clickCount: 0,
		};
		const status: LoginBonusStatus = { claimedToday: false };

		for (let i = 0; i < 50; i++) {
			triggerLoginBonusLegacy(state, status);
			state.bonusClaiming = false; // form failure callback
		}
		// Fix 1 適用前の旧実装はこの通り 50 回送信してしまう
		// = 本番 demo Lambda で実際に観測された 17-52 リトライストームと一致
		expect(state.clickCount).toBe(50);
	});
});

// ---------- Fix 2: loginStamp action 失敗 → success no-op (server contract) ----------
//
// 重い service モックを避けつつ、Fix 2 の契約 (childId 未設定 → fail(400) でなく
// success no-op) を import + mock で検証する。

const mockRequireTenantId = vi.fn(
	(locals: { context?: { tenantId?: string } }) => locals.context?.tenantId ?? 'tenant-1',
);
const mockClaimLoginBonus = vi.fn();
const mockStampToday = vi.fn();
// #4687 ②: CARD_FULL の日に「今のカード」を読み直して演出へ渡すため、route が呼ぶ
const mockGetStampCardStatus = vi.fn().mockResolvedValue(null);
const mockAutoRedeemPreviousWeek = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => mockRequireTenantId(locals),
}));

// `+page.server.ts` 内の重い依存をすべて空関数で stub (Fix 2 は childId 早期 return なので
// 下流 service は呼ばれない)。fail(400) パスが消えたことを確認できれば十分。
vi.mock('$lib/server/services/activity-log-service', () => ({
	cancelActivityLog: vi.fn(),
	getTodayRecordedActivityCounts: vi.fn().mockResolvedValue([]),
	hasAnyActivityRecords: vi.fn().mockResolvedValue(false),
	recordActivity: vi.fn(),
}));
vi.mock('$lib/server/services/activity-pin-service', () => ({
	sortActivitiesWithPreferences: vi.fn((a) => a),
	toggleActivityPin: vi.fn(),
}));
vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: vi.fn().mockResolvedValue([]),
	tryGrantMustCompletionBonus: vi.fn(),
}));
vi.mock('$lib/server/services/birthday-bonus-service', () => ({
	claimBirthdayBonus: vi.fn(),
	getBirthdayBonusStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('$lib/server/services/checklist-service', () => ({
	getChecklistsForChild: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/services/daily-mission-service', () => ({
	getTodayMissions: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/services/family-streak-service', () => ({
	getFamilyStreak: vi.fn().mockResolvedValue(0),
	getNextMilestone: vi.fn().mockResolvedValue(null),
}));
vi.mock('$lib/server/services/login-bonus-service', () => ({
	claimLoginBonus: (...args: unknown[]) => mockClaimLoginBonus(...args),
	getLoginBonusStatus: vi.fn().mockResolvedValue({ claimedToday: false }),
}));
vi.mock('$lib/server/services/message-service', () => ({
	getUnshownMessage: vi.fn().mockResolvedValue(null),
}));
vi.mock('$lib/server/services/recommendation-service', () => ({
	selectRecommendations: vi.fn().mockResolvedValue([]),
}));
// #2295 (EPIC #2294 ①): season-event-service / seasonal-content-service モック削除済 (2026-05-19)
// #2458-B: sibling-challenge-service 撤去済。child-challenge-service の mock に flip。
vi.mock('$lib/server/services/child-challenge-service', () => ({
	claimChildChallengeReward: vi.fn(),
	getActiveChildChallengesWithSiblings: vi.fn().mockResolvedValue([]),
	// #4410: load が祝福対象の解決に使う
	resolveCelebrationChallenge: vi.fn(() => null),
	markChallengeCelebrationShown: vi.fn().mockResolvedValue(true),
}));
vi.mock('$lib/server/services/sibling-cheer-service', () => ({
	getUnshownCheers: vi.fn().mockResolvedValue([]),
	markCheersShown: vi.fn(),
	sendCheer: vi.fn(),
}));
vi.mock('$lib/server/services/sibling-ranking-service', () => ({
	getWeeklyRanking: vi.fn().mockResolvedValue(null),
	isRankingEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('$lib/server/services/special-reward-service', () => ({
	getUnshownReward: vi.fn().mockResolvedValue(null),
}));
vi.mock('$lib/server/services/stamp-card-service', () => ({
	autoRedeemPreviousWeek: (...args: unknown[]) => mockAutoRedeemPreviousWeek(...args),
	getStampCardStatus: (...args: unknown[]) => mockGetStampCardStatus(...args),
	redeemStampCard: vi.fn(),
	stampToday: (...args: unknown[]) => mockStampToday(...args),
}));
vi.mock('$lib/server/services/status-service', () => ({
	getCategoryXpSummary: vi.fn().mockResolvedValue({}),
}));
vi.mock('$lib/server/logger', () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

type AnyAction = (...args: unknown[]) => any;

import { actions as actionsRaw } from '../../../src/routes/(child)/[uiMode=uiMode]/home/+page.server';

const actions = actionsRaw as unknown as { loginStamp: AnyAction };

describe('Issue #2097 B-14a: loginStamp action no-op for missing selectedChildId (Fix 2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function buildEvent(selectedChildIdCookie: string | undefined) {
		return {
			locals: { context: { tenantId: 'tenant-1' } },
			cookies: {
				get: (key: string) => (key === 'selectedChildId' ? selectedChildIdCookie : undefined),
			},
		};
	}

	it('CRITICAL: selectedChildId cookie 未設定で fail(400) ではなく success no-op を返す', async () => {
		const result = await actions.loginStamp(buildEvent(undefined));

		// 旧実装 (Fix 2 前) は `fail(400, { error: 'パラメータが不正です' })` を返す
		// 新実装は successful response shape を返す
		expect(result).toEqual({
			success: false,
			loginStamp: false,
			reason: 'no-child-selected',
		});

		// fail() ヘルパーが返すオブジェクトは `status` プロパティを持つ。新実装は持たない。
		expect(result).not.toHaveProperty('status');
		// 旧実装は `error` プロパティを持つ。新実装は持たない。
		expect(result).not.toHaveProperty('error');
	});

	it('CRITICAL: no-op response shape は client guard `result.data.loginStamp === true` を通過しない', async () => {
		// `+page.svelte` (Fix 2 適用後 line 540) の判定:
		//   if (result.type === 'success' && result.data && result.data.loginStamp === true)
		// no-op response は loginStamp=false なので stampPress 遷移しない
		const result = await actions.loginStamp(buildEvent(undefined));
		expect(result.loginStamp).toBe(false); // 条件不成立 → fsm.transition('stampPress') 呼ばれない
	});

	it('childId 未設定で下流 service は一切呼ばれない (早期 return)', async () => {
		await actions.loginStamp(buildEvent(undefined));
		expect(mockClaimLoginBonus).not.toHaveBeenCalled();
		expect(mockStampToday).not.toHaveBeenCalled();
		expect(mockAutoRedeemPreviousWeek).not.toHaveBeenCalled();
	});
});

describe('#4687: 週コンプリート済の日とおみくじログインボーナスを演出に出す', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetStampCardStatus.mockResolvedValue(null);
		mockAutoRedeemPreviousWeek.mockResolvedValue(null);
	});

	const event = {
		locals: { context: { tenantId: 'tenant-1' } },
		cookies: { get: (key: string) => (key === 'selectedChildId' ? '1' : undefined) },
	};

	it('CARD_FULL の日は空カード (0 回目 / +0pt) ではなく今のカード + コンプリート表示のデータを返す', async () => {
		mockClaimLoginBonus.mockResolvedValue({
			rank: '吉',
			basePoints: 3,
			totalPoints: 3,
			multiplier: 1,
			consecutiveLoginDays: 4,
			message: '吉！3ポイントゲット！',
		});
		mockStampToday.mockResolvedValue({ error: 'CARD_FULL' });
		mockGetStampCardStatus.mockResolvedValue({
			id: 'card-1',
			filledSlots: 5,
			totalSlots: 5,
			entries: [{ slot: 1, emoji: '🌟', rarity: 'N', omikujiRank: '吉' }],
		});

		const result = await actions.loginStamp(event);

		expect(result.loginStamp).toBe(true);
		expect(result.cardFull).toBe(true);
		// 旧実装は cardData=null → 演出が「今週 0回目！ / あと5回」になっていた
		expect(result.cardData).not.toBeNull();
		expect(result.cardData.filledSlots).toBe(5);
		// 押印は無いので instantPoints は 0 のまま。代わりにログインボーナス額を出す
		expect(result.instantPoints).toBe(0);
		expect(result.loginBonusPoints).toBe(3);
		expect(result.loginBonusRank).toBe('吉');
	});

	it('押印できた日はおみくじボーナス額も返す (表示額 = stamp_instant + login_bonus)', async () => {
		mockClaimLoginBonus.mockResolvedValue({
			rank: '大吉',
			basePoints: 5,
			totalPoints: 10,
			multiplier: 2,
			consecutiveLoginDays: 7,
			message: '大吉！10ポイントゲット！',
		});
		mockStampToday.mockResolvedValue({
			stamp: { rarity: 'R', name: 'ほし', omikujiRank: '大吉' },
			instantPoints: 5,
			cardData: { filledSlots: 2, totalSlots: 5, entries: [] },
		});

		const result = await actions.loginStamp(event);

		expect(result.cardFull).toBe(false);
		expect(result.instantPoints).toBe(5);
		expect(result.loginBonusPoints).toBe(10);
		expect(result.loginBonusRank).toBe('大吉');
		// CARD_FULL でない日は card 再読込を行わない (無駄なクエリを増やさない)
		expect(mockGetStampCardStatus).not.toHaveBeenCalled();
	});
});
