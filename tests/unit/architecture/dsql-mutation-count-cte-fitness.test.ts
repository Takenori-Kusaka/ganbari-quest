// tests/unit/architecture/dsql-mutation-count-cte-fitness.test.ts
// EPIC #3424 / #3625 / 設計 SSOT: ADR-0061 (same-class-N→guard) / ADR-0010 (Pre-PMF)
//
// **mutation 件数取得は DB 側 count(*) 集約に固定する (regression guard)**:
//   DSQL の SqlExecutor は rowCount を公開しないため、DELETE/UPDATE の affected 件数を
//   `RETURNING <col>` + JS `.rows.length` で数える実装が横展開して残存していた (#3625)。
//   長期利用 child の大量明細 retention / tenant 全体 expire 等で削除・更新全行の PK を client に
//   materialize する scale/memory リスクがある。正しい idiom は
//     WITH deleted AS (DELETE/UPDATE ... RETURNING 1) SELECT count(*)::int AS c FROM deleted
//   で DB 側集約し、返るのを単一スカラにすること。
//
//   本 fitness は「dsql repo 内で `.rows.length` を **件数値** として使う (= 比較演算子が続かない)」
//   pattern を CI hard-fail で禁止し、count は CTE 集約へ強制する。存在チェック
//   (`.rows.length === 0` / `> 0` 等、比較演算子が続く) は正当なため許容する。
//   ADR-0061 の「same-class-N→guard」機械化 (#3625 で 8 サイトを sweep 後の再混入防止)。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DSQL_DIR = resolve(REPO_ROOT, 'src/lib/server/db/dsql');

/** `.rows.length` の直後に比較演算子が続けば存在チェック (正当)、続かなければ件数値使用 (禁止)。 */
const COMPARISON_AFTER = /^\s*(===|!==|==|!=|>=|<=|>|<)/;
const ROWS_LENGTH = /\.rows\.length/g;

interface Violation {
	file: string;
	line: number;
	snippet: string;
}

/** source 内の「件数値として使う `.rows.length`」を検出する (存在チェックは除外)。 */
function findBareRowsLengthCounts(source: string, file: string): Violation[] {
	const found: Violation[] = [];
	let m = ROWS_LENGTH.exec(source);
	while (m) {
		const after = source.slice(m.index + m[0].length);
		if (!COMPARISON_AFTER.test(after)) {
			const line = source.slice(0, m.index).split('\n').length;
			const lineStart = source.lastIndexOf('\n', m.index) + 1;
			const lineEnd = source.indexOf('\n', m.index);
			found.push({
				file,
				line,
				snippet: source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
			});
		}
		m = ROWS_LENGTH.exec(source);
	}
	return found;
}

function listDsqlSourceFiles(): string[] {
	if (!existsSync(DSQL_DIR)) return [];
	return readdirSync(DSQL_DIR)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
		.map((f) => resolve(DSQL_DIR, f));
}

describe('DSQL mutation 件数は DB 側 count(*) 集約に固定 (#3625 same-class-N→guard)', () => {
	const files = listDsqlSourceFiles();

	it('[armed] dsql module が実在する (armed-before-use)', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('[fixture] 件数値としての .rows.length を検出できる (非トートロジー証明)', () => {
		const bad = findBareRowsLengthCounts(
			['const r = await db.execute(sql`DELETE ...`);', 'return r.rows.length;'].join('\n'),
			'fixture-repo.ts',
		);
		expect(bad).toHaveLength(1);
		// 存在チェックは誤検出しない
		const ok = findBareRowsLengthCounts('if (r.rows.length === 0) return;', 'fixture-repo.ts');
		expect(ok).toHaveLength(0);
	});

	it('[main] dsql repo は .rows.length を件数値に使わない (count は CTE 集約へ)', () => {
		const violations = files.flatMap((f) =>
			findBareRowsLengthCounts(readFileSync(f, 'utf-8'), basename(f)),
		);
		expect(
			violations,
			[
				'.rows.length を件数値として使う実装を検出 (#3625: DELETE/UPDATE 全行を client に materialize)。',
				'affected 件数は CTE で DB 側集約すること: WITH x AS (DELETE/UPDATE ... RETURNING 1) SELECT count(*)::int AS c FROM x',
				'(存在チェック `.rows.length === 0` / `> 0` は許容):',
				...violations.map((v) => `  ${v.file}:${v.line}  ${v.snippet}`),
			].join('\n'),
		).toEqual([]);
	});
});

// #4030 A-2: 母数がサブディレクトリを取りこぼしていないこと。
//
// `src/lib/server/db/dsql/migration/` には実 SQL を持つ file が存在する
// (`provision.ts` の `INSERT INTO dsql_migrations` 等)。非再帰走査だと**この層が
// 一度も検査されない**。先例は `dsql-append-only-update-fitness.test.ts` (#3658 AC2)。
//
// 母数の assertion を置かないと「違反 0 件」が「守られている」なのか
// 「そもそも見ていない」なのか区別できない (#4084 と同じ形)。
//
// 期待値は **実 FS から導出する** (literal 固定にすると file 追加で陳腐化する、#4030 A-1 と同じ轍)。
describe('#4030 母数: dsql 配下をサブディレクトリまで走査している', () => {
	it('migration/ 配下の .ts が母数にすべて入っている', () => {
		const migrationDir = resolve(DSQL_DIR, 'migration');
		const expected = readdirSync(migrationDir)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
			.map((f) => resolve(migrationDir, f))
			.sort();
		expect(expected.length, 'migration/ に .ts が 1 つも無い (母数の前提が崩れている)').toBeGreaterThan(
			0,
		);

		const collected = new Set(listDsqlSourceFiles());
		const missing = expected.filter((f) => !collected.has(f));
		expect(
			missing,
			'dsql/migration/ 配下が母数から漏れています。非再帰走査だとこの層が一度も検査されません (#4030 A-2)',
		).toEqual([]);
	});
});
