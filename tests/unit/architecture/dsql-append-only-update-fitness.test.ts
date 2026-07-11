// tests/unit/architecture/dsql-append-only-update-fitness.test.ts
// #3646 / M3 §3.4 — 追記性 (UPDATE 禁止) の静的 fitness function (ADR-0061)。
//
// UPDATE_EXCLUDED_TABLES (app-role.ts SSOT) の表は本番 GRANT で UPDATE 権限を持たない。
// repo 層にこれらの表への UPDATE を書くと **staging/本番で初めて権限エラーになる** ため、
// CI 段階で dsql repo source を走査して検出する (shift-left)。GRANT (runtime) と本テスト
// (static) の両輪で台帳・同意・履歴の改竄経路を封じる。
//
// 対象: src/lib/server/db/dsql/*.ts の raw SQL (`UPDATE <table>`)。dsql repos は raw sql
// template が主体のため文字列走査で十分 (drizzle .update(table) 形も併せて検出)。
// 誤検出回避: コメント行は除外する。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_EXCLUDED_TABLES } from '../../../src/lib/server/db/dsql/migration/app-role';

const DSQL_DIR = join(__dirname, '../../../src/lib/server/db/dsql');

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

describe('DSQL append-only UPDATE fitness (#3646、M3 §3.4)', () => {
	it('UPDATE 除外表への UPDATE 文が dsql repo 層に存在しない', () => {
		const files = readdirSync(DSQL_DIR).filter((f) => f.endsWith('.ts'));
		const violations: string[] = [];
		for (const file of files) {
			const source = readFileSync(join(DSQL_DIR, file), 'utf-8');
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
		}
		expect(
			violations,
			`UPDATE 除外表 (app-role.ts UPDATE_EXCLUDED_TABLES) への UPDATE を検出しました。` +
				`これらの表は本番 GRANT で UPDATE 権限が無く実行時に権限エラーになります。` +
				`業務上 UPDATE が必要になった場合は app-role.ts の除外リストから外し、` +
				`M3 §3.4 (追記性の物理担保) との整合を設計判断として記録してください。\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
