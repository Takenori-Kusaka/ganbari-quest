// tests/unit/architecture/dsql-txn-work-allowlist.test.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A 粒度(2)) / #3536 (QM Adversarial Review gap 消化)
// 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#7
//
// fitness#7「core txn work 内の await は tx-bound call のみ許す allowlist」:
//   better-sqlite3 は同期ドライバ = 単一接続。runInTransaction の work 内に event loop を
//   yield する await (fetch / 通知 / dynamic import / 別 db) があると、並行 HTTP リクエストの
//   書込が同 txn に混入する (SQLite parity Finding 1)。QM B1: denylist だと `await sleep` /
//   `await db2.x` / helper 経由の transitive await を見逃す → **work 内の全 AwaitExpression は
//   tx binding への直接 call であること、それ以外は fail** の allowlist で機械強制する。
//   `await helper(tx)` も fail (helper 内の transitive await を静的に追えないため、厳格側に倒す)。
//
// #3536 (QM Adversarial Review で検出した AST 走査ギャップ 3 点の消化):
//   gap 1: `for await (const x of iter)` は AwaitExpression でなく ForOfStatement の
//          awaitModifier ゆえ旧走査で見逃していた → 検出対象に追加 (iterable が tx-bound か判定)。
//   gap 2: `await Promise.all([...tx-bound...])` の正当な並行が false-positive で違反検出されていた
//          → array literal 全要素が tx-bound (or ネスト combinator) なら許可 (混在は違反維持)。
//   gap 3: 例外パターンの明示除外機構を設計 → `// fitness7-allow: <理由>` を await 行 or 直上行に
//          置けば当該 await/for-await を除外 (Phase C 実配線時の開発体験を阻害しないため)。
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
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

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

/** Promise.all / allSettled / race / any の combinator (tx-bound 配列を並行 await する正当形)。 */
const PROMISE_COMBINATORS = new Set(['all', 'allSettled', 'race', 'any']);

/**
 * `Promise.all([...])` 等で、引数が array literal かつ全要素が allowlist を通る (tx-bound or
 * ネストした tx-bound な combinator) か判定する。tx-bound 呼び出しの並行実行 (#3536 gap 2) を
 * false-positive から除外する。1 要素でも非 tx-bound (fetch 等) が混ざれば false = 違反。
 * 空配列 (`Promise.all([])`) は event loop を yield しない no-op のため true (許可)。
 */
function isPromiseCombinatorOfTxBound(expr: ts.Expression, txName: string): boolean {
	if (!ts.isCallExpression(expr)) return false;
	const callee = expr.expression;
	if (
		!ts.isPropertyAccessExpression(callee) ||
		!ts.isIdentifier(callee.expression) ||
		callee.expression.text !== 'Promise' ||
		!PROMISE_COMBINATORS.has(callee.name.text)
	) {
		return false;
	}
	const arg = expr.arguments[0];
	if (!arg || !ts.isArrayLiteralExpression(arg)) return false;
	return arg.elements.every((el) => isAllowedAwaitTarget(el, txName));
}

/**
 * await の対象 (または for-await-of の iterable) が allowlist を通るか。
 *  - tx binding への直接 call (`tx.execute(...)` / drizzle fluent chain)
 *  - `Promise.all/allSettled/race/any([... 全て tx-bound ...])` の正当な並行 (#3536 gap 2)
 * txName 未解決 (work が inline でない等) の場合は常に不許可 (厳格側)。
 */
function isAllowedAwaitTarget(expr: ts.Expression, txName: string | undefined): boolean {
	if (!txName) return false;
	return isTxBoundCall(expr, txName) || isPromiseCombinatorOfTxBound(expr, txName);
}

/**
 * source 内の全 `*.runInTransaction(work)` callsite を検出し、work 内の AwaitExpression が
 * tx binding への直接 call 以外なら violation として返す (fitness#7 allowlist)。
 * work が inline arrow / function でない場合 (別関数参照) は静的追跡不能のため violation。
 */
function findTxWorkAwaitViolations(sourceText: string, fileName: string): TxAwaitViolation[] {
	const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
	const violations: TxAwaitViolation[] = [];
	const sourceLines = sourceText.split('\n');

	/** `// fitness7-allow: <理由>` を node 行 or 直上行に持てば明示除外 (#3536 gap 3)。 */
	const isExempted = (node: ts.Node): boolean => {
		const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
		const current = sourceLines[line] ?? '';
		const prev = line > 0 ? (sourceLines[line - 1] ?? '') : '';
		return /fitness7-allow:/.test(current) || /fitness7-allow:/.test(prev);
	};

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
				if (!isAllowedAwaitTarget(n.expression, txName) && !isExempted(n)) {
					report(
						n,
						'work 内の await が tx-bound call でない (fetch/通知/別db/helper 経由は core txn 禁止、§8)',
					);
				}
			} else if (ts.isForOfStatement(n) && n.awaitModifier) {
				// `for await (const x of iter)` は AwaitExpression でなく ForOfStatement の
				// awaitModifier ゆえ AwaitExpression 走査では捕捉されない (#3536 gap 1)。async
				// iteration は各 step で event loop を yield するため iterable が tx-bound でなければ違反。
				if (!isAllowedAwaitTarget(n.expression, txName) && !isExempted(n)) {
					report(
						n,
						'for await...of の iterable が tx-bound でない (async iteration は event loop を yield、§8)',
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

	// ── #3536: for-await-of 検出 (QM Adversarial Review gap 1) ──

	it('for await...of の iterable が tx-bound でない場合を検出する', () => {
		// `for await (const x of iter)` は AwaitExpression ノードでなく ForOfStatement の
		// awaitModifier ゆえ、旧実装 (AwaitExpression のみ走査) は見逃していた。
		const ng = `
			await runner.runInTransaction(async (tx) => {
				await tx.execute(q);
				for await (const row of streamRows()) { void row; }
			});`;
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});

	it('for await...of の iterable が tx-bound call なら許可する', () => {
		const ok = `
			await runner.runInTransaction(async (tx) => {
				for await (const row of tx.stream(q)) { void row; }
			});`;
		expect(findTxWorkAwaitViolations(ok, 'fixture.ts')).toEqual([]);
	});

	// ── #3536: Promise.all 誤検知回避 (QM Adversarial Review gap 2) ──

	it('全要素が tx-bound call の Promise.all は違反 0 (正当な並行処理、false-positive 除外)', () => {
		const ok = `
			await runner.runInTransaction(async (tx) => {
				await Promise.all([tx.execute(a), tx.insert(children).values(r)]);
			});`;
		expect(findTxWorkAwaitViolations(ok, 'fixture.ts')).toEqual([]);
	});

	it('Promise.allSettled / race / any も tx-bound 全要素なら許可する', () => {
		for (const combinator of ['allSettled', 'race', 'any']) {
			const ok = `
				await runner.runInTransaction(async (tx) => {
					await Promise.${combinator}([tx.execute(a), tx.execute(b)]);
				});`;
			expect(findTxWorkAwaitViolations(ok, 'fixture.ts'), combinator).toEqual([]);
		}
	});

	it('Promise.all に非 tx-bound 要素が混ざれば違反として検出する', () => {
		const ng = `
			await runner.runInTransaction(async (tx) => {
				await Promise.all([tx.execute(a), fetch("https://x")]);
			});`;
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});

	it('await Promise.all([]) (空配列 no-op) は違反 0', () => {
		const ok = `
			await runner.runInTransaction(async (tx) => {
				await Promise.all([]);
			});`;
		expect(findTxWorkAwaitViolations(ok, 'fixture.ts')).toEqual([]);
	});

	// ── #3536: allowlist 例外機構 (QM Adversarial Review gap 3) ──

	it('`// fitness7-allow:` コメント (直上行) で明示除外できる', () => {
		const exempted = `
			await runner.runInTransaction(async (tx) => {
				// fitness7-allow: 例外理由をここに書く
				await fetch("https://x");
			});`;
		expect(findTxWorkAwaitViolations(exempted, 'fixture.ts')).toEqual([]);
	});

	it('`// fitness7-allow:` コメント (同一行末尾) で明示除外できる', () => {
		const exempted = `
			await runner.runInTransaction(async (tx) => {
				await fetch("https://x"); // fitness7-allow: 同一行での除外
			});`;
		expect(findTxWorkAwaitViolations(exempted, 'fixture.ts')).toEqual([]);
	});

	it('fitness7-allow を持たない await は依然として違反 (除外は明示行のみ)', () => {
		const ng = `
			await runner.runInTransaction(async (tx) => {
				// fitness7-allow: この行は fetch を除外する
				await fetch("https://x");
				await fetch("https://y");
			});`;
		// 1 行目 fetch は除外、2 行目 fetch は違反 = 1 件残る。
		expect(findTxWorkAwaitViolations(ng, 'fixture.ts').length).toBe(1);
	});
});
