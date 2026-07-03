// tests/unit/architecture/dsql-txn-work-allowlist.test.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A 粒度(2)) / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#7
//
// fitness#7「core txn work 内の await は tx-bound call のみ許す allowlist」:
//   better-sqlite3 は同期ドライバ = 単一接続。runInTransaction の work 内に event loop を
//   yield する await (fetch / 通知 / dynamic import / 別 db) があると、並行 HTTP リクエストの
//   書込が同 txn に混入する (SQLite parity Finding 1)。QM B1: denylist だと `await sleep` /
//   `await db2.x` / helper 経由の transitive await を見逃す → **work 内の全 AwaitExpression は
//   tx binding への直接 call であること、それ以外は fail** の allowlist で機械強制する。
//   `await helper(tx)` も fail (helper 内の transitive await を静的に追えないため、厳格側に倒す)。
//
// route-db-boundary.test.ts (#3152) と同型の Architecture Fitness Function。
// 検出器は TypeScript compiler API (既存 devDependency、新規ツールゼロ) の AST 走査。
// 現時点で production の runInTransaction callsite は 0 (Phase C #N4-2 で recordActivity が
// 最初の利用者)。fixture による非トートロジー証明で検出器の実効性を担保し、callsite が
// 生えた瞬間から gate が効く (armed-before-use)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_DIR = resolve(REPO_ROOT, 'src/lib/server');

interface TxAwaitViolation {
	file: string;
	line: number;
	snippet: string;
	reason: string;
}

/** callee のチェーンを根まで辿り、根が識別子 `txName` の call か判定する。
 * drizzle fluent chain (`tx.insert(t).values(r)` = 中間 CallExpression) も根まで unwrap する。 */
function isTxBoundCall(expr: ts.Expression, txName: string): boolean {
	if (!ts.isCallExpression(expr)) return false;
	let callee: ts.Expression = expr.expression;
	for (;;) {
		if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
			callee = callee.expression;
		} else if (ts.isCallExpression(callee)) {
			callee = callee.expression;
		} else {
			break;
		}
	}
	return ts.isIdentifier(callee) && callee.text === txName;
}

/**
 * source 内の全 `*.runInTransaction(work)` callsite を検出し、work 内の AwaitExpression が
 * tx binding への直接 call 以外なら violation として返す (fitness#7 allowlist)。
 * work が inline arrow / function でない場合 (別関数参照) は静的追跡不能のため violation。
 */
function findTxWorkAwaitViolations(sourceText: string, fileName: string): TxAwaitViolation[] {
	const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
	const violations: TxAwaitViolation[] = [];

	const report = (node: ts.Node, reason: string) => {
		const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
		violations.push({
			file: fileName,
			line: line + 1,
			snippet: node.getText(sf).replace(/\s+/g, ' ').slice(0, 80),
			reason,
		});
	};

	const checkWorkBody = (body: ts.Node, txName: string | undefined) => {
		const walk = (n: ts.Node) => {
			if (ts.isAwaitExpression(n)) {
				if (!txName || !isTxBoundCall(n.expression, txName)) {
					report(
						n,
						'work 内の await が tx-bound call でない (fetch/通知/別db/helper 経由は core txn 禁止、§8)',
					);
				}
			}
			ts.forEachChild(n, walk);
		};
		walk(body);
	};

	const isRunInTxCall = (node: ts.CallExpression): boolean => {
		const callee = node.expression;
		return (
			(ts.isPropertyAccessExpression(callee) && callee.name.text === 'runInTransaction') ||
			(ts.isIdentifier(callee) && callee.text === 'runInTransaction')
		);
	};

	const checkWorkArgument = (work: ts.Expression) => {
		if (ts.isArrowFunction(work) || ts.isFunctionExpression(work)) {
			const p = work.parameters[0]?.name;
			const txName = p && ts.isIdentifier(p) ? p.text : undefined;
			checkWorkBody(work.body, txName);
		} else {
			report(
				work,
				'work が inline 関数でない (別関数参照は transitive await を静的追跡できないため inline で書く)',
			);
		}
	};

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && isRunInTxCall(node) && node.arguments[0]) {
			checkWorkArgument(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return violations;
}

function walkTsFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) walkTsFiles(full, acc);
		else if (entry.name.endsWith('.ts')) acc.push(full);
	}
	return acc;
}

describe('fitness#7: runInTransaction work 内 await の tx-bound allowlist (§8 / QM B1)', () => {
	it('src/lib/server 全 production callsite に violation が無い', () => {
		const violations = walkTsFiles(SERVER_DIR, []).flatMap((file) =>
			findTxWorkAwaitViolations(
				readFileSync(file, 'utf-8'),
				relative(REPO_ROOT, file).replace(/\\/g, '/'),
			),
		);
		expect(
			violations,
			`fitness#7 違反 (core txn work 内の非 tx-bound await):\n${violations
				.map((v) => `  - ${v.file}:${v.line} ${v.snippet}\n    → ${v.reason}`)
				.join('\n')}\n→ optional (fetch/通知/別集約) は core commit 後の独立処理へ (§8)`,
		).toEqual([]);
	});

	// ── 非トートロジー証明 (検出器が本当に検出することの fixture 検証) ──

	it('tx-bound call のみの work は違反 0 (allowlist 通過)', () => {
		const ok = `
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql\`INSERT INTO t VALUES (1)\`);
				await tx.insert(children).values(row);
				const n = await tx.select().from(children);
				return n;
			});`;
		expect(findTxWorkAwaitViolations(ok, 'fixture.ts')).toEqual([]);
	});

	it('fetch / 別 db / dynamic import / helper(tx) / sleep の await を検出する', () => {
		const cases: Array<[string, string]> = [
			['await fetch("https://x")', 'fetch'],
			['await db.execute(q)', '別 db (tx でなく module db)'],
			['await import("$lib/server/discord-alert")', 'dynamic import'],
			['await applyBonus(tx)', 'helper 経由 (transitive await 追跡不能)'],
			['await new Promise((r) => setTimeout(r, 10))', 'sleep'],
		];
		for (const [stmt, label] of cases) {
			const src = `await runner.runInTransaction(async (tx) => { ${stmt}; });`;
			const violations = findTxWorkAwaitViolations(src, 'fixture.ts');
			expect(violations.length, `検出漏れ: ${label}`).toBeGreaterThan(0);
		}
	});

	it('tx param 名が tx 以外でも binding 追跡で判定する (名前でなく binding)', () => {
		const ok = 'await runner.runInTransaction(async (trx) => { await trx.execute(q); });';
		expect(findTxWorkAwaitViolations(ok, 'fixture.ts')).toEqual([]);
		const ng = 'await runner.runInTransaction(async (trx) => { await tx.execute(q); });';
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});

	it('work が別関数参照 (inline でない) は violation (静的追跡不能)', () => {
		const ng = 'await runner.runInTransaction(doWork);';
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});

	it('ネストした work (内側の関数) の await も検出する', () => {
		const ng = `
			await runner.runInTransaction(async (tx) => {
				const f = async () => { await fetch("https://x"); };
				await tx.execute(q);
				f();
			});`;
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});
});
