// tests/unit/architecture/stripe-price-resolution-single-entrypoint.test.ts
// #4286 — checkout の Price ID 解決は `getPriceId()` を通る (ADR-0061 fitness function)
//
// `USE_LOOKUP_KEY` flag と lookup_key 解決 (`getPriceId()`) は実装されていたが、製品コードから
// 1 度も呼ばれていなかった (dead wiring)。checkout は `getPlans().priceId` (env var 直読) を
// 見ていたため、price env を注入しない配備 (staging の正規構成) では購入が必ず 400 で失敗した。
// 「flag は宣言されているが経路に繋がっていない」は振る舞い test でも E2E でも緑のまま通るため、
// **呼び出しの存在そのもの**を構造で固定する (stripe-contract-write-single-enforcement と同型)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const STRIPE_SERVICE = resolve(REPO_ROOT, 'src/lib/server/services/stripe-service.ts');

/** Price ID 解決の唯一の入口を呼ぶべき関数 */
const CHECKOUT_ENTRYPOINT = 'createCheckoutSession';

/** 最も内側の「名前のある関数」を辿る (関数外なら `<module-scope>`)。 */
function enclosingFunctionName(node: ts.Node): string {
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
}

function parse(source: string, fileName: string): ts.SourceFile {
	return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

/** 指定した関数名の呼び出しを含む「最も内側の関数」の名前を全件返す。 */
function findCallers(source: string, fileName: string, callee: string): string[] {
	const callers: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const expr = node.expression;
			const name = ts.isIdentifier(expr)
				? expr.text
				: ts.isPropertyAccessExpression(expr)
					? expr.name.text
					: null;
			if (name === callee) callers.push(enclosingFunctionName(node));
		}
		ts.forEachChild(node, visit);
	};
	visit(parse(source, fileName));
	return callers;
}

/** `x.priceId` 形式のプロパティ参照を含む「最も内側の関数」の名前を全件返す。 */
function findPriceIdPropertyReaders(source: string, fileName: string): string[] {
	const readers: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAccessExpression(node) && node.name.text === 'priceId') {
			readers.push(enclosingFunctionName(node));
		}
		ts.forEachChild(node, visit);
	};
	visit(parse(source, fileName));
	return readers;
}

describe('#4286 checkout の Price ID 解決経路 (fitness function)', () => {
	const source = readFileSync(STRIPE_SERVICE, 'utf-8');

	it('createCheckoutSession は getPriceId() で Price ID を解決する', () => {
		// 呼び出しが 0 件 = lookup_key 経路が再び dead wiring に戻った状態。
		// この 1 行が守れないと、price env を持たない配備で購入が必ず失敗する。
		expect(findCallers(source, STRIPE_SERVICE, 'getPriceId')).toContain(CHECKOUT_ENTRYPOINT);
	});

	it('stripe-service.ts は PlanConfig.priceId (env var 直読) を参照しない', () => {
		// `getPlans().priceId` は env var 由来なので、price env を持たない配備では空文字になる。
		// webhook 側の plan 逆引きは `planIdFromPriceId(price.id)` (Stripe payload の id) を使う。
		expect(findPriceIdPropertyReaders(source, STRIPE_SERVICE)).toEqual([]);
	});

	it('検出器は env 直読へ戻した実装を検出する (非トートロジー証明)', () => {
		// 修正前の実装そのもの。これが検出されないなら上 2 つは常に緑になる。
		const regressed = `
			async function ${CHECKOUT_ENTRYPOINT}(input: { planId: string }): Promise<unknown> {
				const plan = getPlans()[input.planId];
				if (!plan?.priceId) return { error: 'INVALID_PLAN' };
				return { line_items: [{ price: plan.priceId, quantity: 1 }] };
			}
		`;

		expect(findCallers(regressed, 'fixture.ts', 'getPriceId')).not.toContain(CHECKOUT_ENTRYPOINT);
		expect(findPriceIdPropertyReaders(regressed, 'fixture.ts')).toContain(CHECKOUT_ENTRYPOINT);
	});
});
