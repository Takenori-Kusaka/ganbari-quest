// src/lib/server/db/migration/data-integrity-guards.ts
//
// startup 時 (`client.ts`) に **`applyLazyStartupMigrations()` の後** に走る
// runtime data orphan 検出 gate (Issue #2519 / #2518 KPT umbrella)。
//
// ## 設計背景 (Issue #2510 NUC activities data 完全消失 — 検出できなかった構造的理由)
//
// 既存の `scripts/check-orphan-tables.mjs` は **static schema の dead table**
// (どの import からも参照されない table 定義) を検出するが、**runtime data の
// orphan row (FK 切れの実 row)** を見ない。このため PR #2487 で
// `activities` → `child_activities` cross-table flip 時に data copy migration
// (4 dimension SSOT の dim 4) が漏れ、4 table の全 row が `child_activities` に
// 存在しない `activity_id` を指す orphan 状態 (= UI 表示 0 + history 完全消失) に
// なっても、CI / startup のどの gate も鳴らなかった (Issue #2510)。
//
// 本 file は **startup ごと** に core 4 table の FK orphan を count し、1 件でも
// 検出すれば fail-loud にする最小十分 gate。dim 4 migration の漏れ / 不完全 copy /
// 別 backend (DynamoDB) からの誤った backfill 等が **「黙って data が消える」前に
// 必ず鳴る** ようにする。
//
// ## 監視対象 (core 4 table 限定、AC6)
//
// `migrateActivityFkSwitchover` (dim 3) で FK target を `child_activities` に
// 切替えた 4 table のみ:
//
//   - activity_logs            (活動記録 = ポイント履歴の事実)
//   - daily_missions           (今日のミッション)
//   - activity_mastery         (熟練度)
//   - child_activity_preferences (ピン留め設定)
//
// **全 table の全 FK を毎起動チェックするのは過剰** (起動が遅くなる + 検出対象が
// 散漫になる) ため採用しない (AC6)。cross-table semantic flip が起きたのは
// `activity_id → child_activities(id)` の 4 table であり、ここが #2510 の爆心地。
// 将来別 table で同型 flip が起きたら本 file の `CORE_ORPHAN_CHECKS` に追加する。
//
// ## 失敗時の挙動
//
// - **常に** `console.error` で orphan 件数を出力 (NUC docker log / CloudWatch に残る)
// - **test 環境** (`NODE_ENV=test` or `VITEST`): throw (CI / unit test で fail-loud)
// - **本番/dev 起動時**: process は止めない (orphan があっても app は起動させ、
//   UI から「見えないだけ」の状態で運用を継続させつつ alert で気付けるようにする)。
//   呼び出し元 (`client.ts`) が `onOrphan` callback 経由で Discord alert を送る。
//
// startup を `process.exit(1)` で止めない理由: orphan は「data が物理削除された」
// のではなく「FK 参照先が無く UI から見えない」状態であり、起動を止めると復旧
// (`scripts/recover-activities-data.mjs` 実行 = app 経由) すらできなくなる。
// alert で人間に気付かせ、runbook で復旧する方針 (ADR-0010 Bucket A、最小十分)。
//
// ## SSOT 注記
//
// orphan 判定 SQL は `docs/runbooks/activities-data-recovery.md` §3.1 /
// `scripts/recover-activities-data.mjs` `ORPHAN_QUERIES` /
// `lazy-startup-migrations.ts` `countOrphans` と同一 (NOT EXISTS で
// `child_activities(id)` を参照しない row を数える)。runtime が異なるため
// import 共有はできないが、判定ロジックを変える際は 3 箇所を同期させること。
// 詳細: docs/design/08-データベース設計書.md §8.6。

import type Database from 'better-sqlite3';

/** orphan 検査対象の 1 table 定義 (core 4 table、AC6)。 */
interface OrphanCheck {
	/** orphan を数える子 table 名 */
	table: string;
	/** 子 table が指す親 table (本 gate では全て child_activities) */
	parentTable: string;
	/** 子 table 側の FK 列 (本 gate では全て activity_id) */
	fkColumn: string;
}

/**
 * core 4 table の orphan 検査定義 (#2510 cross-table flip 爆心地)。
 * いずれも `activity_id` が `child_activities(id)` を参照する。
 */
const CORE_ORPHAN_CHECKS: readonly OrphanCheck[] = [
	{ table: 'activity_logs', parentTable: 'child_activities', fkColumn: 'activity_id' },
	{ table: 'daily_missions', parentTable: 'child_activities', fkColumn: 'activity_id' },
	{ table: 'activity_mastery', parentTable: 'child_activities', fkColumn: 'activity_id' },
	{
		table: 'child_activity_preferences',
		parentTable: 'child_activities',
		fkColumn: 'activity_id',
	},
];

export interface OrphanReport {
	/** table 名 → orphan row 件数 */
	counts: Record<string, number>;
	/** orphan 合計件数 (全 table 合算) */
	total: number;
}

function tableExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

/**
 * 1 table の orphan (parent に存在しない FK 値を持つ row) 件数を返す。
 * 子 table / 親 table いずれかが不在なら 0 (新規 DB / 旧 schema 互換)。
 */
function countOrphanRows(db: Database.Database, check: OrphanCheck): number {
	if (!tableExists(db, check.table) || !tableExists(db, check.parentTable)) {
		return 0;
	}
	const row = db
		.prepare(
			`SELECT COUNT(*) AS c FROM ${check.table} t
			 WHERE NOT EXISTS (
			   SELECT 1 FROM ${check.parentTable} p WHERE p.id = t.${check.fkColumn}
			 )`,
		)
		.get() as { c: number };
	return row.c;
}

/**
 * core 4 table の orphan 件数を集計して返す (副作用なし、純関数)。
 * test / 呼び出し元での assert に使う。
 */
export function collectDataOrphans(db: Database.Database): OrphanReport {
	const counts: Record<string, number> = {};
	let total = 0;
	for (const check of CORE_ORPHAN_CHECKS) {
		const c = countOrphanRows(db, check);
		counts[check.table] = c;
		total += c;
	}
	return { counts, total };
}

export interface AssertNoDataOrphansOptions {
	/**
	 * orphan 検出時に呼ばれる callback (本番/dev 起動経路で Discord alert を送るため)。
	 * `data-integrity-guards.ts` が `discord-alert.ts` を直接 import しない (=
	 * startup module が `$env/dynamic/private` を eager load しない) ための DI hook。
	 * fire-and-forget で良い (本関数は callback の完了を待たない)。
	 */
	onOrphan?: (report: OrphanReport) => void;
	/**
	 * true なら orphan 検出時に throw する (test / CI 用)。
	 * 未指定時は `NODE_ENV === 'test'` または `VITEST` env で自動 true。
	 */
	throwOnOrphan?: boolean;
}

function isTestEnv(): boolean {
	return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/**
 * core 4 table の runtime data orphan を検査する startup gate (#2519 AC4)。
 *
 * - orphan 0 件 → 何もしない (正常起動)
 * - orphan 1 件以上 →
 *   1. **常に** `console.error` で件数を出力 (log に必ず残す)
 *   2. `onOrphan` callback があれば呼ぶ (本番/dev で Discord alert)
 *   3. test 環境 (or `throwOnOrphan: true`) なら Error を throw (CI fail-loud)
 *
 * @returns orphan レポート (件数 0 でも返す)
 */
export function assertNoDataOrphans(
	db: Database.Database,
	options: AssertNoDataOrphansOptions = {},
): OrphanReport {
	const report = collectDataOrphans(db);
	if (report.total === 0) return report;

	const detail = CORE_ORPHAN_CHECKS.map((c) => `${c.table}=${report.counts[c.table] ?? 0}`).join(
		' ',
	);
	const message = `[data-integrity-guard #2519] DATA ORPHAN detected — ${report.total} row(s) reference a missing child_activities(id): ${detail}. See docs/runbooks/activities-data-recovery.md`;

	// 1. 常に console.error (NUC docker log / CloudWatch / app-YYYY-MM-DD.log)
	console.error(message);

	// 2. 本番/dev alert (DI 経由、fire-and-forget)
	if (options.onOrphan) {
		try {
			options.onOrphan(report);
		} catch (err) {
			console.error('[data-integrity-guard #2519] onOrphan callback failed', err);
		}
	}

	// 3. test / CI では throw (fail-loud)
	const shouldThrow = options.throwOnOrphan ?? isTestEnv();
	if (shouldThrow) {
		throw new Error(message);
	}

	return report;
}
