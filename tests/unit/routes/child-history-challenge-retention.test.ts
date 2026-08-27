// tests/unit/routes/child-history-challenge-retention.test.ts
// #4688 follow-up — 「記録 > 達成」タブがプラン別履歴保持期間 (ADR-0049) を通ること。
//
// ## 何が壊れていたか (顧客影響)
//
// #4763 が達成タブのデータ源を `getActiveChildChallengesWithSiblings` から
// `getChildChallengeRecords` (= 全履歴を引く) に差し替えた際、`load` 側で計算済みの
// 保持期間フィルタ (`applyRetentionFilter`) を**渡し忘れた**。結果、無料プラン (90 日) でも
// **達成タブだけ全期間のチャレンジ履歴が見えていた**。同じ画面の活動タブは 90 日で切られる
// ので、料金表が約束する保持期間 (ADR-0049 / ADR-0013 LP truth) が達成タブで空洞化していた。
//
// ## なぜ service 単体ではなくこの層で固定するか
//
// 欠陥は service の内部ではなく**呼び出し側の配線** (`history/+page.server.ts` が
// filter を渡していない) にあった。service の unit test を何本足しても、`load` が引数を
// 落とせば穴は再発する。ここでは実際に `load` を呼び、
// **load → applyRetentionFilter → service → repo に渡る cutoff** を通しで固定する
// (`child-home-must-bonus-jst.test.ts` #4020 と同じ理由・同じ作り)。
//
// ## 検証の作り方
//
// - repo 層 (`childChallenge.findByChildId`) だけ fake に差し替え、service と
//   `applyRetentionFilter` は**実物**を使う (保持期間の算術を test 側に写さない)。
// - 期待する cutoff は SUT を経由せず**固定文字列**で置く (#4051 規約)。
//   固定時計 2026-08-26 JST / free = 90 日 → cutoff = 2026-05-28。
// - fixture には cutoff の外・内・境界をまたぐ 3 種を並べ、[A0] で fixture 自身が
//   その 3 種を区別することを直接 assert する (test が空振りでないこと)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

// ------------------------------------------------------------------
// 固定値 (SUT を通さない)
// ------------------------------------------------------------------

/** JST 2026-08-26 (水) 12:00 に固定する瞬間。 */
const FIXED_NOW = '2026-08-26T03:00:00Z';
/** 無料プラン = 90 日保持。2026-08-26 の 90 日前。SUT (addDaysJST) を経由しない固定値。 */
const FREE_CUTOFF = '2026-05-28';

const CHILD_ID = 902;
const TENANT = 'test-tenant';

interface ChallengeRow {
	id: string;
	startDate: string;
	endDate: string;
	completed: 0 | 1;
	rewardClaimed: 0 | 1;
}

/** repo が返す行 (test の関心のある列だけ可変、残りは固定)。 */
function row(over: ChallengeRow) {
	return {
		childId: asChildId(CHILD_ID),
		title: `チャレンジ ${over.id}`,
		challengeType: 'cooperative',
		periodType: 'weekly',
		targetConfig: '{"metric":"count","categoryId":1,"baseTarget":3}',
		rewardConfig: '{"points":30}',
		status: over.completed === 1 ? 'completed' : 'active',
		isActive: 1,
		currentValue: over.completed === 1 ? 3 : 1,
		targetValue: 3,
		completedAt: over.completed === 1 ? over.endDate : null,
		rewardClaimedAt: over.rewardClaimed === 1 ? over.endDate : null,
		celebrationShownAt: null,
		description: null,
		sourceTemplateId: null,
		createdAt: '',
		updatedAt: '',
		...over,
	};
}

/**
 * 保持期間の境界をまたぐ fixture。
 *
 * - `out-of-retention` は **cutoff (2026-05-28) より前に期間が終わっている** = 見えてはいけない
 * - `spans-cutoff` は cutoff をまたぐ = 期間の一部が保持内なので見える
 * - `expired-incomplete` は保持内だが**期間が終わった未達成** = 達成タブの意味論外
 */
const ROWS = [
	row({
		id: 'out-of-retention',
		startDate: '2026-04-06',
		endDate: '2026-04-12',
		completed: 1,
		rewardClaimed: 1,
	}),
	row({
		id: 'spans-cutoff',
		startDate: '2026-05-25',
		endDate: '2026-05-31',
		completed: 1,
		rewardClaimed: 1,
	}),
	row({
		id: 'expired-incomplete',
		startDate: '2026-07-06',
		endDate: '2026-07-12',
		completed: 0,
		rewardClaimed: 0,
	}),
	row({
		id: 'claimed-recent',
		startDate: '2026-08-17',
		endDate: '2026-08-23',
		completed: 1,
		rewardClaimed: 1,
	}),
	row({
		id: 'ongoing',
		startDate: '2026-08-24',
		endDate: '2026-08-30',
		completed: 0,
		rewardClaimed: 0,
	}),
];

/** fixture 行を id で引く (見つからなければ test を落とす)。 */
function fixture(id: string) {
	const found = ROWS.find((r) => r.id === id);
	if (!found) throw new Error(`fixture row not found: ${id}`);
	return found;
}

const findByChildId = vi.fn(async (_childId: unknown, _tenantId: string) => ROWS);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: { findByChildId: (...a: [unknown, string]) => findByChildId(...a) },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({ requireTenantId: () => TENANT }));

// plan-limit-service は **部分 mock**。`applyRetentionFilter` / `getHistoryCutoffDate` は
// 実物を使い (保持期間の算術こそ検証対象)、DB を引く `resolveFullPlanTier` だけ差し替える。
const resolveFullPlanTier = vi.fn(async () => 'free');
vi.mock('$lib/server/services/plan-limit-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/services/plan-limit-service')>()),
	resolveFullPlanTier: () => resolveFullPlanTier(),
}));

// 達成タブ以外の 3 タブは本 test の関心外。呼ばれた引数だけ記録する。
const getActivityLogs = vi.fn(
	async (_c: unknown, _t: string, options: { from?: string; to?: string } = {}) => ({
		logs: [],
		summary: { totalCount: 0, totalPoints: 0, byCategory: {} },
		options,
	}),
);
vi.mock('$lib/server/services/activity-log-service', () => ({
	getActivityLogs: (...a: [unknown, string, { from?: string; to?: string }]) =>
		getActivityLogs(...a),
}));
vi.mock('$lib/server/services/reward-redemption-service', () => ({
	getRedemptionRequestsForChild: vi.fn(async () => []),
}));
vi.mock('$lib/server/services/value-preview-service', () => ({
	getTenantValuePreview: vi.fn(async () => ({ children: [] })),
}));

import { load } from '../../../src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.server';

/** `load` を PageServerLoad の最小 event で呼ぶ。 */
// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LoadEvent 全体は本 test の関心外
async function runLoad(search = ''): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: 同上
	return await (load as any)({
		locals: { context: { licenseStatus: 'none', plan: null } },
		url: new URL(`http://localhost/elementary/history${search}`),
		parent: async () => ({ child: { id: asChildId(CHILD_ID), age: 8 } }),
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(FIXED_NOW));
	vi.clearAllMocks();
	findByChildId.mockResolvedValue(ROWS);
	resolveFullPlanTier.mockResolvedValue('free');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('#4688 follow-up — 達成タブは保持期間 (ADR-0049) を通る', () => {
	it('[A0] 対照: fixture は cutoff の外/境界/内を区別する (この test が空振りでないこと)', () => {
		// cutoff より前に終わった / cutoff をまたぐ / cutoff より後
		expect(fixture('out-of-retention').endDate < FREE_CUTOFF).toBe(true);
		expect(fixture('spans-cutoff').startDate < FREE_CUTOFF).toBe(true);
		expect(fixture('spans-cutoff').endDate >= FREE_CUTOFF).toBe(true);
		expect(fixture('claimed-recent').endDate > FREE_CUTOFF).toBe(true);
	});

	// **ここが顧客被害そのもの。** 旧実装は無料プランでも全期間を返していた。
	it('[A1] 無料プラン: 保持期間より前に終わったチャレンジは達成タブに出ない', async () => {
		const data = await runLoad();
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).not.toContain('out-of-retention');
	});

	it('[A2] 無料プラン: cutoff をまたぐ期間のチャレンジは残る (境界で切り過ぎない)', async () => {
		const data = await runLoad();
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).toContain('spans-cutoff');
	});

	it('[A3] #4688 F1 の保証は維持: 受取済み (rewardClaimed) でも消えない', async () => {
		const data = await runLoad();
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).toContain('claimed-recent');
	});

	it('[A4] family プラン (保持無期限) では保持期間で切らない', async () => {
		resolveFullPlanTier.mockResolvedValue('family');
		const data = await runLoad();
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).toContain('out-of-retention');
	});

	it('[A5] 期間タブ (week/month) は達成タブを狭めない — 保持期間だけが効く', async () => {
		// 既定 period=week (直近 7 日) でも、7 日より前の達成が消えてはいけない。
		// 期間タブは活動タブ専用の UI (history/+page.svelte で activities パネル内にのみ描画される)。
		const data = await runLoad('?kind=achievements&period=week');
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).toContain('spans-cutoff');
		// 一方、活動タブ側は従来どおり期間 + 保持期間の両方で絞られる
		expect(getActivityLogs.mock.calls[0]?.[2]).toEqual({ from: '2026-08-19', to: '2026-08-26' });
	});
});

describe('#4688 follow-up — 達成タブの意味論', () => {
	it('[B1] 期間が終わった未達成チャレンジは「がんばってるよ」として出さない', async () => {
		const data = await runLoad();
		const ids = data.achievements.map((a: { id: string }) => a.id);
		expect(ids).not.toContain('expired-incomplete');
	});

	it('[B2] 期間中の未達成チャレンジは「がんばってるよ」として出す', async () => {
		const data = await runLoad();
		const found = data.achievements.find((a: { id: string }) => a.id === 'ongoing');
		expect(found).toBeDefined();
		expect(found?.completed).toBe(false);
	});

	it('[B3] 保持期間内の達成は件数で無告知に打ち切られない', async () => {
		// standard (365 日) では週次チャレンジが 52 件になりうる。旧実装は limit=30 で
		// 31 件目以降を無告知に捨てていた (顧客には「消えた」としか見えない)。
		resolveFullPlanTier.mockResolvedValue('standard');
		const many = Array.from({ length: 40 }, (_, i) =>
			row({
				id: `w${i}`,
				// 2026-08-24 から 1 週ずつ遡る (全て 365 日保持の内側)
				startDate: `2026-0${i < 24 ? '8' : '7'}-01`,
				endDate: '2026-08-23',
				completed: 1,
				rewardClaimed: 1,
			}),
		);
		findByChildId.mockResolvedValue(many);

		const data = await runLoad();
		expect(data.achievements).toHaveLength(40);
	});
});
