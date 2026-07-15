// tests/unit/services/import-service-concurrency.test.ts
// #3692: 本番 restore 504 (Lambda 30s timeout) の即効対処 — import の件数支配ヘルパ
// (activityLogs / pointLedger / loginBonuses / statusHistory / stampCards) が
// insert を並列チャンク実行することを検証する。
//
// 障害の算数: 実バックアップ ≈ 1,200 行 × 1 insert あたり最大 3 DynamoDB 往復
// (採番 UpdateCommand + denormalize read + PutCommand) ≈ 3,000 逐次往復 × 10-20ms
// = 30-60s > Lambda 30s。並列度 >1 を機械検証し、逐次退行 (30s timeout 再発) を
// unit 層で検出する (ADR-0061 push-down-pyramid: e2e/staging 実測より下層で担保)。
//
// 検証方式: insert mock を deferred にし、同時 in-flight 数の最大値を記録する。
// 逐次実装では常に 1、並列実装では >1 になる。加えて件数・dedup 結果の不変
// (正しさの保存) も同一 test 内で assert する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- 並列度トラッカ ----------

/** insert mock の同時 in-flight 数を記録する deferred tracker。 */
function makeConcurrencyTracker() {
	let inFlight = 0;
	let maxInFlight = 0;
	const tracked = vi.fn(async () => {
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		// timer 1 tick 待つことで、並列実装なら他 worker の insert が同時に in-flight になる
		await new Promise((resolve) => setTimeout(resolve, 1));
		inFlight--;
		return { id: 'inserted' };
	});
	return { tracked, max: () => maxInFlight };
}

const pointLedgerTracker = makeConcurrencyTracker();
const activityLogTracker = makeConcurrencyTracker();
const statusHistoryTracker = makeConcurrencyTracker();
const loginBonusTracker = makeConcurrencyTracker();
const stampEntryTracker = makeConcurrencyTracker();

// ---------- Top-level mocks (import-service.test.ts と同構成の最小 subset) ----------

const mockFindActivities = vi.fn();
const mockFindActivityLogs = vi.fn();
const mockInsertChild = vi.fn();
const mockFindRecentBonuses = vi.fn();
const mockChildActivityFindByChild = vi.fn();
const mockStampInsertCardForRestore = vi.fn();

// pointLedger の insert 実装はテストごとに tracker を差し替えられるよう間接参照にする
// (同一 child 逐次 guard テストが専用 tracker で in-flight を隔離計測するため)。
let pointLedgerImpl: () => Promise<unknown> = () => pointLedgerTracker.tracked();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	findActivityLogs: (...args: unknown[]) => mockFindActivityLogs(...args),
	insertActivity: vi.fn(),
	insertActivityLog: () => activityLogTracker.tracked(),
	insertPointLedger: () => pointLedgerImpl(),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			insertActivity: vi.fn(),
			findActivitiesByChild: (...args: unknown[]) => mockChildActivityFindByChild(...args),
		},
		voice: { insertForRestore: vi.fn() },
		stampCard: {
			insertCardForRestore: (...args: unknown[]) => mockStampInsertCardForRestore(...args),
			insertEntryForRestore: () => stampEntryTracker.tracked(),
		},
		certificate: { insertForRestore: vi.fn() },
		childChallenge: { insertForRestore: vi.fn() },
		message: { insertForRestore: vi.fn() },
		siblingCheer: { insertForRestore: vi.fn() },
		activityPref: { upsertForRestore: vi.fn() },
	}),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	insertChild: (...args: unknown[]) => mockInsertChild(...args),
}));

vi.mock('$lib/server/db/status-repo', () => ({
	upsertStatus: vi.fn(),
	insertStatusHistory: () => statusHistoryTracker.tracked(),
}));

vi.mock('$lib/server/db/achievement-repo', () => ({
	findAllAchievements: vi.fn().mockResolvedValue([]),
	insertChildAchievement: vi.fn(),
}));

vi.mock('$lib/server/db/login-bonus-repo', () => ({
	findRecentBonuses: (...args: unknown[]) => mockFindRecentBonuses(...args),
	insertLoginBonus: () => loginBonusTracker.tracked(),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	insertTemplate: vi.fn(),
	insertTemplateItem: vi.fn(),
	findTemplatesByChild: vi.fn().mockResolvedValue([]),
	assignTemplateToChildren: vi.fn(),
	findLogsByChild: vi.fn().mockResolvedValue([]),
	insertOverrideForRestore: vi.fn(),
	upsertLog: vi.fn(),
}));

vi.mock('$lib/server/db/evaluation-repo', () => ({
	insertEvaluation: vi.fn(),
	insertRestDayForRestore: vi.fn(),
}));

vi.mock('$lib/server/db/reward-redemption-repo', () => ({
	insertRedemptionForRestore: vi.fn(),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	setSetting: vi.fn(),
}));

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: vi.fn().mockResolvedValue([]),
	insertSpecialReward: vi.fn(),
}));

vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(),
	fileExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('$lib/server/db/image-repo', () => ({
	updateChildAvatarUrl: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import type { ExportData } from '../../../src/lib/domain/export-format';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-3692';
const N = 12; // 並列判定に十分な行数 (concurrency > 1 が観測できる最小限より余裕を持つ)

function makeExportData(overrides: Partial<ExportData['data']> = {}): ExportData {
	return {
		format: 'ganbari-quest-backup',
		version: '1.1.0',
		exportedAt: new Date().toISOString(),
		checksum: 'test-checksum',
		master: { categories: [], activities: [], titles: [], achievements: [], avatarItems: [] },
		family: {
			children: [
				{
					exportId: 'child-1',
					nickname: 'テスト太郎',
					age: 8,
					birthDate: '2018-01-15',
					theme: 'blue',
					uiMode: 'elementary',
					avatarUrl: null,
					activeTitle: null,
					createdAt: '2025-06-01T00:00:00Z',
				},
			],
		},
		data: {
			childActivities: [],
			activityLogs: [],
			pointLedger: [],
			statuses: [],
			statusHistory: [],
			childAchievements: [],
			childTitles: [],
			loginBonuses: [],
			evaluations: [],
			specialRewards: [],
			checklistTemplates: [],
			checklistLogs: [],
			childAvatarItems: [],
			dailyMissions: [],
			rewardRedemptions: [],
			settings: [],
			...overrides,
		},
	} as ExportData;
}

beforeEach(() => {
	mockInsertChild.mockReset().mockResolvedValue({ id: '101' });
	mockFindActivities.mockReset().mockResolvedValue([]);
	mockFindActivityLogs.mockReset().mockResolvedValue([]);
	mockFindRecentBonuses.mockReset().mockResolvedValue([]);
	mockChildActivityFindByChild.mockReset().mockResolvedValue([]);
	mockStampInsertCardForRestore.mockReset().mockResolvedValue({ id: 'card-1' });
});

// ============================================================
// #3692: 件数支配ヘルパの insert 並列度 >1 (30s timeout 逐次退行ガード)
// ============================================================

describe('#3692 import insert 並列チャンク実行', () => {
	// #3692 改 (本番 DSQL restore 障害 2026-07-15 の根治):
	// point 書込プリミティブは「ledger INSERT + 同一 children 行 total_point UPDATE」を 1 txn で
	// 行うため、同一 child の entry を並列化すると DSQL (OCC) で commit 時 40001 衝突する
	// (実 zip 772 entries / child-1 に 756 偏在で本番 abort)。契約は「child 間のみ並列 /
	// 同一 child 内は逐次」— 並列性 (30s timeout 退行ガード) と OCC 安全性の両方を assert する。
	it('pointLedger: child 間は並列 in-flight >1 で実行され、全件 import される', async () => {
		// child ごとに distinct な id を返す (childIdMap が child 単位 group を作れるように)
		let childSeq = 200;
		mockInsertChild.mockReset().mockImplementation(async () => ({ id: String(childSeq++) }));
		const children = Array.from({ length: 4 }, (_, i) => ({
			exportId: `child-${i + 1}`,
			nickname: `テスト子${i + 1}`,
			age: 8,
			birthDate: '2018-01-15',
			theme: 'blue',
			uiMode: 'elementary',
			avatarUrl: null,
			activeTitle: null,
			createdAt: '2025-06-01T00:00:00Z',
		}));
		const data = makeExportData({
			pointLedger: Array.from({ length: N }, (_, i) => ({
				childRef: `child-${(i % 4) + 1}`, // 4 children に分散 → child 間並列が観測できる
				amount: 10 + i,
				type: 'earn',
				description: `entry-${i}`,
				createdAt: '2026-07-01T00:00:00Z',
			})),
		});
		(data.family as { children: unknown[] }).children = children;
		const result = await importFamilyData(data, TENANT);
		expect(result.pointLedgerImported).toBe(N);
		expect(pointLedgerTracker.max()).toBeGreaterThan(1);
	});

	it('pointLedger: 同一 child 内は逐次 (in-flight ≤ 1) — DSQL OCC 同一行衝突の恒久 guard', async () => {
		// 本番障害の再現条件: 単一 child に全 entry 集中。旧実装 (全 entry 25 並列) だと
		// max in-flight > 1 になり、DSQL では同一 children 行への並行 txn が commit 時 40001 で
		// abort する。修正後の契約 = 同一 child の point 書込は決して並行しない。
		const tracker = makeConcurrencyTracker();
		const prevImpl = pointLedgerImpl;
		pointLedgerImpl = () => tracker.tracked();
		const data = makeExportData({
			pointLedger: Array.from({ length: N }, (_, i) => ({
				childRef: 'child-1',
				amount: 10 + i,
				type: 'earn',
				description: `entry-${i}`,
				createdAt: '2026-07-01T00:00:00Z',
			})),
		});
		try {
			const result = await importFamilyData(data, TENANT);
			expect(result.pointLedgerImported).toBe(N);
			expect(tracker.max()).toBe(1);
		} finally {
			pointLedgerImpl = prevImpl;
		}
	});

	it('statusHistory: insert が並列 in-flight >1 で実行され、全件 import される', async () => {
		const data = makeExportData({
			statusHistory: Array.from({ length: N }, (_, i) => ({
				childRef: 'child-1',
				categoryCode: 'undou',
				value: 50 + i,
				changeAmount: 1,
				changeType: 'activity',
				recordedAt: `2026-07-01T00:${String(i).padStart(2, '0')}:00Z`,
			})),
		});
		const result = await importFamilyData(data, TENANT);
		expect(result.statusHistoryImported).toBe(N);
		expect(statusHistoryTracker.max()).toBeGreaterThan(1);
	});

	it('activityLogs: insert が並列 in-flight >1 で実行され、merge dedup (バッチ内重複 skip) も保存される', async () => {
		// child の活動マスタ lookup に「たいそう」を持たせ、activityLogs が bind できるようにする
		mockChildActivityFindByChild.mockResolvedValue([{ id: 'act-1', name: 'たいそう' }]);
		const uniqueLogs = Array.from({ length: N }, (_, i) => ({
			childRef: 'child-1',
			activityName: 'たいそう',
			activityCategory: 'undou',
			points: 10,
			streakDays: 1,
			streakBonus: 0,
			recordedDate: '2026-07-01',
			recordedAt: `2026-07-01T00:${String(i).padStart(2, '0')}:00Z`,
			cancelled: false,
		}));
		// バッチ内重複 1 件 (merge mode では skip されるべき — 並列化後も dedup 不変)
		const data = makeExportData({ activityLogs: [...uniqueLogs, ...uniqueLogs.slice(0, 1)] });
		const result = await importFamilyData(data, TENANT);
		expect(result.activityLogsImported).toBe(N);
		expect(result.activityLogsSkipped).toBe(1);
		expect(activityLogTracker.max()).toBeGreaterThan(1);
	});

	it('loginBonuses: insert が並列 in-flight >1 で実行され、既存日付 dedup も保存される', async () => {
		// 既存 bonus 1 件 (2026-07-01) — この日付の行は skip されるべき
		mockFindRecentBonuses.mockResolvedValue([{ loginDate: '2026-07-01' }]);
		const data = makeExportData({
			loginBonuses: Array.from({ length: N + 1 }, (_, i) => ({
				childRef: 'child-1',
				loginDate: `2026-07-${String(i + 1).padStart(2, '0')}`,
				rank: 'normal',
				basePoints: 5,
				multiplier: 1,
				totalPoints: 5,
				consecutiveDays: i + 1,
				createdAt: '2026-07-01T00:00:00Z',
			})),
		});
		const result = await importFamilyData(data, TENANT);
		expect(result.loginBonusesImported).toBe(N);
		expect(result.loginBonusesSkipped).toBe(1);
		expect(loginBonusTracker.max()).toBeGreaterThan(1);
	});

	it('stampCards: entry insert が並列 in-flight >1 で実行され、card/entry とも全件 import される', async () => {
		const cards = Array.from({ length: 3 }, (_, c) => ({
			childRef: 'child-1',
			weekStart: `2026-06-${String(c * 7 + 1).padStart(2, '0')}`,
			weekEnd: `2026-06-${String(c * 7 + 7).padStart(2, '0')}`,
			status: 'completed',
			redeemedPoints: 0,
			redeemedAt: null,
			createdAt: '2026-06-01T00:00:00Z',
			updatedAt: '2026-06-07T00:00:00Z',
			entries: Array.from({ length: 4 }, (_, s) => ({
				stampMasterId: 'stamp-1',
				omikujiRank: 'kichi',
				slot: s + 1,
				loginDate: `2026-06-${String(c * 7 + s + 1).padStart(2, '0')}`,
				earnedAt: '2026-06-01T00:00:00Z',
			})),
		}));
		const data = makeExportData({ stampCards: cards });
		const result = await importFamilyData(data, TENANT);
		expect(result.stampCardsImported).toBe(3);
		expect(result.stampEntriesImported).toBe(12);
		expect(stampEntryTracker.max()).toBeGreaterThan(1);
	});
});
