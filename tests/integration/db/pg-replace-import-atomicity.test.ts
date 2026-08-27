// tests/integration/db/pg-replace-import-atomicity.test.ts
// #4720: 「置換インポートの失敗時に旧データが保全される」が本番 backend (pg-core = cloud DSQL /
// NUC PGlite) で成立することを、実 migration を適用した PGlite + factory + service 貫通で固定する。
//
// 旧実装は `currentBackend()` が demo 以外を全部 'sqlite' と判定し、pg でも better-sqlite3 の db に
// BEGIN/ROLLBACK するだけだった (実 DB は clear 済のまま = 旧データ永久喪失、#3326 の故障モード再来)。
// sqlite では ROLLBACK が効くため再現しない class (#4680)。
//
//   [P1] clear 後に例外 → 旧データ (子供 / 活動 / 記録 / ごほうび) が件数・内容ともに復元される
//   [P2] 成功時は新データに置換され、復旧用 snapshot (storage) が残らない
//   [P3] snapshot 取得に失敗したら **置換を開始しない** (旧データ無傷 + ReplaceSnapshotError)
//   [P4] 活動記録が pg core 単一 txn 経路に入る (二連打が 1 回分、部分コミット無し)
//   [P5] stale cookie (非 uuid childId) が pg で 22P02 500 にならず not-found に正規化される

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_CODE_TO_ID } from '../../../src/lib/domain/categories';
import { asCategoryId } from '../../../src/lib/domain/ids';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// storage は S3 実装 (factory の pg 分岐) のため、in-memory に差し替える。
// replace-import-service (snapshot 保存 / 削除) と backup-archive (静的ファイル収集) の両方が
// `$lib/server/storage` を経由するので、この 1 箇所の mock で経路全体が閉じる。
const storageFiles = new Map<string, { data: Buffer; contentType: string }>();
const storageFailOn = { save: false };
vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(async (key: string, data: Buffer, contentType: string) => {
		if (storageFailOn.save) throw new Error('storage 障害注入');
		storageFiles.set(key, { data, contentType });
	}),
	readFile: vi.fn(async (key: string) => storageFiles.get(key) ?? null),
	deleteFile: vi.fn(async (key: string) => {
		storageFiles.delete(key);
	}),
	listFiles: vi.fn(async (prefix: string) =>
		[...storageFiles.keys()].filter((k) => k.startsWith(prefix)),
	),
	deleteByPrefix: vi.fn(async (prefix: string) => {
		let n = 0;
		for (const k of [...storageFiles.keys()]) {
			if (k.startsWith(prefix)) {
				storageFiles.delete(k);
				n++;
			}
		}
		return n;
	}),
	fileExists: vi.fn(async (key: string) => storageFiles.has(key)),
}));

const TENANT = '00000000-0000-4000-8000-00000000a720';
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;
let dataService: typeof import('../../../src/lib/server/services/data-service');
let replaceImport: typeof import('../../../src/lib/server/services/replace-import-service');

/** 子供 1 人 + 活動 1 件 + 記録 1 件 + ごほうび 1 件を seed する (置換対象の「旧データ」)。 */
async function seedFamily(nickname: string): Promise<void> {
	const child = await repos.child.insertChild({ nickname, age: 8 }, TENANT);
	const act = await repos.childActivity.insertActivity(
		{
			childId: child.id,
			name: 'はみがき',
			categoryId: asCategoryId(CATEGORY_CODE_TO_ID.seikatsu),
			icon: '🦷',
			basePoints: 10,
		},
		TENANT,
	);
	await repos.activity.insertActivityLog(
		{
			childId: child.id,
			activityId: act.id,
			points: 10,
			streakDays: 1,
			streakBonus: 0,
			recordedDate: '2026-08-01',
			recordedAt: '2026-08-01T10:00:00.000Z',
		},
		TENANT,
	);
	await repos.specialReward.insertSpecialReward(
		{ childId: child.id, title: 'アイスけん', points: 30, category: 'privilege' },
		TENANT,
	);
}

async function countRows(table: string): Promise<number> {
	const db = await pgliteConn.getPgliteDb();
	const r = await db.execute(
		sql`SELECT count(*)::int AS c FROM ${sql.raw(table)} WHERE family_id = ${TENANT}`,
	);
	return Number((r.rows[0] as { c: number }).c);
}

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR;
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();
	dataService = await import('../../../src/lib/server/services/data-service');
	replaceImport = await import('../../../src/lib/server/services/replace-import-service');
}, 120_000);

afterAll(async () => {
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

beforeEach(async () => {
	storageFiles.clear();
	storageFailOn.save = false;
	await dataService.clearAllFamilyData(TENANT);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('#4720 pg-core の置換インポート原子性 (PGlite 実 migration)', () => {
	it('[P1] clear 後に失敗しても旧データが復元される (件数・内容とも)', async () => {
		await seedFamily('まもられ太郎');
		expect(await countRows('children')).toBe(1);
		expect(await countRows('activity_logs')).toBe(1);

		await expect(
			replaceImport.runAtomicReplace(TENANT, async () => {
				await dataService.clearAllFamilyData(TENANT);
				// clear 済みであることを確かめてから失敗を注入する (旧実装はここで実 DB が空のまま確定した)
				expect(await countRows('children')).toBe(0);
				throw new Error('import 途中失敗注入');
			}),
		).rejects.toThrow('import 途中失敗注入');

		expect(await countRows('children')).toBe(1);
		expect(await countRows('activity_logs')).toBe(1);
		expect(await countRows('special_rewards')).toBe(1);
		const [restored] = await repos.child.findAllChildren(TENANT);
		expect(restored?.nickname).toBe('まもられ太郎');
	});

	it('[P2] 成功時は置換が確定し、復旧用 snapshot が storage に残らない', async () => {
		await seedFamily('旧データ子');

		const result = await replaceImport.runAtomicReplace(TENANT, async () => {
			await dataService.clearAllFamilyData(TENANT);
			await repos.child.insertChild({ nickname: '新データ子', age: 6 }, TENANT);
			return 'ok';
		});

		expect(result).toBe('ok');
		const children = await repos.child.findAllChildren(TENANT);
		expect(children.map((c) => c.nickname)).toEqual(['新データ子']);
		expect([...storageFiles.keys()].filter((k) => k.includes('/recovery/'))).toEqual([]);
	});

	it('[P3] snapshot を保存できないときは置換を開始しない (旧データ無傷)', async () => {
		await seedFamily('無傷子');
		storageFailOn.save = true;

		const work = vi.fn(async () => 'never');
		await expect(replaceImport.runAtomicReplace(TENANT, work)).rejects.toThrow(
			replaceImport.ReplaceSnapshotError,
		);
		expect(work).not.toHaveBeenCalled();
		expect(await countRows('children')).toBe(1);
	});

	it('[P4] 活動記録が pg core 単一 txn 経路に入る (同時二連打が 1 回分)', async () => {
		const child = await repos.child.insertChild({ nickname: 'れんだ子', age: 8 }, TENANT);
		const act = await repos.childActivity.insertActivity(
			{
				childId: child.id,
				name: 'おてつだい',
				categoryId: asCategoryId(CATEGORY_CODE_TO_ID.seikatsu),
				icon: '🧹',
				basePoints: 5,
			},
			TENANT,
		);
		const { recordActivity } = await import(
			'../../../src/lib/server/services/activity-log-service'
		);

		const results = await Promise.all([
			recordActivity(child.id, act.id, TENANT),
			recordActivity(child.id, act.id, TENANT),
		]);
		const succeeded = results.filter((r) => !('error' in r));
		expect(succeeded).toHaveLength(1);
		expect(await countRows('activity_logs')).toBe(1);

		// 部分コミット無し: 台帳合計と派生残高 (children.total_point) が一致する (core txn の不変条件)
		const db = await pgliteConn.getPgliteDb();
		const ledger = await db.execute(
			sql`SELECT coalesce(sum(amount), 0)::int AS s FROM point_ledger WHERE family_id = ${TENANT}`,
		);
		const total = await db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${TENANT} AND child_id = ${child.id}`,
		);
		const ledgerSum = Number((ledger.rows[0] as { s: number }).s);
		expect(ledgerSum).toBeGreaterThanOrEqual(5); // 基礎ポイント 1 回分以上 (bonus 加算はあり得る)
		expect(Number((total.rows[0] as { total_point: number }).total_point)).toBe(ledgerSum);
	});

	it('[P5] stale cookie (非 uuid childId) は pg で 22P02 にならず not-found になる', async () => {
		// 旧 SQLite 数値 id を持つ stale cookie / form 由来 id が uuid 列に渡っても throw しない
		await expect(repos.child.findChildById('123' as never, TENANT)).resolves.toBeUndefined();
		const { isValidUuidFormField } = await import(
			'../../../src/lib/server/auth/child-form-field-guard'
		);
		// pg 系 (pglite) では uuid 形式 guard が有効 (旧実装は isDsqlBackend()=false で素通し)
		expect(isValidUuidFormField('123', 'test.pglite')).toBe(false);
		expect(isValidUuidFormField('00000000-0000-4000-8000-000000000123', 'test.pglite')).toBe(true);
	});
});
