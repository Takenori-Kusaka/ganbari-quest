// tests/unit/services/pglite-cutover-roundtrip.test.ts
// EPIC #3620 AC-C4 (ADR-0064 §12.2) — NUC cutover の cross-backend round-trip 機械検証。
//
// 「旧 NUC (better-sqlite3、integer PK 旧 schema) で export → 新 PGlite (pg-core、UUID PK 新
// schema) へ import」が **id 非保全・自然キー再解決** (ADR-0064 §結果「§12.2 backup round-trip
// は backend 差に非依存で整合」) で成立することを実証する。これが成立すれば NUC cutover の
// データ移行機構 = 既存 export/import service の組み合わせで足りることが機械証明される。
//
// 構成 (1 it 内で 2 phase 直列 — module graph を跨ぐ state は plain JSON の exportData のみ):
//   Phase A: DATA_SOURCE=sqlite + test-db mock → repos 直 seed → exportFamilyData → ExportData
//   Phase B: vi.resetModules + DATA_SOURCE=pglite → initPglite (in-memory、実 migration 適用)
//            → importFamilyData(exportData) → dsql repos で件数 + 自然キー内容を検証
//
// 完全網羅 (全 source 実体) は既存 backup-roundtrip-completeness.test.ts が sqlite 内 round-trip
// で担保済み。本テストの責務は「pg backend への import 経路が cross-backend で貫通する」ことの
// 検証に限定し、代表 source 実体 (children / activities / logs / ledger / rewards / checklist /
// settings / login bonus) で件数・内容一致を確認する (重複検証しない)。

import { afterAll, describe, expect, it, vi } from 'vitest';
import { asCategoryId } from '../../../src/lib/domain/ids';

// ── Phase A 用の旧 sqlite test-db mock (既存 backup-roundtrip と同型)。
// resetModules 後の Phase B では pglite 分岐が client を参照しないため、この mock は無害に残る。
let testDb: unknown;
let testSqlite: { close(): void } | null = null;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// 新 schema (pg-core) の family_id は uuid 型のため、cutover 先 tenant は UUID 必須。
// 旧 NUC (sqlite) の tenant_id は text で非 UUID (local auth 固定値) — export データ自体は
// tenant 非依存 (importFamilyData の tenantId 引数で新 tenant を指定) のため、cutover では
// 「新環境の UUID tenant を発行して import する」のが正 (本 test はその契約を実証する)。
const TENANT = '00000000-0000-4000-8000-00000000cc41';
const originalDataSource = process.env.DATA_SOURCE;

afterAll(async () => {
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	testSqlite?.close();
});

describe('NUC cutover cross-backend round-trip (#3620 AC-C4、旧 sqlite → PGlite)', () => {
	it('旧 sqlite で export した家族データが PGlite (pg-core 新 schema) に自然キー再解決で復元される', async () => {
		// ═══ Phase A: 旧 sqlite backend で seed → export ═══
		process.env.DATA_SOURCE = 'sqlite';
		const { createTestDb } = await import('../helpers/test-db');
		const t = createTestDb();
		testDb = t.db;
		testSqlite = t.sqlite;

		const { getRepos: getReposA } = await import('../../../src/lib/server/db/factory');
		const reposA = getReposA();

		// 代表 source 実体を seed (自然キーで後段検証できる値を使う)
		const taro = await reposA.child.insertChild(
			{ nickname: '移行太郎', age: 8, birthDate: '2018-02-10' },
			TENANT,
		);
		const hana = await reposA.child.insertChild({ nickname: '移行花子', age: 6 }, TENANT);

		const act1 = await reposA.activity.insertActivity(
			{ name: 'はみがき', categoryId: asCategoryId('3'), icon: '🦷', basePoints: 5, ageMin: null, ageMax: null },
			TENANT,
		);
		await reposA.activity.insertActivity(
			{ name: 'おてつだい', categoryId: asCategoryId('3'), icon: '🧹', basePoints: 10, ageMin: null, ageMax: null },
			TENANT,
		);

		await reposA.activity.insertActivityLog(
			{
				childId: taro.id,
				activityId: act1.id,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-07-01',
				recordedAt: '2026-07-01T09:00:00.000Z',
			},
			TENANT,
		);

		await reposA.point.insertPointEntry(
			{ childId: taro.id, amount: 15, type: 'activity', description: '記録' },
			TENANT,
		);
		await reposA.point.insertPointEntry(
			{ childId: taro.id, amount: -5, type: 'redeem', description: '交換' },
			TENANT,
		);

		await reposA.specialReward.insertSpecialReward(
			{ childId: hana.id, title: 'アイスけん', points: 30, category: 'privilege' },
			TENANT,
		);

		const tpl = await reposA.checklist.insertTemplate({ name: 'あさのじゅんび' }, TENANT);
		await reposA.checklist.insertTemplateItem({ templateId: tpl.id, name: 'ぼうし' }, TENANT);
		await reposA.checklist.assignTemplateToChildren(tpl.id, [taro.id], TENANT);

		const { exportFamilyData } = await import('../../../src/lib/server/services/export-service');
		const exportData = await exportFamilyData({ tenantId: TENANT });

		// export 自体の健全性 (phase A 内 assert — export が空なら後段は無意味)
		expect(exportData.family.children.map((c) => c.nickname).sort()).toEqual(
			['移行太郎', '移行花子'].sort(),
		);
		expect(exportData.master.activities.length).toBeGreaterThanOrEqual(2);

		// ═══ Phase B: PGlite backend (pg-core 新 schema) へ import → 検証 ═══
		// module graph を作り直し、factory を pglite 分岐で再構築する。exportData は plain JSON
		// なので graph を跨いで安全に持ち運べる (id は自然キー再解決のため保全不要 = ADR-0064)。
		vi.resetModules();
		process.env.DATA_SOURCE = 'pglite';
		delete process.env.PGLITE_DATA_DIR; // in-memory (実 migration = drizzle/pglite/ を適用)

		const pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
		await pgliteConn.resetPgliteConnectionForTesting();
		await pgliteConn.initPgliteConnection();

		try {
			const { importFamilyData } = await import('../../../src/lib/server/services/import-service');
			const result = await importFamilyData(exportData, TENANT);

			// hard error ゼロ (部分失敗の silent 成功は不可)
			expect(result.errors, `import errors: ${JSON.stringify(result.errors)}`).toEqual([]);

			// pg backend の repos (dsql、PGlite executor) で自然キー検証
			const { getRepos: getReposB } = await import('../../../src/lib/server/db/factory');
			const reposB = getReposB();

			const childrenB = await reposB.child.findAllChildren(TENANT);
			expect(childrenB.map((c) => c.nickname).sort()).toEqual(['移行太郎', '移行花子'].sort());
			const taroB = childrenB.find((c) => c.nickname === '移行太郎');
			expect(taroB?.birthDate).toBe('2018-02-10');
			// point 残高 = ledger 合算 (15 - 5 = 10) が新 backend でも一致
			expect(await reposB.point.getBalance(taroB!.id, TENANT)).toBe(10);

			const activitiesB = await reposB.activity.findActivities(TENANT, { includeHidden: true });
			expect(activitiesB.map((a) => a.name).sort()).toEqual(['おてつだい', 'はみがき'].sort());

			const logsB = await reposB.activity.findActivityLogs(taroB!.id, TENANT);
			expect(logsB.length).toBe(1);
			expect(logsB[0]?.recordedAt).toContain('2026-07-01'); // 記録日時保全 (summary shape は recordedAt)
			expect(logsB[0]?.activityName).toBe('はみがき'); // 活動への再結合 (自然キー再解決の実証)

			const hanaB = childrenB.find((c) => c.nickname === '移行花子');
			const rewardsB = await reposB.specialReward.findSpecialRewards(hanaB!.id, TENANT);
			expect(rewardsB.map((r) => r.title)).toEqual(['アイスけん']);

			const templatesB = await reposB.checklist.findTemplatesByChild(taroB!.id, TENANT);
			expect(templatesB.map((tp) => tp.name)).toEqual(['あさのじゅんび']);
			const itemsB = await reposB.checklist.findTemplateItems(templatesB[0]!.id, TENANT);
			expect(itemsB.map((i) => i.name)).toEqual(['ぼうし']);
		} finally {
			await pgliteConn.resetPgliteConnectionForTesting();
		}
	}, 120_000);
});
