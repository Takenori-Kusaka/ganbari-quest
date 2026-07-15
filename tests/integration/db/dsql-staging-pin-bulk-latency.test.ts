// tests/integration/db/dsql-staging-pin-bulk-latency.test.ts
// #3592 ② / #3600 ② — **実 Aurora DSQL cluster** での並行検証 + hot path latency 実測。
//
// PGlite (単一接続) では再現・計測できない 3 点を staging cluster で検証する:
//   [M1] #3592 ②: togglePin の children 行 FOR UPDATE 直列化 — 同一 child の別 activity を
//        N 並行 pin しても pin_order が tie しない (write-skew は OCC 非検出 §4.1 のため
//        FOR UPDATE anchor が唯一の防御。真の並行接続でのみ検証可能)
//   [M2] #3592 ②: insertActivitiesBulk の部分失敗 rollback — mid-bulk で CHECK 違反 (23514) を
//        注入し、先行 INSERT が全て rollback される (all-or-nothing) ことを実 DSQL で検証
//   [M3] #3600 ② (#3562 ②): 「今週のカード」lookup (UUID surrogate 化で UNIQUE index 経由
//        2 段 fetch) の latency 実測 — SELECT 1 baseline との差分でサーバ側コストを近似し、
//        covering index 追加の要否判断材料を issue に記録する
//
// 実行方法 (CI では skip — DSQL_ENDPOINT 未設定のため。#3683 の staging CI レーン化で常設予定):
//   eval "$(aws configure export-credentials --format env)"
//   DSQL_ENDPOINT=<staging-id>.dsql.us-east-1.on.aws \
//     npx vitest run tests/integration/db/dsql-staging-pin-bulk-latency.test.ts
//
// ⚠️ latency の絶対値は実行元 (ローカル日本 ≈ +150ms RTT) に依存する。判断は
//   「lookup − SELECT 1 baseline」の差分 (サーバ側コスト近似) で行い、Lambda 同 region の
//   実効値は baseline 差分にほぼ一致する。
//
// 検証データは専用 family uuid に隔離し afterAll で全削除する (staging を汚さない)。

import { writeFileSync } from 'node:fs';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asChildId } from '../../../src/lib/domain/ids';
import { createDsqlActivityPrefRepo } from '../../../src/lib/server/db/dsql/activity-pref-repo';
import { createDsqlChildActivityRepo } from '../../../src/lib/server/db/dsql/child-activity-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import { createDsqlStampCardRepo } from '../../../src/lib/server/db/dsql/stamp-card-repo';

const ENDPOINT = process.env.DSQL_ENDPOINT;
// 検証専用 family (afterAll で全削除。concurrency=c04c / import-restore=e515 と別枠)
const FAMILY = '00000000-0000-4000-8000-00000000ea92';
const PARALLEL = 8;

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function percentile(sorted: number[], p: number): number {
	const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return sorted[Math.max(0, idx)] ?? 0;
}

describe.skipIf(!ENDPOINT)('実 DSQL pin 並行 + bulk rollback + latency (#3592②/#3600②)', () => {
	let pool: AuroraDSQLPool;
	let db: Db;
	let childId: string;
	const activityIds: string[] = [];

	beforeAll(async () => {
		pool = new AuroraDSQLPool({
			host: ENDPOINT,
			user: process.env.DSQL_MIGRATE_USER ?? 'admin',
			database: 'postgres',
			max: PARALLEL + 2, // 並行 txn は接続 1:1 (DSQL は 1 接続 1 txn)
			connectionTimeoutMillis: 15_000,
		});
		db = drizzle(pool);
		// 専用 family の残骸を除去 (前回 run が中断していた場合の汚染耐性)
		for (const t of ['child_activity_preferences', 'stamp_cards', 'child_activities', 'children']) {
			await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE family_id = ${FAMILY}`);
		}
		// 検証 child + activities (N=PARALLEL) を seed
		const child = await db.execute(sql`
			INSERT INTO children (family_id, nickname, birth_date, theme, ui_mode)
			VALUES (${FAMILY}, '実測子', '2018-01-15', 'blue', 'elementary') RETURNING child_id
		`);
		childId = (child.rows[0] as { child_id: string }).child_id;
		for (let i = 0; i < PARALLEL; i++) {
			const a = await db.execute(sql`
				INSERT INTO child_activities (family_id, child_id, name, category_id, icon, base_points)
				VALUES (${FAMILY}, ${childId}, ${`実測活動${i + 1}`}, '1', '🏃', 5) RETURNING activity_id
			`);
			activityIds.push((a.rows[0] as { activity_id: string }).activity_id);
		}
	}, 120_000);

	afterAll(async () => {
		try {
			for (const t of [
				'child_activity_preferences',
				'stamp_cards',
				'child_activities',
				'children',
			]) {
				await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE family_id = ${FAMILY}`);
			}
		} finally {
			await pool.end();
		}
	}, 60_000);

	it('[M1] 高並行 (N=8) pin: committed 分は tie なし連番 / 失敗は OCC 枯渇のみ (整合性は破れない)', async () => {
		// 実測での確定事実 (2026-07-15 初回計測): DSQL の FOR UPDATE は **write-intent 化であり
		// blocking lock ではない** — 同一 children 行への並行 write-intent は commit 時 40001 で
		// 検出され、occ-retry (maxAttempts=3) が吸収する。N=8 バーストでは retry 上限を超え
		// 一部が「Failed query: commit」で fail し得る (初回実測: 8 中 1 fail)。
		// **契約 = 整合性 (committed 分の tie なし連番) は常に成立 / 失敗は clean な OCC 枯渇のみ**。
		// throughput (全成功) は契約ではない — 現実的並行度 (N=2、二重 click / 2 端末) は [M1b]。
		const runner = createDsqlTransactionRunner<Tx>(db); // 既定 occ-retry (maxAttempts=3)
		const repo = createDsqlActivityPrefRepo(db, runner);

		const results = await Promise.allSettled(
			activityIds.map((aid) =>
				repo.togglePin(asChildId(childId), asChildId(aid) as never, 1, FAMILY),
			),
		);
		const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
		const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
		console.log(
			`[M1 report] N=${PARALLEL} fulfilled=${fulfilled} rejected=${rejected.length} reasons=${rejected.map((r) => String(r.reason).slice(0, 80)).join(' / ')}`,
		);
		// 失敗が出る場合は OCC 枯渇 (commit 失敗) のみ許容 — 他エラー (constraint 等) は契約違反
		for (const r of rejected) {
			expect(String(r.reason), 'OCC 枯渇以外の失敗は契約違反').toMatch(/commit|40001|OC000/);
		}
		// 成功数はバースト時 maxAttempts (=3 rounds、各 round で最低 1 commit 確定) に律速される
		// (実測: 8 並行で 4〜7 成功と高分散)。下限は理論保証値 = maxAttempts。
		expect(fulfilled, '各 retry round で最低 1 commit は確定する').toBeGreaterThanOrEqual(3);

		const orders = await db.execute(sql`
			SELECT pin_order FROM child_activity_preferences
			WHERE family_id = ${FAMILY} AND child_id = ${childId} AND is_pinned = true
			ORDER BY pin_order
		`);
		const values = (orders.rows as { pin_order: number }[]).map((r) => Number(r.pin_order));
		// 整合性契約: committed 分は tie なし (write-skew 不発) + 1 起点の連番 (欠番なし)
		expect(new Set(values).size, `pin_order tie 検出: ${values.join(',')}`).toBe(fulfilled);
		expect(values).toEqual(Array.from({ length: fulfilled }, (_, i) => i + 1));
	}, 120_000);

	it('[M1b] 現実的並行度 (N=2) は retry が吸収し全成功する', async () => {
		// 二重 click / 2 端末同時 pin 相当。maxAttempts=3 で吸収できることを実 DSQL で保証する。
		const runner = createDsqlTransactionRunner<Tx>(db);
		const repo = createDsqlActivityPrefRepo(db, runner);
		// M1 の pin を全解除して盤面を初期化
		for (const aid of activityIds) {
			await repo.togglePin(asChildId(childId), asChildId(aid) as never, 0, FAMILY);
		}
		const two = activityIds.slice(0, 2);
		const results = await Promise.allSettled(
			two.map((aid) => repo.togglePin(asChildId(childId), asChildId(aid) as never, 1, FAMILY)),
		);
		expect(
			results
				.filter((r) => r.status === 'rejected')
				.map((r) => String((r as PromiseRejectedResult).reason)),
			'N=2 は全成功 (retry 吸収)',
		).toEqual([]);
		const orders = await db.execute(sql`
			SELECT pin_order FROM child_activity_preferences
			WHERE family_id = ${FAMILY} AND child_id = ${childId} AND is_pinned = true
			ORDER BY pin_order
		`);
		expect((orders.rows as { pin_order: number }[]).map((r) => Number(r.pin_order))).toEqual([
			1, 2,
		]);
	}, 120_000);

	it('[M2] insertActivitiesBulk は mid-bulk CHECK 違反で全 rollback (all-or-nothing)', async () => {
		const runner = createDsqlTransactionRunner<Tx>(db);
		const repo = createDsqlChildActivityRepo(db, runner);

		const before = await db.execute(sql`
			SELECT count(*) AS c FROM child_activities WHERE family_id = ${FAMILY}
		`);
		const beforeCount = Number((before.rows[0] as { c: unknown }).c);

		const mkInput = (name: string, priority = 'optional') => ({
			childId: asChildId(childId),
			name,
			categoryId: '1' as never,
			icon: '🧪',
			basePoints: 5,
			priority,
		});
		// 3 行目で priority CHECK (enum SSOT) 違反 → 23514。先行 2 行が rollback されること。
		await expect(
			repo.insertActivitiesBulk(
				[
					mkInput('bulk-ok-1'),
					mkInput('bulk-ok-2'),
					mkInput('bulk-broken', 'INVALID_PRIORITY'),
					mkInput('bulk-never'),
				] as never,
				FAMILY,
			),
		).rejects.toThrow();

		const after = await db.execute(sql`
			SELECT count(*) AS c FROM child_activities WHERE family_id = ${FAMILY}
		`);
		expect(Number((after.rows[0] as { c: unknown }).c), '先行 INSERT が rollback 済').toBe(
			beforeCount,
		);
	}, 120_000);

	it('[M3] 週カード lookup latency 実測 (baseline 差分でサーバ側コスト近似、#3600②)', async () => {
		const runner = createDsqlTransactionRunner<Tx>(db);
		const stampRepo = createDsqlStampCardRepo(db, runner);
		// 今週のカードを 1 枚 seed
		const weekStart = '2026-07-13';
		await db.execute(sql`
			INSERT INTO stamp_cards (family_id, child_id, week_start, week_end)
			VALUES (${FAMILY}, ${childId}, ${weekStart}, '2026-07-19')
			ON CONFLICT ON CONSTRAINT stamp_cards_week_uq DO NOTHING
		`);

		const N = 50;
		const baseline: number[] = [];
		const lookup: number[] = [];
		// warm-up (接続確立・plan cache の初回コストを除外)
		await db.execute(sql`SELECT 1`);
		await stampRepo.findCardByChildAndWeek(asChildId(childId), weekStart, FAMILY);
		for (let i = 0; i < N; i++) {
			let t0 = performance.now();
			await db.execute(sql`SELECT 1`);
			baseline.push(performance.now() - t0);
			t0 = performance.now();
			const card = await stampRepo.findCardByChildAndWeek(asChildId(childId), weekStart, FAMILY);
			lookup.push(performance.now() - t0);
			expect(card, 'lookup が今週のカードを返す').toBeTruthy();
		}
		baseline.sort((a, b) => a - b);
		lookup.sort((a, b) => a - b);
		const report = {
			n: N,
			baselineMs: { p50: percentile(baseline, 50), p95: percentile(baseline, 95) },
			lookupMs: { p50: percentile(lookup, 50), p95: percentile(lookup, 95) },
			serverCostApproxMs: {
				p50: percentile(lookup, 50) - percentile(baseline, 50),
				p95: percentile(lookup, 95) - percentile(baseline, 95),
			},
		};
		// 判断材料を issue へ転記するための実測 report (絶対閾値 gate にはしない、ADR-0065)
		console.log(`[M3 latency report] ${JSON.stringify(report, null, 1)}`);
		// vitest reporter は PASS test の stdout を抑制することがあるため file にも残す (git 管理外 tmp/)
		writeFileSync('tmp/m3-latency-report.json', JSON.stringify(report, null, 1));
		// 健全性 bound のみ (回線劣化検出。covering index 要否は baseline 差分で人が判断する)
		expect(report.lookupMs.p95).toBeLessThan(2_000);
	}, 300_000);
});
