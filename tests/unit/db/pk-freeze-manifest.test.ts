// tests/unit/db/pk-freeze-manifest.test.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.2 / §13.1(fitness#9)
//
// fitness#9「PK-freeze drift manifest」(ADR-0061 §結果: §P1 唯一の不可逆不変条件を機械強制):
//   DSQL は PK = 物理レイアウトで後変更不可 (§P1)。よって設計書 §11.2 の凍結 PK 表を
//   機械可読な manifest (SSOT) に写経し、drizzle schema の PK が manifest と一致することを
//   CI で hard-fail する。凍結逸脱を人手 review に委ねない (route-db-boundary.test.ts #3152 と同型)。
//   PK 変更は「manifest 更新 + migration ADR」を人手で強制する唯一の点として残す (§12.5)。
//
// ── Canon TDD test list (t-wada / List→Red→Green→Refactor) ──
//   [1] manifest が存在し children の PK = (family_id, child_id) を宣言する        ← 本 red
//   [2] manifest の全テナント表 PK が §11.2 の凍結 PK と一致する (自然複合/UUID 昇格)
//   [3] drizzle pg-core schema の各表 PK == manifest (schema→manifest drift 検出)
//   [4] drizzle sqlite-core schema の各表 PK == manifest (両 backend で同一論理 PK)
//   [5] グローバル master (categories(code) 等) / auth (users(user_id) 等) は family_id 先頭でない例外
//   [3][4] は pg/sqlite schema 実装後 (#3512 green) に triangulate で追加する。
//
// [2] の実装方式 (2026-07-02 cycle-5): §11.2 の markdown 表を test 内 parser で機械抽出し
//   manifest と完全一致を assert する。写経の二重化 (test にも PK 表を hardcode) ではなく
//   「設計書 SSOT ↔ 機械可読 manifest」の drift を CI が直接検出する (ADR-0001 設計書 SSOT)。
//   設計書の PK 変更 / manifest の勝手な変更のどちらも即 fail し、両者同時更新を人手強制する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/design/dsql-data-model.md §11.2 の PK 凍結表 (markdown) から
 * 「テナント表名 → 凍結 PK 列リスト」を抽出する。
 *
 * 抽出対象 = 確定 PK 列が `(family_id, ...)` backtick tuple で書かれた行のみ。
 * 以下は §11.2 上の記載により対象外 (manifest にも入れない):
 *   - report_daily_summaries (**廃止**、§7) / achievements 系 (drop 確定、§10-10)
 *   - Family 系まとめ行 (`<natural or uuid>` placeholder = §11.3 で確定、未凍結)
 *   - グローバル master 行 (確定 PK 列が tuple でない「自然キー」表記)
 */
const parseFrozenPkTable = (): Record<string, string[]> => {
	const doc = readFileSync(join(__dirname, '../../../docs/design/dsql-data-model.md'), 'utf-8');
	const lines = doc.split('\n');
	const start = lines.findIndex((l) => l.includes('§11.2 全テナント表 PK 凍結表'));
	const end = lines.findIndex((l, i) => i > start && l.includes('§11.3 per-column 完全 DDL'));
	expect(start, '§11.2 見出しが設計書に存在する').toBeGreaterThanOrEqual(0);
	expect(end, '§11.3 見出しが設計書に存在する').toBeGreaterThan(start);

	const frozen: Record<string, string[]> = {};
	for (const line of lines.slice(start, end)) {
		if (!line.startsWith('|')) continue;
		const cells = line.split('|').map((c) => c.trim());
		// cells[0] は空 ('|' 先頭)、cells[1] = 表名、cells[2] = 確定 PK
		const rawName = cells[1] ?? '';
		const rawPk = cells[2] ?? '';
		// 確定 PK が backtick の (col, col, ...) tuple である行だけが凍結対象。
		const m = rawPk.match(/^`\(([^)<]+)\)`$/);
		if (!m) continue;
		// 表名: `activity_pref (child_activity_preferences)` は括弧内の実表名を採用。
		// `**child_custom_voices**（**§3 欠落→編入**）` は強調 + 全角括弧注記を除去。
		const paren = rawName.match(/\(([a-z0-9_]+)\)/);
		const name = paren
			? paren[1]
			: rawName
					.replace(/\*\*/g, '')
					.replace(/（[^）]*）/g, '')
					.trim();
		expect(name, `表名が snake_case で抽出できる: "${rawName}"`).toMatch(/^[a-z0-9_]+$/);
		// PK 列: `ledger_id uuid[v4]` / `activity_id uuid` 等の型注記を落とし列名のみ。
		const cols = m[1].split(',').map((part) => part.trim().split(/\s+/)[0]);
		frozen[name] = cols;
	}
	return frozen;
};

describe('fitness#9: PK 凍結 manifest (§11.2 / §P1 不可逆不変条件)', () => {
	it('[1] manifest が存在し children の PK = (family_id, child_id) を宣言する', async () => {
		// red: manifest module は #3512 green で新設する。現状は存在せず import が throw する。
		const mod = await import('../../../src/lib/server/db/pk-freeze-manifest');
		const manifest = mod.PK_FREEZE_MANIFEST as Record<string, readonly string[]>;

		// children は child_id が ~20 表の複合 PK 先頭の linchpin (§12.2.1 I-1)。
		// UUID v4 child_id (§P3 時刻列を PK に入れない) + family_id 先頭 (§P2 複合 tenant PK)。
		expect(manifest.children).toEqual(['family_id', 'child_id']);
	});

	it('[2] manifest == §11.2 凍結 PK 表 (設計書 SSOT ↔ manifest の双方向 drift 検出)', async () => {
		const { PK_FREEZE_MANIFEST } = await import('../../../src/lib/server/db/pk-freeze-manifest');
		const frozen = parseFrozenPkTable();

		// parser の空振り防止: children linchpin + 代表的な自然複合 PK 表が必ず抽出される。
		expect(frozen.children).toEqual(['family_id', 'child_id']);
		expect(frozen.daily_battles).toEqual(['family_id', 'child_id', 'date']);
		expect(Object.keys(frozen).length).toBeGreaterThanOrEqual(30);

		// 完全一致 (キー集合 + 各 PK 列順)。設計書だけ変えても manifest だけ変えても fail する。
		expect({ ...PK_FREEZE_MANIFEST }).toEqual(frozen);
	});

	it('[2b] 全テナント表の PK 先頭は family_id (§P2 複合 tenant PK)', async () => {
		const { PK_FREEZE_MANIFEST } = await import('../../../src/lib/server/db/pk-freeze-manifest');
		for (const [table, pk] of Object.entries(PK_FREEZE_MANIFEST)) {
			expect(pk[0], `${table} の PK 先頭`).toBe('family_id');
		}
	});

	it('[3] drizzle pg-core (DSQL) schema の全表 PK == manifest (drift 検出)', async () => {
		const { PgTable, getTableConfig } = await import('drizzle-orm/pg-core');
		const { is, getTableName } = await import('drizzle-orm');
		const dsqlSchema = await import('../../../src/lib/server/db/dsql/schema');
		const { PK_FREEZE_MANIFEST } = await import('../../../src/lib/server/db/pk-freeze-manifest');
		const manifest = PK_FREEZE_MANIFEST as Record<string, readonly string[]>;

		// dsql/schema.ts に実装された全 pg 表を走査 (表追記時に本テスト変更なしで自動カバー)。
		const pgTables = Object.values(dsqlSchema).filter((v): v is InstanceType<typeof PgTable> =>
			is(v, PgTable),
		);
		expect(pgTables.length).toBeGreaterThan(0);

		for (const table of pgTables) {
			const name = getTableName(table);
			const cfg = getTableConfig(table);
			const pkCols = cfg.primaryKeys[0]?.columns.map((c) => c.name) ?? [];
			expect(manifest[name], `${name} は manifest (§11.2) に凍結宣言がある`).toBeDefined();
			expect(pkCols, `${name} の PK == manifest`).toEqual([...(manifest[name] ?? [])]);
		}
	});
});
