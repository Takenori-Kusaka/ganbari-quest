// tests/integration/db/dsql-staging-import-restore.test.ts
// #3692 / 本番 restore 障害 (2026-07-15) の **実 Aurora DSQL cluster** での貫通検証。
//
// 背景: 本番 AWS restore (実 zip、772 ledger / child-1 に 756 entries 偏在) が
// 「ポイント台帳 insert 失敗: Failed query: commit」で abort。真因 = import の 25 並列
// insert が「ledger INSERT + 同一 children 行 total_point UPDATE」txn を同一 child に
// 集中させ、DSQL (OCC) の write-write 衝突が commit 時 40001 で abort
// (occ-retry maxAttempts=3 では 25 並列 × 756 行の競合に耐えられない)。
//
// PGlite (単一接続) はこの衝突を構造的に再現できない — 既存 import test が全緑のまま
// 本番だけ落ちた理由そのもの。**実 DSQL でしか検証できないため本テストが最終防衛線**:
//   - fixture = 実 zip 由来の匿名化データ (規模・偏りは実データそのまま、
//     tests/fixtures/restore-real-scale-backup.json)
//   - 経路 = importFamilyData 実体 (factory DATA_SOURCE=dsql → AuroraDSQLPool 複数接続)
//   - assert = errors 完全ゼロ + 772 行 import + 残高 = ledger 合算
//   旧実装 (全 entry 25 並列) では本テストは本番同様に fail する (= 再発を実機で検出する)。
//
// OCC 衝突自体の存在証明 (retry なし並行 → 40001) は dsql-staging-concurrency.test.ts [V1] が
// 担保済のため本テストでは重複しない。
//
// 実行方法 (CI では skip — DSQL_ENDPOINT 未設定のため。#3683 の staging CI レーン化で常設予定):
//   eval "$(aws configure export-credentials --format env)"   # SSO profile は env creds 化必須
//   DSQL_ENDPOINT=<staging-id>.dsql.us-east-1.on.aws \
//     npx vitest run tests/integration/db/dsql-staging-import-restore.test.ts
//
// 検証データは専用 family uuid に隔離し afterAll で clearAllFamilyData + children 全削除で
// 原状復帰する (staging を汚さない)。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ENDPOINT = process.env.DSQL_ENDPOINT;
// 検証専用 family (afterAll で全削除、staging concurrency test の c04c と別枠)
const TENANT = '00000000-0000-4000-8000-00000000e515';

const originalDataSource = process.env.DATA_SOURCE;

afterAll(() => {
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
});

// #3692 恒久 opt-in skip: 実 Aurora DSQL cluster (DSQL_ENDPOINT + AWS creds) を要する staging 貫通のため
// CI では常時 skip する設計。#3683 の staging CI レーン常設で置換予定 (deadline 目標 2026-09-13)。
// owner: @Takenori-Kusaka。実行方法は本ファイル冒頭コメント参照。
describe.skipIf(!ENDPOINT)(
	'実 DSQL restore 貫通 (#3692 本番障害の実機回帰、staging cluster)',
	() => {
		it('実 zip 規模 fixture (772 ledger / child-1 偏在 756) が実 DSQL に errors ゼロで復元される', async () => {
			vi.resetModules();
			process.env.DATA_SOURCE = 'dsql';

			const { importFamilyData } = await import('../../../src/lib/server/services/import-service');
			const { getRepos } = await import('../../../src/lib/server/db/factory');
			const { clearAllFamilyData } = await import('../../../src/lib/server/services/data-service');

			const raw = readFileSync(
				resolve(process.cwd(), 'tests', 'fixtures', 'restore-real-scale-backup.json'),
				'utf8',
			);
			const exportData = JSON.parse(raw);
			const ledgerEntries: { childRef: string; amount: number }[] = exportData.data.pointLedger;
			expect(ledgerEntries.length).toBe(772);

			// 前回 run が timeout / kill で finally cleanup 未到達だった場合の残骸を除去する
			// (専用 tenant を import 前に空へ正規化 — 汚染耐性)。
			// ⚠️ blast radius 注記: 本 test の書込/削除は全て専用 TENANT uuid にスコープされる
			// (clearAllFamilyData も family_id 述語)。DSQL_ENDPOINT を誤って本番に向けても他 tenant
			// には触れないが、本番 DB にテスト tenant を書き込むことになるため endpoint は必ず
			// staging を指定すること。共有 TENANT のため並行実行 (2 者同時) は不可 — solo 前提
			// (#3683 CI レーン化時に per-run tenant 分離へ移行)。
			// catch は「tenant が未作成 = 削除対象なし」の正常系のみを許容し、接続断等の真の障害は
			// 後段 assert を混乱させる前に観測できるよう warn を出す (#3700 握りつぶし教訓)。
			await clearAllFamilyData(TENANT).catch((e) => {
				console.warn('[dsql-staging-import-restore] pre-clean skipped:', String(e));
			});

			try {
				const result = await importFamilyData(exportData, TENANT);

				// 本番障害の再発検出点 (旧実装ならここで「Failed query: commit」が errors に載る)
				expect(
					result.errors,
					`import errors: ${JSON.stringify(result.errors.slice(0, 5))}`,
				).toEqual([]);
				expect(result.pointLedgerImported).toBe(772);
				expect(result.pointLedgerSkipped).toBe(0);

				// 残高整合 (compute-on-write total_point = ledger 合算、部分 commit 漏れの検出)
				const repos = getRepos();
				const children = await repos.child.findAllChildren(TENANT);
				expect(children.length).toBe(2);
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
					expect(child, `child for ${ref}`).toBeTruthy();
					expect(await repos.point.getBalance(child!.id, TENANT), `balance of ${ref}`).toBe(
						expected,
					);
				}
			} finally {
				// staging 原状復帰: tenant scope データ + 子供集約を全削除 (専用 family uuid 隔離)
				await clearAllFamilyData(TENANT).catch(() => {});
			}
		}, 1_500_000);
	},
);
