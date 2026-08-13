// tests/unit/architecture/sqlite-tenant-predicate-fitness.test.ts
// #4546 ①: SQLite backend の tenant 述語 fitness function (ADR-0061 same-class-N→guard)。
//
// # なぜ要るか
//
// repo メソッドは `IXxxRepo` の契約で `tenantId: string` を受け取る。**型シグネチャがテナント境界を
// 約束して見える**ので、呼び出し側は「渡したのだから守られる」と読む。ところが SQLite backend は
// 単一テナント前提で `_tenantId` として捨てており、その事実はコメントにしか書かれていなかった
// (PR #4467 の `updateChildAvatarUrlIfMatches` レビュー指摘)。
//
// DSQL 側には `dsql-tenant-predicate-fitness.test.ts` があるが、SQLite 側には同等の gate が無く、
// 「捨ててよい捨て方」と「入れ忘れ」が機械的に区別できない。本 fitness がその区別を作る:
//
//   - 触れるテーブルが `tenant_id` 列を **持つ** → tenant 引数を body で使っていること (= 入れ忘れは違反)
//   - `tenant_id` 列を **持たない** (例: `children`) → 対象外。ただしその免除は
//     「列が本当に無いこと」を schema から assert して支える (§免除の反証可能性)。
//     将来 `tenant_id` を足せば免除が失効し、述語を書くまで CI が落ちる。
//
// # baseline ratchet
//
// 既存違反は `voice-repo` / `sibling-cheer-repo` / `usage-log-repo` 等に広く存在する (#4546 実測)。
// 1 PR で全部直すと 30 メソッド超の巨大 diff になる (docs/CLAUDE.md §巨大 PR 分割ガイドライン) ため、
// **件数を凍結して増加だけを止める** (`base-token-routes-ratchet` と同型)。減らしたら BASELINE を下げる。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

// 単一ディレクトリ走査だが file 数に比例するため明示 timeout を置く
// (SSOT: scripts/lib/ci/repo-scan-test-registry.mjs)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SQLITE_DIR = resolve(REPO_ROOT, 'src/lib/server/db/sqlite');

/**
 * #4546 実測時点の既存違反数 (メソッド単位)。**増やすと CI が落ちる**。
 * burn-down は別 Issue (本 PR の No-gos)。減らしたらこの数を下げる。
 */
const BASELINE_VIOLATIONS = 19;

// ── schema から「tenant_id 列を持つテーブル」を引く (手書き列挙の drift を避ける) ──

/** drizzle の export 変数名 → tenant_id 列を持つか。 */
function collectTenantScopedTableVars(): Set<string> {
	const result = new Set<string>();
	for (const [name, value] of Object.entries(schema)) {
		if (!(value instanceof SQLiteTable)) continue;
		if ('tenantId' in getTableColumns(value)) result.add(name);
	}
	return result;
}

const TENANT_SCOPED_TABLE_VARS = collectTenantScopedTableVars();

// ── source 走査 ──

interface RepoMethod {
	file: string;
	name: string;
	/** 宣言された tenant 引数名 (`tenantId` / `_tenantId`)。無ければ undefined。 */
	tenantParam?: string;
	body: string;
	/** body 内で drizzle query builder に渡されたテーブル変数名。 */
	tables: string[];
}

/**
 * `open` から始まる括弧 / 波括弧の対応が閉じる位置 (閉じ記号の次) を返す。
 * `openIndex` は開き記号の**次**の位置を渡す (深さ 1 から数え始める)。
 */
function findMatchingEnd(src: string, openIndex: number, open: string, close: string): number {
	let depth = 1;
	let i = openIndex;
	while (i < src.length && depth > 0) {
		if (src[i] === open) depth++;
		else if (src[i] === close) depth--;
		i++;
	}
	return i;
}

/** `export (async) function name(...)` の本体を brace 対応で切り出す。 */
function extractExportedFunctions(file: string, src: string): RepoMethod[] {
	const methods: RepoMethod[] = [];
	const header = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: exec ループの定型
	while ((m = header.exec(src)) !== null) {
		const paramsEnd = findMatchingEnd(src, header.lastIndex, '(', ')');
		const params = src.slice(header.lastIndex, paramsEnd - 1);
		const braceStart = src.indexOf('{', paramsEnd);
		if (braceStart === -1) continue;
		const body = src.slice(braceStart + 1, findMatchingEnd(src, braceStart + 1, '{', '}') - 1);
		methods.push({
			file,
			name: m[1] ?? '(anonymous)',
			tenantParam: /(?:^|[,(\s])(_?tenantId)\s*[:?,)]/.exec(params)?.[1],
			body,
			tables: [...body.matchAll(/\.(?:from|update|insert|delete)\(\s*([A-Za-z_]\w*)/g)].flatMap(
				(x) => (x[1] ? [x[1]] : []),
			),
		});
	}
	return methods;
}

function collectMethods(): RepoMethod[] {
	const all: RepoMethod[] = [];
	for (const entry of readdirSync(SQLITE_DIR)) {
		if (!entry.endsWith('.ts')) continue;
		all.push(...extractExportedFunctions(entry, readFileSync(resolve(SQLITE_DIR, entry), 'utf-8')));
	}
	return all;
}

/** tenant 引数を「受け取っているのに使っていない」か。 */
function ignoresTenantParam(method: RepoMethod): boolean {
	if (!method.tenantParam) return false;
	// `_` 接頭辞は未使用の宣言 (biome/tsc の未使用引数規約)。中身も念のため確認する。
	if (method.tenantParam.startsWith('_')) return !method.body.includes(method.tenantParam);
	return !method.body.includes(method.tenantParam);
}

function findViolations(): string[] {
	const violations: string[] = [];
	for (const method of collectMethods()) {
		if (!ignoresTenantParam(method)) continue;
		const tenantTables = [...new Set(method.tables.filter((t) => TENANT_SCOPED_TABLE_VARS.has(t)))];
		if (tenantTables.length === 0) continue;
		violations.push(`${method.file} :: ${method.name} → ${tenantTables.join(', ')}`);
	}
	return violations.sort();
}

describe('SQLite tenant 述語 fitness (#4546 ①)', () => {
	it('tenant_id 列を持つ表を触るメソッドの「tenant 引数を捨てる」違反を baseline で凍結する', () => {
		const violations = findViolations();
		expect(
			violations.length,
			[
				`SQLite repo の tenant 述語違反が ${violations.length} 件 (baseline ${BASELINE_VIOLATIONS} 件)。`,
				'',
				'増えている場合: 追加したメソッドが tenant_id 列を持つ表を触りながら tenantId 引数を捨てている。',
				'  → WHERE / INSERT の値に tenantId を載せること (捨ててよいのは列が無い表だけ)。',
				'減っている場合: BASELINE_VIOLATIONS をその数まで下げること (ratchet-down)。',
				'',
				violations.map((v) => `  - ${v}`).join('\n'),
			].join('\n'),
		).toBe(BASELINE_VIOLATIONS);
	});

	// ── 免除の反証可能性 ──
	//
	// `children.avatar_url` の CAS (`updateChildAvatarUrlIfMatches`) が tenantId を WHERE に
	// 入れていないのは、SQLite の `children` に `tenant_id` 列が無いからであって「入れ忘れ」ではない。
	// **その主張を検査に変える**: 列を足した瞬間に本 test が落ち、述語を書くことを要求する。
	it('children に tenant_id 列が無い (無いからこそ image-repo の述語免除が成立する)', () => {
		expect(
			'tenantId' in getTableColumns(schema.children),
			[
				'SQLite の children に tenant_id 列が追加された。',
				'この列の追加で「列が無いから述語を書けない」という免除は失効する。',
				'src/lib/server/db/sqlite/image-repo.ts の updateChildAvatarUrl /',
				'updateChildAvatarUrlIfMatches / findChildForImage の WHERE に tenantId を追加し、',
				'本 test の免除ケースを削除すること (DSQL 側は family_id = tenantId で既に述語を持つ)。',
			].join('\n'),
		).toBe(false);
	});

	it('マルチテナントで動く DSQL / PGlite 側は children の全アクセスに family_id 述語を持つ', () => {
		const dsql = readFileSync(resolve(REPO_ROOT, 'src/lib/server/db/dsql/image-repo.ts'), 'utf-8');
		// children を触る SQL 文は全て family_id を伴うこと (SQLite 側の免除が
		// 「実際にマルチテナントな backend でも緩い」に波及していないことの確認)。
		// SQL は template literal なので、文の終端 = 次のバッククォート。窓を固定長にすると
		// 隣の文の family_id を拾って violation を見逃す (実際に見逃した)。
		const childrenStatements = [...dsql.matchAll(/(?:UPDATE|FROM)\s+children\b[^`]*/g)].map(
			(x) => x[0],
		);
		expect(childrenStatements.length).toBeGreaterThan(0);
		for (const statement of childrenStatements) {
			expect(statement, `children を触る文に family_id 述語が無い:\n${statement}`).toMatch(
				/family_id\s*=\s*\$\{tenantId\}/,
			);
		}
	});
});
