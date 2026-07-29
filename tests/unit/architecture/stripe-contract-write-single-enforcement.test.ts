// tests/unit/architecture/stripe-contract-write-single-enforcement.test.ts
// #4026 — 契約状態の書き換えは単一強制点を通る (ADR-0061 fitness function)
//
// 契約状態 (`families` の status / plan / stripe_subscription_id / plan_expires_at) を
// 各 webhook handler が個別に書いていたため、
//   (1)「この event は tenant の現行契約を指しているか」の突合が handler の任意になり
//   (2)「終端状態とはどの列がどうあることか」が定義されず書き忘れた列が孤児化した
// (#3982 / #4055 は同じ根から出た再発)。
//
// 局所修正では「新しい handler が増えれば同じ抜けが再発する」構造が残るため、
// **`stripe-service.ts` から `updateTenantStripe` を呼べるのは単一強制点 1 箇所だけ**を
// 機械強制する。route-db-boundary.test.ts (#3152) と同型の Architecture Fitness Function で、
// 検出器は TypeScript compiler API (既存 devDependency、新規ツールゼロ)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const STRIPE_SERVICE = resolve(REPO_ROOT, 'src/lib/server/services/stripe-service.ts');

/** 契約状態を書き換える唯一の関数 (この関数の中だけが `updateTenantStripe` を呼べる) */
const ENFORCEMENT_POINT = 'applyTenantContractState';

/** `updateTenantStripe(...)` 呼び出しを含む「最も内側の関数」の名前を全件返す。 */
function findUpdateTenantStripeCallers(source: string, fileName: string): string[] {
	const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const callers: string[] = [];

	const enclosingFunctionName = (node: ts.Node): string => {
		for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
			if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) {
				return cur.name?.getText() ?? '<anonymous>';
			}
			// `const f = () => {}` / `const f = function () {}`
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

	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'updateTenantStripe'
		) {
			callers.push(enclosingFunctionName(node));
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return callers;
}

describe('#4026 契約状態の書き換え単一強制点 (fitness function)', () => {
	it('stripe-service.ts は単一強制点からしか updateTenantStripe を呼ばない', () => {
		const callers = findUpdateTenantStripeCallers(
			readFileSync(STRIPE_SERVICE, 'utf-8'),
			STRIPE_SERVICE,
		);

		// 呼び出しが消えていたら (= 検出器が空振りしていたら) それ自体が異常
		expect(callers.length).toBeGreaterThan(0);
		expect(callers).toEqual(callers.map(() => ENFORCEMENT_POINT));
	});

	it('検出器は強制点を迂回した handler を検出する (非トートロジー証明)', () => {
		// 単一強制点を迂回して直接 repo を叩く新規 handler を意図的に書いた fixture。
		// これが検出されないなら上のテストは常に緑になる (gate が空振りする)。
		const bypassing = `
			async function handleSomethingNew(subscription: { id: string }): Promise<void> {
				await getRepos().auth.updateTenantStripe('t-1', { status: 'active' });
			}
			async function ${ENFORCEMENT_POINT}(): Promise<void> {
				await getRepos().auth.updateTenantStripe('t-1', { status: 'suspended' });
			}
		`;

		const callers = findUpdateTenantStripeCallers(bypassing, 'fixture.ts');

		expect(callers).toContain('handleSomethingNew');
		expect(callers).not.toEqual(callers.map(() => ENFORCEMENT_POINT));
	});
});
