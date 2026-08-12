// tests/unit/architecture/grace-period-dunning-only-writer.test.ts
// #4507 — `grace_period` を書けるのは支払い失敗 (dunning) 経路だけ (ADR-0061 fitness function)
//
// なぜ機械強制するのか:
//   `lifecycle-email-service.isDunningNotice` は `tenant.status === GRACE_PERIOD` **だけ**を見て
//   支払い失敗通知をトランザクション便として送る。すなわち **配信停止 (opt-out) と年 6 回上限の
//   両方を意図的に迂回する**。この迂回が正当なのは「grace_period = 支払い失敗中」が真であり、
//   通知が特定電子メール法上の「取引に関する通知」に当たるからである (#4507)。
//
//   この前提は #3986 で「書き手を dunning 経路に一意化した」ことで成立しているが、
//   **その一意性を固定する test が無かった**。将来 `GRACE_PERIOD` を別事由
//   (移行猶予 / 障害補償 / 運用手動投入 等) で書く実装が入ると、配信停止を明示した顧客へ
//   marketing 相当のメールを送る経路が**静かに合法化**され、迂回の法的根拠だけが失われる。
//   コードコメントの主張ではなく、compiler API による走査で固定する。
//
// 検出器は TypeScript compiler API (既存 devDependency、新規ツールゼロ)。
// 同型: stripe-contract-write-single-enforcement.test.ts (#4026) / route-db-boundary.test.ts (#3152)。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test — 実行時間が入力サイズに比例するため timeout を明示する (#4085)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

/**
 * `grace_period` を status として書いてよい関数 (dunning 経路のみ)。
 *
 * - `handlePaymentFailed`      : `invoice.payment_failed` (W3)
 * - `handleSubscriptionUpdated`: `past_due` の `customer.subscription.updated` (W4)
 *
 * **この allowlist を増やすときは、`lifecycle-email-service` の opt-out 迂回が
 * その新しい事由でも正当かを必ず再判定すること** (支払い失敗でない事由なら、
 * 迂回は特定電子メール法上の根拠を失うので通知経路の側を直す)。
 */
const ALLOWED_WRITERS = ['handlePaymentFailed', 'handleSubscriptionUpdated'];

/** `GRACE_PERIOD` を status 値として**書いている**箇所の、最も内側の関数名を返す。 */
function findGracePeriodStatusWriters(
	source: string,
	fileName: string,
): Array<{ fn: string; line: number }> {
	const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const writers: Array<{ fn: string; line: number }> = [];

	const enclosingFunctionName = (node: ts.Node): string => {
		for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
			if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) {
				return cur.name?.getText() ?? '<anonymous>';
			}
			if (
				(ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
				cur.parent &&
				ts.isVariableDeclaration(cur.parent)
			) {
				return cur.parent.name.getText();
			}
		}
		return '<module-scope>';
	};

	/** `SUBSCRIPTION_STATUS.GRACE_PERIOD` / `'grace_period'` を指す式か。 */
	const isGracePeriodValue = (node: ts.Node): boolean =>
		(ts.isPropertyAccessExpression(node) && node.name.text === 'GRACE_PERIOD') ||
		(ts.isStringLiteral(node) && node.text === 'grace_period');

	const record = (node: ts.Node): void => {
		const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
		writers.push({ fn: enclosingFunctionName(node), line: line + 1 });
	};

	const visit = (node: ts.Node): void => {
		// 書き込みの形は 2 つ:
		//   (a) object literal の `status: <GRACE_PERIOD>` (patch / 更新差分)
		//   (b) `const status: Tenant['status'] = ... GRACE_PERIOD ...` (正規化してから書く)
		// 比較 (`=== GRACE_PERIOD`) は読み取りなので対象外。
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText() === 'status' &&
			isGracePeriodValue(node.initializer)
		) {
			record(node);
		}
		if (
			ts.isVariableDeclaration(node) &&
			node.name.getText() === 'status' &&
			node.initializer &&
			// 三項演算子等を含むので、初期化子の部分木に GRACE_PERIOD が現れるかで見る
			nodeContainsGracePeriod(node.initializer)
		) {
			record(node);
		}
		ts.forEachChild(node, visit);
	};

	const nodeContainsGracePeriod = (node: ts.Node): boolean => {
		if (isGracePeriodValue(node)) return true;
		let found = false;
		ts.forEachChild(node, (child) => {
			if (!found && nodeContainsGracePeriod(child)) found = true;
		});
		return found;
	};

	visit(sf);
	return writers;
}

function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) {
			collectTsFiles(full, acc);
		} else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('grace_period の書き手は dunning 経路だけ (#4507)', () => {
	it('src 配下で status に grace_period を書く関数が allowlist に収まっている', () => {
		const violations: string[] = [];

		for (const file of collectTsFiles(SRC_DIR)) {
			const writers = findGracePeriodStatusWriters(readFileSync(file, 'utf-8'), file);
			for (const { fn, line } of writers) {
				if (!ALLOWED_WRITERS.includes(fn)) {
					violations.push(`${relative(REPO_ROOT, file)}:${line} — ${fn}()`);
				}
			}
		}

		expect(
			violations,
			[
				'grace_period を支払い失敗 (dunning) 以外の事由で書こうとしています。',
				'',
				'lifecycle-email-service の支払い失敗通知は、この status だけを根拠に',
				'配信停止 (opt-out) と年 6 回上限を迂回しています (#4507)。支払い失敗でない事由で',
				'この status を書くと、配信停止を明示した顧客へ送る経路が根拠なく開きます。',
				'',
				'新しい書き手を足す前に、通知側 (isDunningNotice) の条件を',
				'「支払い失敗である」ことまで絞り込んでください。',
				'',
				`検出: ${violations.join(' / ')}`,
			].join('\n'),
		).toEqual([]);
	});

	it('allowlist の関数が実在する (rename で検査が空振りしない)', () => {
		const stripeService = readFileSync(
			resolve(SRC_DIR, 'lib/server/services/stripe-service.ts'),
			'utf-8',
		);
		const writers = findGracePeriodStatusWriters(stripeService, 'stripe-service.ts');

		// 書き手が 0 件になったら、それは rename か検出漏れ。allowlist だけが残ると
		// 「誰でも書けるのに test は緑」になるため、実在を要求する。
		expect(writers.length).toBeGreaterThan(0);
		for (const allowed of ALLOWED_WRITERS) {
			expect(
				writers.some((w) => w.fn === allowed),
				`allowlist の ${allowed}() が grace_period を書いていません (rename されたか、検出器が壊れています)`,
			).toBe(true);
		}
	});
});
