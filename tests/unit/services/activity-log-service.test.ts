import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
// tests/unit/services/activity-log-service.test.ts
// 活動記録サービスのユニットテスト — recordActivity() / cancelActivityLog() を直接呼ぶ

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb,
	seedChildActivities,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

// todayDate をモックして日付を制御
let mockToday = '2026-02-20';
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	// 部分 mock。今日だけを固定し、他の JST ヘルパは実装をそのまま使う (#4127)
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => mockToday,
}));

// DB モック: SQLite リポジトリがテスト用インメモリ DB を使うようにする
vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

// ロガーをモック
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

// #4916: bonus-hook preset (marketplace 取込済ボーナスルール) をモックし、
// れんぞく/カテゴリ/週末等が「複数同時発火」する本番相当シナリオを再現可能にする。
// 既定は presets: [] (未取込) — 既存テストは real loadBonusOverrides と同じ挙動 (regression なし)。
const mockLoadBonusOverrides = vi.fn();
vi.mock('$lib/marketplace/strategies/rule-preset/bonus-state', () => ({
	loadBonusOverrides: (...args: unknown[]) => mockLoadBonusOverrides(...args),
}));

import { calcStreakBonus } from '../../../src/lib/domain/validation/activity';
// サービス層をインポート（モック設定後に行う）
import {
	cancelActivityLog,
	type RecordActivityResult,
	recordActivity,
} from '../../../src/lib/server/services/activity-log-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	// #4916: 前 test の bonus-hook preset override を毎回リセットし、他 describe への漏出を防ぐ
	mockLoadBonusOverrides.mockReset();
	mockLoadBonusOverrides.mockResolvedValue({ presets: [] });
});

/** #4916: bonus-hook-service.test.ts と同じ preset 構造ヘルパー (marketplace 取込済ルール)。 */
function makeBonusPreset(presetId: string, rules: { title: string; pointBonus: number }[]) {
	return {
		presetId,
		presetName: presetId,
		presetIcon: '🔥',
		enabled: true,
		rules: rules.map((r) => ({ ...r, description: '', icon: '🔥' })),
		importedAt: '2026-05-01T00:00:00Z',
	};
}

function seedBase() {
	resetDb(sqlite);
	// 子供
	testDb.insert(schema.children).values({ nickname: 'テスト子', age: 4, theme: 'pink' }).run();
	// #2362 PR-3 Phase 7b-2c: 活動を child_activities (per-child instance) に seed
	// childId=1 紐付け。カテゴリ1: うんどう / カテゴリ2: べんきょう
	seedChildActivities(testDb, 1, [
		{ name: 'たいそう', categoryId: asCategoryId(1), icon: '🤸', basePoints: 5 },
		{ name: 'えほん', categoryId: asCategoryId(2), icon: '📖', basePoints: 5 },
	]);
}

describe('calcStreakBonus（純粋関数テスト）', () => {
	it('1日目はボーナスなし', () => {
		expect(calcStreakBonus(1)).toBe(0);
	});

	it('2日連続で+1ボーナス', () => {
		expect(calcStreakBonus(2)).toBe(1);
	});

	it('5日連続で+4ボーナス', () => {
		expect(calcStreakBonus(5)).toBe(4);
	});

	it('11日連続で上限+10ボーナス', () => {
		expect(calcStreakBonus(11)).toBe(10);
	});

	it('100日連続でも上限+10ボーナス', () => {
		expect(calcStreakBonus(100)).toBe(10);
	});

	it('0日はボーナスなし', () => {
		expect(calcStreakBonus(0)).toBe(0);
	});
});

describe('recordActivity: 初回記録', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('初回記録で streakDays=1、streakBonus=0、ポイント付与', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.childId).toBe('1');
		expect(result.activityId).toBe('1');
		expect(result.streakDays).toBe(1);
		expect(result.streakBonus).toBe(0);
		expect(result.basePoints).toBe(5);
		expect(result.totalPoints).toBe(5); // base(5) + streak(0) + mastery(0)
		expect(result.activityName).toBe('たいそう');
	});

	it('同日同活動の2回目は ALREADY_RECORDED エラー（dailyLimit=null=1回制限）', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const result = await recordActivity(asChildId(1), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'ALREADY_RECORDED' });
	});

	it('別活動なら同日に記録可能', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const result2 = assertSuccess(await recordActivity(asChildId(1), asActivityId(2), TENANT));
		expect(result2.activityId).toBe('2');
		expect(result2.activityName).toBe('えほん');
	});

	it('存在しない子供は NOT_FOUND エラー', async () => {
		const result = await recordActivity(asChildId(999), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'child' });
	});

	it('存在しない活動は NOT_FOUND エラー', async () => {
		const result = await recordActivity(asChildId(1), asActivityId(999), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'activity' });
	});
});

// ============================================================
// CWE-598 / ADR-0055 §3.1 — child 越境記録ガード (#2520 AC8)
//
// per-child refactor (ADR-0055) 後、`child_activities.id` は child に閉じている。
// child A の context で child B の child_activities.id を記録 API に渡す越境
// (CWE-598 IDOR) を「activity が見つからない」として構造的に拒否すること。
// 防御が外れると child A の activity_logs に child B 所属 activity が紐づき、
// 別の子のデータが混入する (親が即離脱する failure class、research §2 Class 4)。
// ============================================================
describe('recordActivity: child 越境ガード (CWE-598)', () => {
	beforeEach(() => {
		resetDb(sqlite);
		mockToday = '2026-02-20';
		// child 1 (childA) / child 2 (childB) を seed
		testDb.insert(schema.children).values({ nickname: 'childA', age: 8, theme: 'blue' }).run();
		testDb.insert(schema.children).values({ nickname: 'childB', age: 13, theme: 'green' }).run();
		// child 1 の activity (id=1) / child 2 の activity (id=2)
		seedChildActivities(testDb, 1, [
			{ name: 'A-たいそう', categoryId: asCategoryId(1), icon: '🤸', basePoints: 5 },
		]);
		seedChildActivities(testDb, 2, [
			{ name: 'B-べんきょう', categoryId: asCategoryId(2), icon: '📖', basePoints: 5 },
		]);
	});

	it('child A が child B の activity_id を記録しようとすると NOT_FOUND (越境拒否)', async () => {
		// activity id=2 は child 2 (childB) に属する。child 1 (childA) で記録 → 越境
		const result = await recordActivity(asChildId(1), asActivityId(2), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'activity' });

		// child A の activity_logs に child B の activity が混入していないこと
		const logs = sqlite
			.prepare('SELECT child_id, activity_id FROM activity_logs WHERE cancelled = 0')
			.all() as { child_id: number; activity_id: number }[];
		expect(logs).toEqual([]);
	});

	it('child B が child A の activity_id を記録しようとしても NOT_FOUND (逆方向も拒否)', async () => {
		// activity id=1 は child 1 (childA) に属する。child 2 (childB) で記録 → 越境
		const result = await recordActivity(asChildId(2), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'activity' });
	});

	it('自分の activity_id なら正常に記録できる (正例で過剰ガードでないことを確認)', async () => {
		const a = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(a.childId).toBe('1');
		expect(a.activityId).toBe('1');
		const b = assertSuccess(await recordActivity(asChildId(2), asActivityId(2), TENANT));
		expect(b.childId).toBe('2');
		expect(b.activityId).toBe('2');
	});
});

describe('recordActivity: 連続日数（streak）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('3日連続記録で streak が正しく増加する', async () => {
		mockToday = '2026-02-18';
		const day1 = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(day1.streakDays).toBe(1);
		expect(day1.streakBonus).toBe(0);

		mockToday = '2026-02-19';
		const day2 = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(day2.streakDays).toBe(2);
		expect(day2.streakBonus).toBe(1);

		mockToday = '2026-02-20';
		const day3 = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(day3.streakDays).toBe(3);
		expect(day3.streakBonus).toBe(2);
	});

	it('1日空けると streak がリセットされる', async () => {
		mockToday = '2026-02-18';
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));

		// 2/19 をスキップ
		mockToday = '2026-02-20';
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.streakDays).toBe(1); // リセット
		expect(result.streakBonus).toBe(0);
	});

	it('別活動は独立した streak を持つ', async () => {
		mockToday = '2026-02-18';
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT)); // たいそう day1
		assertSuccess(await recordActivity(asChildId(1), asActivityId(2), TENANT)); // えほん day1

		mockToday = '2026-02-19';
		const taisou = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT)); // たいそう day2
		expect(taisou.streakDays).toBe(2);
		expect(taisou.streakBonus).toBe(1);

		const ehon = assertSuccess(await recordActivity(asChildId(1), asActivityId(2), TENANT)); // えほん day2
		expect(ehon.streakDays).toBe(2);
		expect(ehon.streakBonus).toBe(1);
	});
});

describe('recordActivity: ポイントとXP', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('totalPoints はベースポイント + streakBonus + masteryBonus の合計', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		// 初回: base=5, streak=0, mastery=0
		expect(result.totalPoints).toBe(result.basePoints + result.streakBonus + result.masteryBonus);
	});

	it('XP がカテゴリに蓄積される', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		// xpGain.xpAfter > 0
		expect(result.xpGain.categoryId).toBe('1'); // うんどう
		expect(result.xpGain.xpAfter).toBeGreaterThan(0);
		expect(result.xpGain.xpAfter).toBe(result.xpGain.xpBefore + result.totalPoints);
	});

	it('ポイント台帳に activity タイプのエントリが作成される', async () => {
		await recordActivity(asChildId(1), asActivityId(1), TENANT);
		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger.length).toBeGreaterThanOrEqual(1);
		const activityEntry = ledger.find((e) => e.type === 'activity');
		expect(activityEntry).toBeDefined();
		expect(activityEntry?.amount).toBe(5);
		expect(activityEntry?.childId).toBe(1);
	});
});

describe('recordActivity: dailyLimit', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('dailyLimit=2 の活動は同日2回まで記録可能', async () => {
		// #2362 PR-3 Phase 7b-2c: child_activities へ insert (childId=1)
		seedChildActivities(testDb, 1, [
			{ name: 'はみがき', categoryId: asCategoryId(3), icon: '🪥', basePoints: 3, dailyLimit: 2 },
		]);
		const childActs = testDb.select().from(schema.childActivities).all();
		const hamigaki = childActs.find((a) => a.name === 'はみがき');
		if (!hamigaki) throw new Error('はみがき not found');

		const r1 = assertSuccess(await recordActivity(asChildId(1), asActivityId(hamigaki.id), TENANT));
		expect(r1.activityName).toBe('はみがき');

		const r2 = assertSuccess(await recordActivity(asChildId(1), asActivityId(hamigaki.id), TENANT));
		expect(r2.activityName).toBe('はみがき');

		// 3回目はエラー
		const r3 = await recordActivity(asChildId(1), asActivityId(hamigaki.id), TENANT);
		expect(r3).toEqual({ error: 'DAILY_LIMIT_REACHED' });
	});

	it('dailyLimit=0 の活動は無制限に記録可能', async () => {
		// #2362 PR-3 Phase 7b-2c: child_activities へ insert
		seedChildActivities(testDb, 1, [
			{ name: 'おそうじ', categoryId: asCategoryId(3), icon: '🧹', basePoints: 3, dailyLimit: 0 },
		]);
		const childActs = testDb.select().from(schema.childActivities).all();
		const osouji = childActs.find((a) => a.name === 'おそうじ');
		if (!osouji) throw new Error('おそうじ not found');

		// 5回連続で記録できる
		for (let i = 0; i < 5; i++) {
			const result = assertSuccess(
				await recordActivity(asChildId(1), asActivityId(osouji.id), TENANT),
			);
			expect(result.activityName).toBe('おそうじ');
		}
	});
});

describe('cancelActivityLog', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('キャンセルでポイントが返還される', async () => {
		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));

		// CANCEL_WINDOW_MS 内にキャンセル
		const cancelResult = await cancelActivityLog(recorded.id, TENANT);
		if ('error' in cancelResult) {
			throw new Error(`Unexpected error: ${cancelResult.error}`);
		}
		expect(cancelResult.refundedPoints).toBe(recorded.totalPoints);
	});

	it('キャンセル後にポイント台帳にマイナスエントリが追加される', async () => {
		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		await cancelActivityLog(recorded.id, TENANT);

		const ledger = testDb.select().from(schema.pointLedger).all();
		const cancelEntry = ledger.find((e) => e.type === 'cancel');
		expect(cancelEntry).toBeDefined();
		expect(cancelEntry?.amount).toBe(-recorded.totalPoints);
	});

	it('存在しないログIDは NOT_FOUND エラー', async () => {
		const result = await cancelActivityLog('9999', TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('キャンセル済みのログは NOT_FOUND エラー', async () => {
		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		await cancelActivityLog(recorded.id, TENANT);

		const result = await cancelActivityLog(recorded.id, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// path が logId しか持たない id-only mutation。child ロールの要求では
	// requireChildScope が「自分の childId」を渡すため、兄弟の記録は消せない。
	it('scopeChildId が行の所有者と違えば NOT_FOUND (兄弟の記録をとりけせない)', async () => {
		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));

		const denied = await cancelActivityLog(recorded.id, TENANT, asChildId(999));
		expect(denied).toEqual({ error: 'NOT_FOUND' });

		// 拒否されただけで、行は生きたまま (取り消されていない)
		const ok = await cancelActivityLog(recorded.id, TENANT, asChildId(1));
		expect('refundedPoints' in ok).toBe(true);
	});

	it('scopeChildId 省略 (owner/parent) は従来どおり全 child の記録をとりけせる', async () => {
		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const result = await cancelActivityLog(recorded.id, TENANT);
		expect('refundedPoints' in result).toBe(true);
	});
});

describe('cancelActivityLog: mastery_bonus 対称返金 (#3787)', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	/** childId の point_ledger 合計 (record +total / cancel −refund の net)。 */
	function ledgerBalance(childId: number): number {
		return testDb
			.select()
			.from(schema.pointLedger)
			.all()
			.filter((e) => Number(e.childId) === childId)
			.reduce((sum, e) => sum + e.amount, 0);
	}

	it('mastery_bonus 付与済 (level ≥ 5) の record→cancel は mastery_bonus も返金し net 0 (farming vector 消滅)', async () => {
		// 習熟レベル 5 (totalCount=30) を seed → 次の record で masteryBonus = floor(5/5) = 1 が付与される
		testDb
			.insert(schema.activityMastery)
			.values({ childId: 1, activityId: 1, totalCount: 30, level: 5 })
			.run();

		const recorded = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		// 前提: この record で mastery_bonus が実際に付与されている (0 だと本テストが farming を検出できない)
		expect(recorded.masteryBonus).toBeGreaterThan(0);
		expect(ledgerBalance(1)).toBe(recorded.totalPoints);

		const cancelResult = await cancelActivityLog(recorded.id, TENANT);
		if ('error' in cancelResult) throw new Error(`Unexpected error: ${cancelResult.error}`);

		// 対称返金: cancel は base+streak だけでなく mastery_bonus 込みの totalPoints 全額を返金する
		expect(cancelResult.refundedPoints).toBe(recorded.totalPoints);
		// record +total / cancel −total で net 0。mastery_bonus が balance に残らない
		expect(ledgerBalance(1)).toBe(0);
	});
});

describe('recordActivity: 習熟度（mastery）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('初回記録で習熟レベル1、習熟ボーナス0', async () => {
		mockToday = '2026-02-20';
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.masteryLevel).toBe(1);
		expect(result.masteryBonus).toBe(0);
		expect(result.masteryLeveledUp).toBeNull();
	});

	it('5回記録するとレベル2に上がる', async () => {
		// 5日連続で記録（レベル2のしきい値=5回）
		let lastResult: RecordActivityResult | undefined;
		for (let i = 0; i < 5; i++) {
			mockToday = `2026-02-${String(20 + i).padStart(2, '0')}`;
			lastResult = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		}
		if (!lastResult) throw new Error('No result');
		expect(lastResult.masteryLevel).toBe(2);
		expect(lastResult.masteryLeveledUp).not.toBeNull();
		expect(lastResult.masteryLeveledUp?.newLevel).toBe(2);
	});
});

describe('recordActivity: 戻り値の構造', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('必須フィールドが全て含まれる', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		// 必須フィールドの存在確認
		expect(typeof result.id).toBe('string');
		expect(result.childId).toBe('1');
		expect(result.activityId).toBe('1');
		expect(typeof result.activityName).toBe('string');
		expect(typeof result.basePoints).toBe('number');
		expect(typeof result.streakDays).toBe('number');
		expect(typeof result.streakBonus).toBe('number');
		expect(typeof result.masteryBonus).toBe('number');
		expect(typeof result.masteryLevel).toBe('number');
		expect(typeof result.totalPoints).toBe('number');
		expect(typeof result.recordedAt).toBe('string');
		expect(typeof result.cancelableUntil).toBe('string');
		expect(Array.isArray(result.unlockedAchievements)).toBe(true);
		expect(result.xpGain).toBeDefined();
		expect(typeof result.xpGain.categoryId).toBe('string');
		expect(typeof result.xpGain.xpBefore).toBe('number');
		expect(typeof result.xpGain.xpAfter).toBe('number');
	});

	it('cancelableUntil は recordedAt より後の時刻', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const recordedTime = new Date(result.recordedAt).getTime();
		const cancelTime = new Date(result.cancelableUntil).getTime();
		expect(cancelTime).toBeGreaterThan(recordedTime);
	});
});

// #4916: 記録結果の「+N P」と内訳が食い違う不具合の回帰テスト。
// 本番相当 (れんぞく + カテゴリチャレンジ + しゅうまつ2ばい + コンボ) を同一記録で複数同時発火させ、
// 結果ダイアログの主要数字 (grandTotal) = 内訳の合計 = 実際に point_ledger へ積まれた額、が
// 常に一致することを固定する。
describe('recordActivity: grandTotal / pointBreakdown (#4916、複数ボーナス同時発火)', () => {
	beforeEach(() => {
		resetDb(sqlite);
		testDb.insert(schema.children).values({ nickname: 'テスト子', age: 8, theme: 'blue' }).run();
		// 3 カテゴリ (うんどう/べんきょう/せいかつ) の活動を seed し、同日 3 カテゴリ達成 (コンボ + カテゴリ
		// チャレンジ hook) を起こせるようにする。
		seedChildActivities(testDb, 1, [
			{ name: 'たいそう', categoryId: asCategoryId(1), icon: '🤸', basePoints: 5 }, // id=1
			{ name: 'べんきょう', categoryId: asCategoryId(2), icon: '📖', basePoints: 5 }, // id=2
			{ name: 'おてつだい', categoryId: asCategoryId(3), icon: '🧹', basePoints: 5 }, // id=3
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('streak(れんぞく) + category-challenge(カテゴリ) + weekend(しゅうまつ2ばい) + combo が同時発火しても grandTotal = 内訳合計 = 台帳増分 が一致する', async () => {
		// Day1 (金曜): たいそう を記録し streak の土台 (streakDays=1) を作る
		mockToday = '2026-05-15';
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-14T21:00:00Z')); // JST 2026-05-15 06:00 (金曜)
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		vi.useRealTimers();

		// Day2 (土曜、しゅうまつ): weekend-special / category-challenge / streak-bonus preset を取込済とする
		mockLoadBonusOverrides.mockResolvedValue({
			presets: [
				makeBonusPreset('weekend-special', [{ title: 'しゅうまつ2ばいボーナス', pointBonus: 0 }]),
				makeBonusPreset('category-challenge', [
					{ title: '3カテゴリチャレンジ', pointBonus: 15 },
					{ title: 'オールカテゴリチャレンジ', pointBonus: 50 },
				]),
			],
		});
		mockToday = '2026-05-16';
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-16T01:00:00Z')); // JST 2026-05-16 10:00 (土曜)

		// 1・2 件目: べんきょう / おてつだい を記録し distinct カテゴリを積む (今回はボーナス対象外)
		assertSuccess(await recordActivity(asChildId(1), asActivityId(2), TENANT));
		assertSuccess(await recordActivity(asChildId(1), asActivityId(3), TENANT));

		// 3 件目 (本命): たいそう の当日初回記録。この 1 回で
		//   - streakDays=2 (金曜+土曜) → defaultStreakBonus = calcStreakBonus(2) = 1
		//   - weekend-special hook (×2) → effectiveBasePoints = 5*2 = 10
		//   - category-challenge hook (3カテゴリ達成) → +15
		//   - コンボ (3 カテゴリ目 = さんみいったい tier、combo-service 本体) → +8 (別建て ledger)
		// が同時発火する。
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		vi.useRealTimers();

		// --- 内訳 (pointBreakdown) が全ボーナス種別を itemize していること ---
		const base = result.pointBreakdown.find((i) => i.kind === 'base');
		expect(base?.points).toBe(10); // 5 (base) × 2 (weekend)
		expect(base?.multipliers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'bonusHook',
					title: 'しゅうまつ2ばいボーナス',
					multiplier: 2,
				}),
			]),
		);

		const streakItem = result.pointBreakdown.find((i) => i.kind === 'streakDefault');
		expect(streakItem?.points).toBe(1); // calcStreakBonus(2)

		const categoryHit = result.pointBreakdown.find(
			(i) => i.kind === 'bonusHook' && i.title === '3カテゴリチャレンジ',
		);
		expect(categoryHit?.points).toBe(15);

		// --- 内訳の合計 = totalPoints (基本+streak+熟練) と厳密一致 ---
		const breakdownSum = result.pointBreakdown.reduce((sum, i) => sum + i.points, 0);
		expect(breakdownSum).toBe(result.totalPoints);
		expect(result.totalPoints).toBe(26); // 10(base×2) + 1(streak) + 15(category) + 0(mastery)

		// --- コンボ (real combo-service、hook とは別経路) も同時発火していること ---
		// #4686: totalNewBonus は tier 満額ではなく「今回の純増」。2 件目で「にとうりゅう」+3 が
		// 既に付与済みのため、3 件目「さんみいったい」tier (満額 8) の純増は 8-3=5。
		expect(result.comboBonus).not.toBeNull();
		expect(result.comboBonus?.crossCategoryCombo?.name).toBe('さんみいったい');
		expect(result.comboBonus?.totalNewBonus).toBe(5);

		// --- grandTotal = totalPoints + combo + mission + focus (#4916 AC1 の核心) ---
		const missionBonus = result.missionComplete?.bonusAwarded ?? 0;
		const focusBonus = result.focusBonus?.bonusPoints ?? 0;
		expect(result.grandTotal).toBe(
			result.totalPoints + (result.comboBonus?.totalNewBonus ?? 0) + missionBonus + focusBonus,
		);

		// --- grandTotal = 実際に point_ledger へ積まれた額 (reference_id 紐付け、履歴の 3 者一致) ---
		const ledgerSum = testDb
			.select()
			.from(schema.pointLedger)
			.all()
			.filter((e) => Number(e.referenceId) === Number(result.id))
			.reduce((sum, e) => sum + e.amount, 0);
		expect(ledgerSum).toBe(result.grandTotal);
	});

	// #4948: #4916 は「結果ダイアログの主要数字」を直したが、記録履歴画面は
	// 行 = grandTotal / 合計欄 = points + streakBonus のままで、同一画面で
	// 「行の合計 ≠ 合計欄」になっていた (同じ不一致の集計レベルでの再発)。
	it('記録履歴の summary.totalGrandTotal は各行 grandTotal の総和と一致する (合計欄と行の不一致を防ぐ)', async () => {
		mockToday = '2026-05-16';
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-15T21:00:00Z')); // JST 2026-05-16 06:00 (土曜)
		mockLoadBonusOverrides.mockResolvedValue({
			presets: [
				makeBonusPreset('weekend-special', [{ title: 'しゅうまつ2ばいボーナス', pointBonus: 0 }]),
			],
		});
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		assertSuccess(await recordActivity(asChildId(1), asActivityId(2), TENANT));
		vi.useRealTimers();

		const { getActivityLogs } = await import('$lib/server/services/activity-log-service');
		const { logs, summary } = await getActivityLogs(asChildId(1), TENANT, {});

		const rowSum = logs.reduce((sum, l) => sum + (l.grandTotal ?? l.points + l.streakBonus), 0);
		expect(summary.totalGrandTotal).toBe(rowSum);

		// 台帳とも一致する (表示だけ辻褄を合わせていないことの裏取り)
		const ledgerSum = testDb
			.select()
			.from(schema.pointLedger)
			.all()
			.filter((e) => logs.some((l) => Number(e.referenceId) === Number(l.id)))
			.reduce((sum, e) => sum + e.amount, 0);
		expect(summary.totalGrandTotal).toBe(ledgerSum);
	});
});
