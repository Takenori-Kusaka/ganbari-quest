// tests/unit/routes/child-home-must-bonus-jst.test.ts
// #4020 AC3 — 「今日のおやくそく」全達成ボーナスの JST 窓を閉じる。
//
// ## なぜ service 単体ではなくこの層で固定するか
//
// `tryGrantMustCompletionBonus(childId, today, uiMode, tenantId)` は **`today` を引数で
// 受け取るだけ**で、内部に TZ 依存を 1 つも持たない (`activity-service.ts:444-491`)。
// つまり #4020 の欠陥は 100% **呼び出し側** (`home/+page.server.ts`) にあり、service の
// unit test を何本足しても窓は閉じない。ここでは実際に `load` を呼び、
// **load → service → repo に渡る日付が JST の当日であること**を通しで固定する。
//
// ## 何が壊れていたか (顧客影響)
//
// 旧実装は `home/+page.server.ts` 内のローカル `todayDate()` が `new Date()` の
// **ローカル日付要素**で「今日」を組んでいた。本番 Lambda は TZ 未設定 (= UTC) のため、
// **UTC 15:00〜24:00 = JST 翌日 00:00〜09:00 の 9 時間**は前日を「今日」と見なす。
// 一方、活動記録の書き込み (`activity_logs.recorded_date`) は JST 固定なので、
// その時間帯は `logged=0 / total=N` となり **allComplete が成立せず、全達成ボーナスが
// 付与も演出もされない**。朝の支度を記録する子供がまさにこの時間帯に当たる。
//
// ## 検証の作り方 (規則に従うデータだけを並べない)
//
// - repo 層 (`$lib/server/db/activity-repo`) を**日付キーの fake** に差し替える。
//   fake は実 backend の述語をそのまま写す:
//     - `findMustActivitiesWithToday` = `recorded_date = today AND cancelled = 0`
//       (`sqlite/activity-repo.ts:294-303` / dsql 同義)
//     - `insertPointLedger` の `recorded_date` = `todayDateJST()`
//       (`dsql/point-write.ts:71` — 本番 backend の実装そのもの)
//     - `countPointLedgerEntriesByTypeAndDate` = `recorded_date = date`
//       (`dsql/activity-repo.ts:513-519`)
// - service (`tryGrantMustCompletionBonus`) と SUT (`load`) は**実物**を使う。
// - fixture は **JST 当日 (07-27) にだけ記録がある**状態。UTC 側の日付 (07-26) では
//   `logged=0` になる。この非対称が無いと test は空振りするので、[B2] で fixture 自身が
//   2 つの日付を区別することを直接 assert する。
//
// ## TZ 固定の規約 (#4020 AC2 / #4003 AC1''')
//
// - `process.env.TZ = 'UTC'` を beforeEach/afterEach で出し入れする。
// - sentinel は `getTimezoneOffset()` で取る。**`expect(process.env.TZ).toBe('UTC')` は
//   使わない** — `TZ=JST-9` のように env には載るが実効値が違う反例があるため。
// - シェルの `TZ=... npm test` prefix には依存しない (Git Bash / MSYS で env が落ちる)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayDateJST } from '$lib/domain/date-utils';
import { asActivityId, asChildId } from '$lib/domain/ids';

// ------------------------------------------------------------------
// fixture: JST 2026-07-27 (月) の朝に must 活動 2 件を両方記録した子供
// ------------------------------------------------------------------

const CHILD_ID = 1;
const MUST_ACTIVITIES = [
	{ id: 101, name: 'はみがき', icon: '🪥' },
	{ id: 102, name: 'おきがえ', icon: '👕' },
];
/** activity_logs 相当。recorded_date は書き込み側 (JST 固定) が入れた値。 */
const ACTIVITY_LOGS = [
	{ activityId: 101, recordedDate: '2026-07-27', cancelled: 0 },
	{ activityId: 102, recordedDate: '2026-07-27', cancelled: 0 },
];

interface LedgerRow {
	childId: string;
	type: string;
	amount: number;
	description: string | null;
	recordedDate: string;
}
let ledger: LedgerRow[] = [];

/** `findMustActivitiesWithToday` の述語をそのまま写した fake。 */
const findMustActivitiesWithToday = vi.fn(async (_childId: unknown, today: string) => {
	const loggedSet = new Set(
		ACTIVITY_LOGS.filter((l) => l.recordedDate === today && l.cancelled === 0).map(
			(l) => l.activityId,
		),
	);
	const activities = MUST_ACTIVITIES.map((a) => ({
		id: asActivityId(a.id),
		name: a.name,
		icon: a.icon,
		loggedToday: loggedSet.has(a.id) ? 1 : 0,
	}));
	return {
		logged: activities.filter((a) => a.loggedToday === 1).length,
		total: activities.length,
		activities,
	};
});

const countPointLedgerEntriesByTypeAndDate = vi.fn(
	async (childId: unknown, type: string, date: string) =>
		ledger.filter(
			(e) => e.childId === String(childId) && e.type === type && e.recordedDate === date,
		).length,
);

const insertPointLedger = vi.fn(
	async (input: {
		childId: unknown;
		amount: number;
		type: string;
		description?: string | null;
	}) => {
		// dsql/point-write.ts:71 — recorded_date は entity 未公開のため JST 今日で導出する。
		ledger.push({
			childId: String(input.childId),
			type: input.type,
			amount: input.amount,
			description: input.description ?? null,
			recordedDate: todayDateJST(),
		});
	},
);

vi.mock('$lib/server/db/activity-repo', () => ({
	findMustActivitiesWithToday: (...args: [unknown, string, string]) =>
		findMustActivitiesWithToday(args[0], args[1]),
	countPointLedgerEntriesByTypeAndDate: (...args: [unknown, string, string, string]) =>
		countPointLedgerEntriesByTypeAndDate(args[0], args[1], args[2]),
	insertPointLedger: (...args: [Parameters<typeof insertPointLedger>[0], string]) =>
		insertPointLedger(args[0]),
	getActivityLogCounts: vi.fn(),
	hasActivityLogs: vi.fn(),
	deleteDailyMissionsByActivity: vi.fn(),
}));

// ------------------------------------------------------------------
// 周辺 service は「日付の意味論に関与しない」ので最小 stub に落とす。
// ただし日付を受け取る 2 本 (checklist / recommendation) は spy として残し、
// #4020 AC1 の 3 呼び出しすべてが同じ JST 当日を見ることを [B5] で確認する。
// ------------------------------------------------------------------

const getChecklistsForChild = vi.fn(
	async (_childId: unknown, _today: string, _tenantId: string) => [],
);
const selectRecommendations = vi.fn((_activities: unknown, _today: string) => []);

vi.mock('$lib/server/auth/factory', () => ({ requireTenantId: () => 'test-tenant' }));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/server/services/activity-log-service', () => ({
	getTodayRecordedActivityCounts: vi.fn(async () => []),
	hasAnyActivityRecords: vi.fn(async () => true),
	cancelActivityLog: vi.fn(),
	recordActivity: vi.fn(),
}));
vi.mock('$lib/server/services/activity-pin-service', () => ({
	sortActivitiesWithPreferences: vi.fn(async () => []),
	toggleActivityPin: vi.fn(),
}));
// activity-service は **部分 mock**。tryGrantMustCompletionBonus は実物を使い、
// DB を引く getChildActivities だけ差し替える。
vi.mock('$lib/server/services/activity-service', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/services/activity-service')>();
	return { ...actual, getChildActivities: vi.fn(async () => []) };
});
vi.mock('$lib/server/services/birthday-bonus-service', () => ({
	getBirthdayBonusStatus: vi.fn(async () => ({ eligible: false })),
	claimBirthdayBonus: vi.fn(),
}));
vi.mock('$lib/server/services/checklist-service', () => ({
	getChecklistsForChild: (...args: [unknown, string, string]) => getChecklistsForChild(...args),
}));
vi.mock('$lib/server/services/child-challenge-service', () => ({
	getOrCreateWeeklyChildChallenge: vi.fn(async () => undefined),
	getActiveChildChallengesWithSiblings: vi.fn(async () => []),
	claimChildChallengeReward: vi.fn(),
	// #4410: load が祝福対象の解決に使う。実物と同じ「該当なしなら null」を返す
	resolveCelebrationChallenge: vi.fn(() => null),
	markChallengeCelebrationShown: vi.fn(async () => true),
}));
vi.mock('$lib/server/services/daily-mission-service', () => ({
	getTodayMissions: vi.fn(async () => null),
}));
vi.mock('$lib/server/services/family-streak-service', () => ({
	getFamilyStreak: vi.fn(async () => null),
	getNextMilestone: vi.fn(() => null),
}));
vi.mock('$lib/server/services/login-bonus-service', () => ({
	getLoginBonusStatus: vi.fn(async () => ({ claimedToday: false })),
	claimLoginBonus: vi.fn(),
}));
vi.mock('$lib/server/services/message-service', () => ({
	getUnshownMessage: vi.fn(async () => null),
}));
vi.mock('$lib/server/services/recommendation-service', () => ({
	selectRecommendations: (...args: [unknown, string]) => selectRecommendations(...args),
}));
vi.mock('$lib/server/services/sibling-cheer-service', () => ({
	getUnshownCheers: vi.fn(async () => []),
	markCheersShown: vi.fn(),
	sendCheer: vi.fn(),
}));
vi.mock('$lib/server/services/sibling-ranking-service', () => ({
	getWeeklyRanking: vi.fn(async () => null),
	isRankingEnabled: vi.fn(async () => false),
}));
vi.mock('$lib/server/services/special-reward-service', () => ({
	getUnshownReward: vi.fn(async () => null),
}));
vi.mock('$lib/server/services/stamp-card-service', () => ({
	getStampCardStatus: vi.fn(async () => null),
	autoRedeemPreviousWeek: vi.fn(),
	redeemStampCard: vi.fn(),
	stampToday: vi.fn(),
}));
vi.mock('$lib/server/services/status-service', () => ({
	getCategoryXpSummary: vi.fn(async () => null),
}));

// 実装側の定数をそのまま使う (test 側で文字列を直書きすると type 名変更に silent に追従する)。
import { MUST_COMPLETION_BONUS_TYPE } from '../../../src/lib/server/services/activity-service';
import { load } from '../../../src/routes/(child)/[uiMode=uiMode]/home/+page.server';

const ORIGINAL_TZ = process.env.TZ;

/** 指定 UTC 時刻に固定する。TZ の影響を受けない ISO 文字列で与える。 */
function freezeUtc(iso: string): void {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(iso));
}

/** `load` を PageServerLoad の最小 event で呼ぶ。 */
// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LoadEvent 全体は本 test の関心外
async function runLoad(uiMode = 'preschool'): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: 同上
	return await (load as any)({
		locals: {},
		parent: async () => ({
			child: { id: asChildId(CHILD_ID), age: 5 },
			uiMode,
			planLimits: { canSiblingRanking: false },
		}),
	});
}

beforeEach(() => {
	// 本番 Lambda と CI runner の条件 (TZ 未設定 = UTC) を再現する。
	process.env.TZ = 'UTC';
	ledger = [];
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
	process.env.TZ = ORIGINAL_TZ;
});

describe('#4020 AC3 — 全達成ボーナスは JST の当日で判定される', () => {
	it('[B0] sentinel: この test は実効 UTC で走っている', () => {
		// env 文字列ではなく Date の実挙動で確認する (#4020 AC2 規約)。
		expect(new Date('2026-07-26T21:00:00Z').getTimezoneOffset()).toBe(0);
	});

	it('[B2] 対照: fixture は 07-26 と 07-27 を区別する (この test が空振りでないこと)', async () => {
		// UTC 側の日付では 1 件も logged にならない = 旧実装が見ていた世界。
		const utcSide = await findMustActivitiesWithToday(asChildId(CHILD_ID), '2026-07-26');
		expect(utcSide.logged).toBe(0);
		expect(utcSide.total).toBe(2);
		// JST 側の日付では全達成。
		const jstSide = await findMustActivitiesWithToday(asChildId(CHILD_ID), '2026-07-27');
		expect(jstSide.logged).toBe(2);
		expect(jstSide.total).toBe(2);
	});

	// **ここが #4020 の顧客被害そのもの。** 旧実装ではこの時刻で logged=0 になり、
	// ボーナスが付与も演出もされなかった。
	it('[B1] UTC 日曜 15:00 (JST 月曜 00:00) — 当日で集計し、ボーナスが付与される', async () => {
		freezeUtc('2026-07-26T15:00:00Z');

		const data = await runLoad();

		// load → service に渡った日付が JST の当日であること
		expect(findMustActivitiesWithToday).toHaveBeenCalledWith(expect.anything(), '2026-07-27');
		expect(findMustActivitiesWithToday).not.toHaveBeenCalledWith(expect.anything(), '2026-07-26');

		// 顧客に見える結果: 全達成 → 付与 (preschool = 5pt)
		expect(data.mustStatus).not.toBeNull();
		expect(data.mustStatus.total).toBe(2);
		expect(data.mustStatus.logged).toBe(2);
		expect(data.mustStatus.allComplete).toBe(true);
		expect(data.mustStatus.granted).toBe(true);
		expect(data.mustStatus.points).toBe(5);

		// point_ledger に当日の 1 行が入っていること
		expect(ledger).toHaveLength(1);
		const [row] = ledger;
		if (!row) throw new Error('point_ledger に行が入っていない');
		expect(row.type).toBe(MUST_COMPLETION_BONUS_TYPE);
		expect(row.amount).toBe(5);
		expect(row.recordedDate).toBe('2026-07-27');
		expect(row.description).toContain('2026-07-27');
	});

	it('[B3] 窓の内側で 2 回 load しても付与は 1 回だけ (冪等 / 演出 1 回限り)', async () => {
		freezeUtc('2026-07-26T15:00:00Z');

		const first = await runLoad();
		expect(first.mustStatus.granted).toBe(true);

		const second = await runLoad();
		expect(second.mustStatus.allComplete).toBe(true);
		expect(second.mustStatus.granted).toBe(false);
		expect(second.mustStatus.points).toBe(0);

		expect(ledger).toHaveLength(1);
	});

	it('[B4] 窓の終端 UTC 23:59 (JST 08:59) でも同じ当日を見る', async () => {
		freezeUtc('2026-07-26T23:59:00Z');

		const data = await runLoad();

		expect(findMustActivitiesWithToday).toHaveBeenCalledWith(expect.anything(), '2026-07-27');
		expect(data.mustStatus.granted).toBe(true);
	});

	it('[B4b] 窓を抜けた UTC 月曜 00:00 (JST 09:00) でも当日は変わらない', async () => {
		freezeUtc('2026-07-27T00:00:00Z');

		const data = await runLoad();

		expect(findMustActivitiesWithToday).toHaveBeenCalledWith(expect.anything(), '2026-07-27');
		expect(data.mustStatus.granted).toBe(true);
	});

	// #4020 AC1 は「呼び出し 3 箇所すべてが JST を見る」ことを求めている。
	// ボーナス経路以外の 2 本も同じ日付であることをここで固定する。
	it('[B5] checklist / おすすめ活動も同じ JST 当日を受け取る (#4020 AC1 の 3 呼び出し)', async () => {
		freezeUtc('2026-07-26T15:00:00Z');

		await runLoad();

		expect(getChecklistsForChild).toHaveBeenCalledWith(
			expect.anything(),
			'2026-07-27',
			'test-tenant',
		);
		expect(selectRecommendations).toHaveBeenCalledWith(expect.anything(), '2026-07-27');
	});

	it('[B6] baby は全達成でもボーナス対象外 (ADR-0011) — 早期 return で mustStatus=null', async () => {
		freezeUtc('2026-07-26T15:00:00Z');

		const data = await runLoad('baby');

		expect(data.mustStatus).toBeNull();
		expect(ledger).toHaveLength(0);
	});
});
