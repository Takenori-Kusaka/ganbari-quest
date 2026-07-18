// tests/unit/architecture/dsql-append-only-update-fitness.test.ts
// #3646 / #3658 / M3 §3.4 — 追記性 (UPDATE 禁止) の静的 fitness function (ADR-0061)。
//
// 2 つの不変条件を CI 強制する:
//
// [A] repo 層に UPDATE 除外表への UPDATE を書かない (static 走査)。
//     UPDATE_EXCLUDED_TABLES (app-role.ts SSOT) の表は本番 GRANT で UPDATE 権限を持たない。
//     repo 層にこれらの表への UPDATE を書くと **staging/本番で初めて権限エラーになる** ため、
//     CI 段階で dsql repo source を走査して検出する (shift-left)。GRANT (runtime) と本テスト
//     (static) の両輪で台帳・同意・履歴の改竄経路を封じる。
//     対象: src/lib/server/db/dsql/**/*.ts の raw SQL (`UPDATE <table>`) + drizzle `.update(table)`。
//     dsql repos は raw sql template が主体のため文字列走査で十分。誤検出回避: コメント行は除外する。
//     #3658 AC2: 走査を **再帰** 化 (migration/ 等サブディレクトリの repo も検査対象に含める。
//     旧実装は readdirSync 非再帰でサブディレクトリを取りこぼしていた)。
//
// [B] schema.ts の全表が UPDATE 除外 / UPDATE 許可 のいずれかに **明示分類** されている
//     (no-silent-gap 分類 fitness、#3658 AC1、admin-resource-model-registry #3134 と同型)。
//     旧来の「除外リストに無い表 = UPDATE 付与」の fail-open では、追記型の新表を追加しても
//     既定で全権 GRANT され台帳改竄防御から silent に漏れる。schema 全表 = 除外 ∪ 許可 かつ
//     両集合 disjoint を assert し、未分類の新表があれば CI red で分類判断を強制する。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
	UPDATE_ALLOWED_TABLES,
	UPDATE_EXCLUDED_TABLES,
} from '../../../src/lib/server/db/dsql/migration/app-role';
import * as dsqlSchema from '../../../src/lib/server/db/dsql/schema';

const DSQL_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../src/lib/server/db/dsql',
);

/** コメント行 (// / *) を落とした実効コード行を返す。 */
function effectiveLines(source: string): { line: string; no: number }[] {
	return source
		.split('\n')
		.map((line, i) => ({ line, no: i + 1 }))
		.filter(({ line }) => {
			const trimmed = line.trim();
			return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
		});
}

/** dir 配下の .ts ファイルを **再帰** 収集する (#3658 AC2、サブディレクトリ対応)。 */
function walkTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) walkTsFiles(full, acc);
		else if (entry.name.endsWith('.ts')) acc.push(full);
	}
	return acc;
}

/** 1 ファイル分の UPDATE 除外表違反を返す (per-file 純関数、走査ロジックの単体検証用)。 */
function findUpdateViolations(source: string, file: string): string[] {
	const violations: string[] = [];
	for (const { line, no } of effectiveLines(source)) {
		for (const table of UPDATE_EXCLUDED_TABLES) {
			// raw SQL: `UPDATE <table>` / drizzle: `.update(<camelCase>)`
			const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
			if (
				new RegExp(`\\bUPDATE\\s+${table}\\b`, 'i').test(line) ||
				new RegExp(`\\.update\\(\\s*${camel}\\s*\\)`).test(line)
			) {
				violations.push(`${file}:${no} → ${table}: ${line.trim()}`);
			}
		}
	}
	return violations;
}

/** drizzle pg-core schema export から全物理表名を抽出する。 */
function schemaTableNames(): Set<string> {
	return new Set(
		Object.values(dsqlSchema)
			.filter((v) => is(v, PgTable))
			.map((t) => getTableName(t as PgTable)),
	);
}

/** 分類ギャップを純関数で算出する (非トートロジー armed proof 用に集合を注入可能にする)。 */
function classifyGap(
	allTables: ReadonlySet<string>,
	excluded: ReadonlySet<string>,
	allowed: ReadonlySet<string>,
): { unclassified: string[]; overlap: string[]; ghost: string[] } {
	const unclassified = [...allTables].filter((t) => !excluded.has(t) && !allowed.has(t)).sort();
	const overlap = [...excluded].filter((t) => allowed.has(t)).sort();
	const ghost = [...excluded, ...allowed].filter((t) => !allTables.has(t)).sort();
	return { unclassified, overlap, ghost };
}

describe('DSQL append-only UPDATE fitness [A] repo 走査 (#3646、M3 §3.4)', () => {
	it('UPDATE 除外表への UPDATE 文が dsql repo 層 (サブディレクトリ含む) に存在しない', () => {
		const violations = walkTsFiles(DSQL_DIR).flatMap((file) =>
			findUpdateViolations(readFileSync(file, 'utf-8'), file.replace(/\\/g, '/')),
		);
		expect(
			violations,
			`UPDATE 除外表 (app-role.ts UPDATE_EXCLUDED_TABLES) への UPDATE を検出しました。` +
				`これらの表は本番 GRANT で UPDATE 権限が無く実行時に権限エラーになります。` +
				`業務上 UPDATE が必要になった場合は app-role.ts の除外リストから外し、` +
				`M3 §3.4 (追記性の物理担保) との整合を設計判断として記録してください。\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('[AC2] 走査は subdirectory (migration/) を含む再帰である', () => {
		// 旧実装 (readdirSync 非再帰) は migration/ 配下の repo を取りこぼしていた。
		// 再帰化の armed proof: 収集ファイルに migration/ 配下が含まれることを固定する。
		const files = walkTsFiles(DSQL_DIR).map((f) => f.replace(/\\/g, '/'));
		expect(files.some((f) => f.includes('/dsql/migration/'))).toBe(true);
	});
});

describe('DSQL append-only UPDATE fitness [B] no-silent-gap 分類 (#3658 AC1、M3 §3.4)', () => {
	const allTables = schemaTableNames();

	it('schema.ts の全表が UPDATE 除外 / UPDATE 許可 のいずれかに分類されている', () => {
		const { unclassified } = classifyGap(allTables, UPDATE_EXCLUDED_TABLES, UPDATE_ALLOWED_TABLES);
		expect(
			unclassified,
			`未分類の表があります。app-role.ts の UPDATE_EXCLUDED_TABLES (append-only) または ` +
				`UPDATE_ALLOWED_TABLES (UPDATE 許可) のいずれかに追加し、台帳改竄防御の対象か否かを ` +
				`明示分類してください (deny-by-default、#3658 AC1):\n  ${unclassified.join('\n  ')}`,
		).toEqual([]);
	});

	it('UPDATE 除外 / 許可 の 2 集合は disjoint (同一表の二重分類なし)', () => {
		const { overlap } = classifyGap(allTables, UPDATE_EXCLUDED_TABLES, UPDATE_ALLOWED_TABLES);
		expect(overlap, `除外と許可の両方に登録された表: ${overlap.join(', ')}`).toEqual([]);
	});

	it('両集合の表は全て schema.ts に存在する (幽霊分類 = rename 追随漏れの検出)', () => {
		const { ghost } = classifyGap(allTables, UPDATE_EXCLUDED_TABLES, UPDATE_ALLOWED_TABLES);
		expect(
			ghost,
			`schema.ts に存在しない表が分類集合に残っています (表 rename/削除の追随漏れ): ${ghost.join(', ')}`,
		).toEqual([]);
	});

	// ── 非トートロジー armed proof (分類 fitness が実際にギャップを検出することの証明) ──

	it('[armed] 未分類の新表を検出する (deny-by-default 分類強制の実効性)', () => {
		const withNewTable = new Set([...allTables, 'brand_new_ledger']);
		const { unclassified } = classifyGap(
			withNewTable,
			UPDATE_EXCLUDED_TABLES,
			UPDATE_ALLOWED_TABLES,
		);
		expect(unclassified).toContain('brand_new_ledger');
	});

	it('[armed] 同一表の二重分類を検出する', () => {
		const { overlap } = classifyGap(
			allTables,
			new Set([...UPDATE_EXCLUDED_TABLES, 'children']),
			UPDATE_ALLOWED_TABLES,
		);
		expect(overlap).toContain('children');
	});

	it('[armed] repo 走査は UPDATE 除外表への .update() を検出する', () => {
		const bad = 'db.update(pointLedger).set({ amount: 0 });';
		expect(findUpdateViolations(bad, 'fixture.ts').length).toBeGreaterThan(0);
		const rawBad = 'await tx.execute(sql`UPDATE consents SET version = 2`);';
		expect(findUpdateViolations(rawBad, 'fixture.ts').length).toBeGreaterThan(0);
		const ok = 'db.update(children).set({ nickname: "x" });';
		expect(findUpdateViolations(ok, 'fixture.ts')).toEqual([]);
	});
});
