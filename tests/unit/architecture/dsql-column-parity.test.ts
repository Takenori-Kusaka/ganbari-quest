// tests/unit/architecture/dsql-column-parity.test.ts
// EPIC #3424 (M4 column-parity fitness) / 設計 SSOT: docs/design/dsql/m3-physical-model.md §3.4 / §4 / §P2 / §P7 / §8
//
// fitness#(column-parity)「SQLite SSOT ⇔ DSQL schema 列 parity」:
//   board が手動 diff で 2 度の未文書化 column drop を捕捉した構造的欠陥への機械強制。
//     - M4-A: child_challenges.targetConfig を列展開した際に genMissStreak(#3203 救済入力) を silent drop
//     - PR4:  checklist_templates.source_preset_id が DSQL schema から欠落
//   どちらも「人手 diff で偶然気付いた」= 注意依存 (ADR-0061 §band-aid: 再発防止を人の注意に委ねない)。
//   本 fitness は SQLite SSOT の各列が DSQL schema に存在することを CI で hard-fail し、
//   repo 層以降のデータ喪失を構造的に封殺する (route-db-boundary.test.ts #3152 / pk-freeze-manifest #3512 と同型)。
//
//   検査は両 schema module の export 表を走査する (children 固定列挙にしない) ため、
//   Phase B/C で表を追記しても本テストの変更なしで自動カバーされる。
//
// ── 2 種の不変条件 ──
//   [parity]   同名論理表について SQLite SSOT の各 DB 列名が DSQL に存在する。存在しない列は
//              allowlist (M3 意図的 drop/rename) に無ければ hard-fail (未文書化 column drop 検出)。
//   [json据置] genMissStreak クラスの regression guard。SQLite で構造化 JSON/値オブジェクトを
//              持つ列が DSQL でも単一 text 列のまま (複数列展開・jsonb 化・子表化されていない) こと。
//
// ── allowlist の運用 (baseline-pin) ──
//   allowlist = M3 が意図した drop/rename の閉集合。新規の未説明 drop 1 件で fail する。
//   allowlist への追加は必ず M3 根拠 (docs/design/dsql/m3-physical-model.md の該当 §) を
//   コメントで明記すること (根拠なき allowlist 追加はレビューで [must] 指摘)。

import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig as pgTableConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as sqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as dsqlSchema from '../../../src/lib/server/db/dsql/schema';
import * as sqliteSchema from '../../../src/lib/server/db/schema';

// ── allowlist: M3 が意図した drop/rename (根拠付き閉集合) ──

/**
 * 全 shared 表に一律適用される機械的 drop/rename (M3 物理写像規約)。
 * これらは「どの表でも SQLite にあり DSQL に無くて正当」な列。
 */
const GLOBAL_ALLOWED_DROPS: ReadonlySet<string> = new Set([
	// §P2: SERIAL/連番採番型なし → 代理 PK は UUID。int autoincrement `id` は全表で撤去され
	//       複合/自然/UUID PK に置換される (counter.ts + padId 採番全廃)。
	'id',
	// §3.4 / ADR-0063: テナント表の PK 先頭を `family_id uuid` に統一。旧 `tenant_id` (text) は
	//       family_id へ rename・前置される。DSQL 側に family_id として存在する (名前が変わるだけ)。
	//       ※ stripe_webhook_events のように DSQL でも tenant_id を残す表は「存在する」ので
	//         そもそも missing 判定にならず本 allowlist は参照されない。
	'tenant_id',
	// §8: DSQL は OCC (楽観ロック) を採らないため `_sv` (version 列) を撤去。
	'_sv',
]);

/**
 * 表固有の意味的 drop (機械規約でなく設計判断)。M3 の該当 § を必ず併記する。
 */
const TABLE_SPECIFIC_ALLOWED_DROPS: Readonly<Record<string, readonly string[]>> = {
	// §P7 / D-AGE: children は年齢を列で持たない (compute-on-read)。birth_date が唯一の年齢ソース。
	//   日次 drift ゆえ派生列 materialize と非両立 → age 列撤去 + 年齢帯 cron 撤去。
	//   ※ market_benchmarks.age は DSQL でも保持 (グローバル master の自然キー) のため missing 判定にならない。
	children: ['age'],
};

/**
 * genMissStreak クラスの regression guard 対象。SQLite で構造化 JSON / 値オブジェクトを持ち、
 * M3 §4 で「列展開 / jsonb 化 / 子表化を禁じ text 据置」と確定した列。DSQL で単一 text 列の
 * ままであることを assert する。列展開すれば [parity] で列消失として捕捉されるが、jsonb 化は
 * 名前が残るため本 invariant で別途 hard-fail する (backup verbatim 移送 §9.1 破壊防止)。
 */
const JSON_STAYPUT_COLUMNS: ReadonlyArray<{ table: string; column: string; note: string }> = [
	{
		table: 'children',
		column: 'display_config',
		note: '§4 [must]A: cardSize/itemsPerCategory/collapsible。初版列展開が #2148 全消失を招いた',
	},
	{
		table: 'evaluations',
		column: 'scores_json',
		note: '§4 R-EVALUATION: 子表 evaluation_scores を作らない (原初喪失の現場)',
	},
	{
		table: 'checklist_logs',
		column: 'items_json',
		note: '§4 R-CHECKLIST_ITEM_RESULT: 子表 checklist_log_items を作らない',
	},
	{
		table: 'daily_battles',
		column: 'player_stats_json',
		note: '§4 R-DAILY_BATTLE: BattleStats opaque 値オブジェクト',
	},
	{
		table: 'child_challenges',
		column: 'target_config',
		note: '§4 R-CHILD_CHALLENGE: genMissStreak/genMode/activityId/ageAdjustments の silent drop 防止 (M4-A の現場)',
	},
	{
		table: 'child_challenges',
		column: 'reward_config',
		note: '§4 R-CHILD_CHALLENGE: { points, message? } を丸ごと据置',
	},
];

/**
 * M3 §4 で「作らない」と明記された子表名。DSQL schema にこれらが出現したら子表化 = データ喪失
 * パターンの復活として hard-fail する (R-EVALUATION_SCORE / R-CHECKLIST_ITEM_RESULT)。
 */
const FORBIDDEN_CHILD_TABLES: ReadonlySet<string> = new Set([
	'evaluation_scores',
	'checklist_log_items',
]);

// ── schema 走査 (temporal-parity #6 / pk-freeze #9 と同一パターンを reuse) ──
// filter 後に型アサーションするのは、export ごとに具体的な *TableWithColumns<{name:...}> 型を
// 持つため型述語 (v is PgTable) が svelte-check エラーになるのを避けるため (fitness#6 コメント参照)。
// filter 後に InstanceType<typeof *Table> へ cast する (pk-freeze #9 [3] と同一手法)。export ごとに
// 具体的な *TableWithColumns<{name:...}> 型を持つため型述語 (v is *Table) が svelte-check エラーに
// なるのを避けつつ any を使わない。
const pgTables = Object.values(dsqlSchema).filter((v) => is(v, PgTable)) as InstanceType<
	typeof PgTable
>[];
const sqliteTables = Object.values(sqliteSchema).filter((v) => is(v, SQLiteTable)) as InstanceType<
	typeof SQLiteTable
>[];

/** DSQL 側 表名 → DB 列名 Set */
const pgColumnsByTable = new Map<string, Set<string>>(
	pgTables.map((t) => [getTableName(t), new Set(pgTableConfig(t).columns.map((c) => c.name))]),
);
/** DSQL 側 表名 → (列名 → columnType) */
const pgColumnTypeByTable = new Map<string, Map<string, string>>(
	pgTables.map((t) => [
		getTableName(t),
		new Map(pgTableConfig(t).columns.map((c) => [c.name, c.columnType])),
	]),
);
const pgTableNames = new Set<string>(pgTables.map((t) => getTableName(t)));

/** SQLite 列が M3 の意図的 drop として allowlist されているか */
const isAllowedDrop = (table: string, column: string): boolean =>
	GLOBAL_ALLOWED_DROPS.has(column) ||
	(TABLE_SPECIFIC_ALLOWED_DROPS[table]?.includes(column) ?? false);

describe('fitness(column-parity): SQLite SSOT ⇔ DSQL 列 parity (§3.4 / §4 / M4 未文書化 column drop 封殺)', () => {
	it('両 schema に走査対象の表が存在する (vacuous pass 防止)', () => {
		expect(pgTables.length).toBeGreaterThan(0);
		expect(sqliteTables.length).toBeGreaterThan(0);
	});

	it('[parity] 同名論理表の SQLite 各列が DSQL に存在する (欠落は allowlist 必須)', () => {
		const violations: string[] = [];
		let sharedTableCount = 0;
		let checkedColumnCount = 0;

		for (const sqliteTable of sqliteTables) {
			const name = getTableName(sqliteTable);
			// DSQL に同名表が無い = 表ごと意図的 drop (activities/achievements/report_daily_summaries 等)。
			// 本 fitness は「列 drop」を対象とするため、表単位の drop は scope 外 (pk-freeze / 別途)。
			if (!pgTableNames.has(name)) continue;
			sharedTableCount++;

			const dsqlColumns = pgColumnsByTable.get(name) ?? new Set<string>();
			for (const col of sqliteTableConfig(sqliteTable).columns) {
				checkedColumnCount++;
				if (dsqlColumns.has(col.name)) continue;
				if (isAllowedDrop(name, col.name)) continue;
				violations.push(`${name}.${col.name}`);
			}
		}

		// 走査の空振り防止: children / checklist_templates 等の shared 表が確実に検査されている。
		expect(sharedTableCount).toBeGreaterThanOrEqual(30);
		expect(checkedColumnCount).toBeGreaterThan(0);
		expect(
			violations,
			'SQLite SSOT にあり DSQL に無い列 (未文書化 column drop)。意図的なら M3 根拠付きで allowlist に追加、' +
				'そうでなければ DSQL schema に列を追加せよ (genMissStreak / source_preset_id クラスの再発)',
		).toEqual([]);
	});

	it('[parity] allowlist が実際に消費されている (over-broad allowlist / 死んだ allowlist 検出)', () => {
		// children.age (table-specific) と id/tenant_id/_sv (global) が現 schema で実際に drop されている
		// ことを確認し、allowlist が「効いている」= 現実の drop を説明していることを裏取りする。
		const childrenDsql = pgColumnsByTable.get('children') ?? new Set<string>();
		expect(childrenDsql.has('age'), 'children.age は DSQL で drop 済 (§P7 compute-on-read)').toBe(
			false,
		);
		expect(childrenDsql.has('_sv'), 'children._sv は DSQL で drop 済 (§8 OCC 撤去)').toBe(false);
		expect(childrenDsql.has('id'), 'children.id は DSQL で drop 済 (§P2 UUID PK)').toBe(false);
		// checklist_templates.tenant_id → family_id rename (SQLite にあり DSQL に無い)。
		const ctSqlite = sqliteTables.find((t) => getTableName(t) === 'checklist_templates');
		if (!ctSqlite) throw new Error('checklist_templates が SQLite schema に存在しない');
		const ctSqliteCols = new Set(sqliteTableConfig(ctSqlite).columns.map((c) => c.name));
		const ctDsql = pgColumnsByTable.get('checklist_templates') ?? new Set<string>();
		expect(ctSqliteCols.has('tenant_id')).toBe(true);
		expect(ctDsql.has('tenant_id')).toBe(false);
		expect(ctDsql.has('family_id'), 'tenant_id は family_id に rename 済 (§3.4)').toBe(true);
	});

	it('[json据置] genMissStreak クラス: 構造化 JSON 列が DSQL で単一 text 列のまま', () => {
		const violations: string[] = [];
		for (const { table, column } of JSON_STAYPUT_COLUMNS) {
			const cols = pgColumnsByTable.get(table);
			const types = pgColumnTypeByTable.get(table);
			if (!cols || !types) {
				violations.push(`${table} (表が DSQL schema に存在しない)`);
				continue;
			}
			if (!cols.has(column)) {
				// 列が消えている = 列展開 (targetConfig → metric/baseTarget/... 等) の疑い。
				violations.push(`${table}.${column} (消失: 列展開の疑い = genMissStreak クラス)`);
				continue;
			}
			const ct = types.get(column);
			if (ct !== 'PgText') {
				// jsonb 化等。backup verbatim 移送 (§9.1) を破壊し SQLite parity も崩れる。
				violations.push(`${table}.${column} (columnType=${ct}、text 据置でない)`);
			}
		}
		expect(
			violations,
			'M3 §4 [must]A: 値オブジェクト JSON 列は列展開/jsonb 化せず text 据置 (原初喪失の再来防止)',
		).toEqual([]);
	});

	it('[json据置] M3 §4 で禁じた子表 (evaluation_scores / checklist_log_items) が DSQL に存在しない', () => {
		const present = [...FORBIDDEN_CHILD_TABLES].filter((name) => pgTableNames.has(name));
		expect(
			present,
			'M3 §4 R-EVALUATION_SCORE / R-CHECKLIST_ITEM_RESULT: 子表化は原初喪失の現場ゆえ禁止',
		).toEqual([]);
	});
});
