// tests/unit/services/import-restore-real-scale.test.ts
// #3692 / 本番 restore 障害 (2026-07-15) の恒久回帰テスト。
//
// 背景: 本番 AWS (DSQL) への実 zip restore (NUC PGlite export、772 ledger / 2 children) が
// 「ポイント台帳 insert 失敗: Failed query: commit」で abort した。真因は import の 25 並列
// insert が「ledger INSERT + 同一 children 行 total_point UPDATE」txn を同一 child に集中させ、
// DSQL (OCC) の write-write 衝突が commit 時 40001 で abort したこと (child-1 = 756 entries)。
//
// 既存 import test は全 repo mock (vi.fn) で実 DB を通らず、pglite-cutover-roundtrip も
// 代表数行の合成データのみだったため、実 zip の規模・形状で実 backend を貫通するテストが
// 存在しなかった = 本番でしか露見しない構造。本テストはその穴を塞ぐ:
//
//   - fixture = **実バックアップ zip から生成した匿名化データ** (tests/fixtures/
//     restore-real-scale-backup.json、772 ledger / 363 logs / 607 statusHistory / 101 activities
//     / 2 children。個人情報は生成 script で scrub 済、構造・規模・偏り (child-1 に 756 entries)
//     は実データそのまま)
//   - backend = 実 PGlite (pg-core 実 migration 適用、dsql repos verbatim) — 本番 DSQL と
//     同一 repo コードを通す
//   - assert = errors 完全ゼロ + 件数一致 + 残高 = ledger 合算 (部分 skip の silent 成功を許さない)
//
// ⚠️ PGlite は単一接続のため DSQL の OCC commit 衝突自体は再現できない。並行衝突の実機検証は
//   tests/integration/db/dsql-staging-import-restore.test.ts (DSQL_ENDPOINT gate) が担う (両輪)。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-00000000ea15';
const originalDataSource = process.env.DATA_SOURCE;

afterAll(() => {
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
});

describe('実 zip 規模 restore 貫通 (#3692 本番障害回帰、実 PGlite backend)', () => {
	it('匿名化実バックアップ (772 ledger / 偏り child-1=756) が errors ゼロで復元され残高が ledger 合算 に一致する', async () => {
		vi.resetModules();
		process.env.DATA_SOURCE = 'pglite';
		delete process.env.PGLITE_DATA_DIR; // in-memory + 実 migration (drizzle/pglite/)

		const pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
		await pgliteConn.resetPgliteConnectionForTesting();
		await pgliteConn.initPgliteConnection();

		try {
			const raw = readFileSync(
				resolve(process.cwd(), 'tests', 'fixtures', 'restore-real-scale-backup.json'),
				'utf8',
			);
			const exportData = JSON.parse(raw);
			const ledgerEntries: { childRef: string; amount: number }[] = exportData.data.pointLedger;
			expect(ledgerEntries.length).toBe(772); // fixture が実規模を保っていることの前提 assert

			const { importFamilyData } = await import('../../../src/lib/server/services/import-service');
			const result = await importFamilyData(exportData, TENANT);

			// 本番障害の再発検出点: 1 件でも insert 失敗すれば errors に載る (silent skip 不可)
			expect(result.errors, `import errors: ${JSON.stringify(result.errors.slice(0, 5))}`).toEqual(
				[],
			);
			expect(result.pointLedgerImported).toBe(772);
			expect(result.pointLedgerSkipped).toBe(0);
			expect(result.childrenImported).toBe(2);

			// 残高整合: children ごとの total_point (compute-on-write) = fixture の amount 合算
			const { getRepos } = await import('../../../src/lib/server/db/factory');
			const repos = getRepos();
			const children = await repos.child.findAllChildren(TENANT);
			expect(children.length).toBe(2);

			// childRef (child-1/child-2) は export 内の children 配列順に対応する
			const refToNickname = new Map<string, string>(
				(exportData.family.children as { nickname: string }[]).map(
					(c: { nickname: string }, i: number) => [`child-${i + 1}`, c.nickname],
				),
			);
			for (const [ref, nickname] of refToNickname) {
				const expected = ledgerEntries
					.filter((e) => e.childRef === ref)
					.reduce((sum, e) => sum + e.amount, 0);
				const child = children.find((c) => c.nickname === nickname);
				expect(child, `child for ${ref} (${nickname})`).toBeTruthy();
				const balance = await repos.point.getBalance(child!.id, TENANT);
				expect(balance, `balance of ${ref}`).toBe(expected);
			}
		} finally {
			await pgliteConn.resetPgliteConnectionForTesting();
		}
	}, 300_000);
});
