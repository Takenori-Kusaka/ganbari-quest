// tests/unit/routes/child-history-retention.test.ts
// #4688 follow-up — 「記録」画面の 4 タブがプラン別履歴保持期間 (ADR-0049) を通ること。
//
// ## 何が壊れていたか (顧客影響)
//
// #4763 が達成タブのデータ源を `getActiveChildChallengesWithSiblings` から
// `getChildChallengeRecords` (= 全履歴を引く) に差し替えた際、`load` 側で計算済みの
// 保持期間フィルタ (`applyRetentionFilter`) を**渡し忘れた**。さらに同じ `load` の中で
// 交換タブ (`getRedemptionRequestsForChild`) は**元から**保持期間を受け取っていなかった。
// 結果、無料プラン (90 日) でも達成タブ / 交換タブだけ全期間の履歴が見えており、
// 料金表が約束する保持期間 (ADR-0049 / ADR-0013 LP truth) が空洞化していた。
//
// ## 4 タブの扱い (どれを絞り、どれを絞らないか)
//
// | タブ | データ源 | 保持期間 |
// |---|---|---|
// | 活動 | `activity_logs` (event 行) | 期間タブ + 保持期間 |
// | 達成 | `child_challenges` (event 行) | 保持期間のみ |
// | 交換 | `reward_redemption_requests` (event 行、ADR-0049 拡張 P0) | 保持期間のみ |
// | 記念 | `MILESTONES` 定義から導出する**集計値** | **適用しない** (ADR-0049 §6) |
//
// 記念タブだけ絞らないのは実装漏れではなく決定である。[D1] がその決定を固定する。
//
// ## なぜ service 単体ではなくこの層で固定するか
//
// 欠陥は service の内部ではなく**呼び出し側の配線** (`load` が filter を渡していない) に
// あった。service の unit test を何本足しても、`load` が引数を落とせば穴は再発する。
// ここでは実際に `load` を呼び、**load → applyRetentionFilter → service → repo に渡る
// cutoff** を通しで固定する (`child-home-must-bonus-jst.test.ts` #4020 と同じ理由・同じ作り)。
//
// ## 検証の作り方
//
// - repo 層 (`getRepos()`) だけ fake に差し替え、service と `applyRetentionFilter` は
//   **実物**を使う (保持期間の算術を test 側に写さない)。
// - 期待する cutoff は SUT を経由せず**固定文字列**で置く (#4051 規約)。
//   固定時計 2026-08-26 JST / free = 90 日 → cutoff = 2026-05-28。
// - fixture には cutoff の外・内・境界を並べ、[A0] / [C0] で fixture 自身がそれらを
//   区別することを直接 assert する (test が空振りでないこと)。

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

// ------------------------------------------------------------------
// fixture: チャレンジ (達成タブ)
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// fixture: ごほうび交換申請 (交換タブ)
//
// `requestedAt` は **epoch 秒** (書き込みは reward-redemption-service の
// `Math.floor(Date.now() / 1000)`)。ms として `new Date()` に渡すと 1970-01-xx になり、
// cutoff 比較で全件が古い判定 = 履歴が丸ごと消える (#4688)。保持期間の cutoff は
// JST 暦日なので、実装は秒 → JST 暦日 に直してから比較する。[C4] がその境界を突く。
// ------------------------------------------------------------------

interface PurchaseSeed {
	id: string;
	/** UTC の ISO 文字列。JST 暦日との対応をコメントで併記する。 */
	requestedAtIso: string;
}

function purchase(seed: PurchaseSeed) {
	return {
		id: seed.id,
		childId: asChildId(CHILD_ID),
		rewardId: `reward-${seed.id}`,
		quantity: 1,
		status: 'approved',
		requestedAt: Math.floor(Date.parse(seed.requestedAtIso) / 1000),
		resolvedAt: Math.floor(Date.parse(seed.requestedAtIso) / 1000),
		parentNote: null,
		resolvedByParentId: null,
		shownToChildAt: null,
		rewardTitle: 'アイス',
		rewardPoints: 100,
		rewardIcon: '🍦',
	};
}

const PURCHASES = [
	// JST 2026-04-10 12:00 — cutoff より前
	purchase({ id: 'p-old', requestedAtIso: '2026-04-10T03:00:00Z' }),
	// JST 2026-05-28 00:30 — cutoff 当日の JST 未明 (UTC では前日 05-27)
	purchase({ id: 'p-cutoff-jst-dawn', requestedAtIso: '2026-05-27T15:30:00Z' }),
	// JST 2026-08-20 12:00 — 保持期間内
	purchase({ id: 'p-recent', requestedAtIso: '2026-08-20T03:00:00Z' }),
];

// ------------------------------------------------------------------
// repo 層 fake (service と applyRetentionFilter は実物を使う)
// ------------------------------------------------------------------

const findByChildId = vi.fn(async (_childId: unknown, _tenantId: string) => ROWS);
const findRedemptionRequestsByChild = vi.fn(async (_childId: unknown, _tenantId: string) =>
	PURCHASES.map((p) => ({ ...p })),
);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: { findByChildId: (...a: [unknown, string]) => findByChildId(...a) },
		rewardRedemption: {
			findRedemptionRequestsByChild: (...a: [unknown, string]) =>
				findRedemptionRequestsByChild(...a),
		},
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

// 活動タブは本 test の関心外 (既に保持期間を通っている)。渡された range だけ記録する。
const getActivityLogs = vi.fn(
	async (_c: unknown, _t: string, options: { from?: string; to?: string }) => ({
		logs: [],
		summary: { totalCount: 0, totalPoints: 0, byCategory: {} },
		options,
	}),
);
vi.mock('$lib/server/services/activity-log-service', () => ({
	getActivityLogs: (...a: [unknown, string, { from?: string; to?: string }]) =>
		getActivityLogs(...a),
}));

// 記念タブ = 集計値。**保持期間を適用しない**ことを [D1] で固定するため、cutoff より
// 古い achievedAt を持つマイルストーンを返す。
const getTenantValuePreview = vi.fn(async () => ({
	children: [
		{
			childId: asChildId(CHILD_ID),
			milestones: [
				{ id: 'first_record', threshold: 1, achieved: true, achievedAt: '2026-01-15' },
				{ id: 'streak_7', threshold: 7, achieved: true, achievedAt: '2026-08-01' },
				{ id: 'streak_30', threshold: 30, achieved: false, achievedAt: null },
			],
		},
	],
}));
vi.mock('$lib/server/services/value-preview-service', () => ({
	getTenantValuePreview: () => getTenantValuePreview(),
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

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(FIXED_NOW));
	vi.clearAllMocks();
	findByChildId.mockResolvedValue(ROWS);
	findRedemptionRequestsByChild.mockResolvedValue(PURCHASES.map((p) => ({ ...p })));
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
		expect(idsOf(data.achievements)).not.toContain('out-of-retention');
	});

	it('[A2] 無料プラン: cutoff をまたぐ期間のチャレンジは残る (境界で切り過ぎない)', async () => {
		const data = await runLoad();
		expect(idsOf(data.achievements)).toContain('spans-cutoff');
	});

	it('[A3] #4688 F1 の保証は維持: 受取済み (rewardClaimed) でも消えない', async () => {
		const data = await runLoad();
		expect(idsOf(data.achievements)).toContain('claimed-recent');
	});

	it('[A4] family プラン (保持無期限) では保持期間で切らない', async () => {
		resolveFullPlanTier.mockResolvedValue('family');
		const data = await runLoad();
		expect(idsOf(data.achievements)).toContain('out-of-retention');
	});

	it('[A5] 期間タブ (week/month) は達成タブを狭めない — 保持期間だけが効く', async () => {
		// 既定 period=week (直近 7 日) でも、7 日より前の達成が消えてはいけない。
		// 期間タブは活動タブ専用の UI (history/+page.svelte で activities パネル内にのみ描画される)。
		const data = await runLoad('?kind=achievements&period=week');
		expect(idsOf(data.achievements)).toContain('spans-cutoff');
		// 一方、活動タブ側は従来どおり期間 + 保持期間の両方で絞られる
		expect(getActivityLogs.mock.calls[0]?.[2]).toEqual({ from: '2026-08-19', to: '2026-08-26' });
	});
});

describe('#4688 follow-up — 達成タブの意味論', () => {
	it('[B1] 期間が終わった未達成チャレンジは「がんばってるよ」として出さない', async () => {
		const data = await runLoad();
		expect(idsOf(data.achievements)).not.toContain('expired-incomplete');
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

// ============================================================
// 交換タブ (#4818 same-class 残存)
//
// 達成タブと**同じ load の中で**、交換履歴だけが保持期間を受け取っていなかった。
// `reward_redemption_requests` は ADR-0049 拡張表で P0 (深刻度「高」) の削除対象。
// ============================================================

describe('#4688 follow-up — 交換タブは保持期間 (ADR-0049) を通る', () => {
	it('[C0] 対照: fixture は cutoff の外/境界/内を区別する (この test が空振りでないこと)', () => {
		// JST 暦日に直したときの日付。UTC 日付で判定すると p-cutoff-jst-dawn が 05-27 になり、
		// cutoff (05-28) の外に落ちる = [C4] が突く境界。
		const jstDate = (iso: string) =>
			new Intl.DateTimeFormat('en-CA', {
				timeZone: 'Asia/Tokyo',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			}).format(new Date(iso));

		expect(jstDate('2026-04-10T03:00:00Z') < FREE_CUTOFF).toBe(true);
		expect(jstDate('2026-05-27T15:30:00Z')).toBe(FREE_CUTOFF);
		expect(jstDate('2026-08-20T03:00:00Z') > FREE_CUTOFF).toBe(true);
	});

	// **ここが同 class の残存。** 無料プランで交換履歴だけ全期間見えていた。
	it('[C1] 無料プラン: 保持期間より前の交換履歴は交換タブに出ない', async () => {
		const data = await runLoad();
		expect(idsOf(data.purchases)).not.toContain('p-old');
	});

	it('[C2] 無料プラン: 保持期間内の交換履歴は残る (切り過ぎない)', async () => {
		const data = await runLoad();
		expect(idsOf(data.purchases)).toContain('p-recent');
	});

	it('[C3] family プラン (保持無期限) では保持期間で切らない', async () => {
		resolveFullPlanTier.mockResolvedValue('family');
		const data = await runLoad();
		expect(idsOf(data.purchases)).toContain('p-old');
	});

	// requestedAt は epoch 秒。JST 暦日に直さず UTC 日付で比較すると、
	// **JST 00:00〜09:00 に交換した申請が 1 日前扱いになり cutoff 当日分が消える** (#4015 の同 class)。
	it('[C4] cutoff 当日の JST 未明 (UTC では前日) の交換履歴も残る', async () => {
		const data = await runLoad();
		expect(idsOf(data.purchases)).toContain('p-cutoff-jst-dawn');
	});
});

// ============================================================
// 記念タブ = 集計値なので保持期間を適用しない (ADR-0049 §6)
//
// これは実装漏れではなく決定である。「4 タブのうち 3 つだけ絞る」ことを
// 後から見た人が漏れと誤認して塞ぎに来ないよう、決定側を test で固定する。
// ============================================================

describe('#4688 follow-up — 記念タブは集計値なので保持期間で切らない', () => {
	it('[D1] 無料プランでも cutoff より古い達成日のマイルストーンが残る', async () => {
		const data = await runLoad();
		const ids = idsOf(data.milestones);
		// achievedAt = 2026-01-15 は cutoff (2026-05-28) より前だが、集計値なので消さない
		expect(ids).toContain('first_record');
		expect(ids).toContain('streak_7');
	});

	it('[D2] 未達成のマイルストーンは出さない (従来どおり)', async () => {
		const data = await runLoad();
		expect(idsOf(data.milestones)).not.toContain('streak_30');
	});
});

// ============================================================
// 配線の同型性 — 同じ load の中で保持期間の渡し方がタブごとに割れないこと
// ============================================================

describe('#4688 follow-up — 保持期間の渡し方が 3 タブで揃っている', () => {
	it('[E1] 活動 / 達成 / 交換 の 3 タブがいずれも同じ cutoff を受け取る', async () => {
		await runLoad('?period=month');

		// 活動タブは期間 + 保持期間。period=month の from (07-27) は cutoff (05-28) より後なので
		// 期間側が勝つ。達成 / 交換は期間タブを持たないので cutoff そのもの。
		expect(getActivityLogs.mock.calls[0]?.[2]).toEqual({ from: '2026-07-27', to: '2026-08-26' });

		// 達成 / 交換に渡る cutoff は同一であること (片方だけ渡し忘れ / 別方式にしない)。
		const data = await runLoad('?period=month');
		expect(idsOf(data.achievements)).not.toContain('out-of-retention');
		expect(idsOf(data.purchases)).not.toContain('p-old');
	});
});
