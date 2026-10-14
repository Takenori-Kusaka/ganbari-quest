// #4570: workflow の `run:` 本文への `${{ }}` 直接埋め込みを検出する gate の回帰テスト。
//
// 検査そのものが空振りしていないこと (違反を実際に拾う) と、現在の workflow が全件クリーンで
// あること (残置が無い) の両方を固定する。

import { describe, expect, it } from 'vitest';
import { checkWorkflows } from '../../../scripts/check-workflow-run-expressions.mjs';
import {
	findRunExpressionViolations,
	isRiskyExpression,
} from '../../../scripts/lib/ci/workflow-run-expressions.mjs';

/** `${{ expr }}` を組み立てる (リテラルで書くと biome の noTemplateCurlyInString に当たる)。 */
const expr = (e: string) => `$${'{'}{ ${e} }}`;

const wf = (run: string) =>
	`jobs:\n  j:\n    steps:\n      - name: s\n        run: |\n${run
		.split('\n')
		.map((l) => `          ${l}`)
		.join('\n')}\n`;

describe('isRiskyExpression', () => {
	it.each([
		'github.base_ref',
		'github.head_ref',
		'github.ref',
		'github.ref_name',
		'github.event.pull_request.title',
		'github.event.inputs.sha',
		'inputs.sha',
		'steps.app-token.outputs.token',
		'needs.build.outputs.version',
		'inputs.sha || github.sha',
	])('%s は run: 本文に直接置けない', (expr) => {
		expect(isRiskyExpression(expr)).toBe(true);
	});

	it.each([
		'github.event.pull_request.number',
		'github.event.number',
		'github.event.pull_request.head.sha',
		'github.event.pull_request.base.sha',
		'github.sha',
		'github.run_id',
		'github.repository',
		'github.actor',
		'matrix.shard',
		'env.DOMAIN_NAME',
		'vars.USE_LOOKUP_KEY',
		'secrets.CRON_SECRET',
	])('%s は書式が固定 / 管理者が決める値なので許す', (expr) => {
		expect(isRiskyExpression(expr)).toBe(false);
	});
});

describe('findRunExpressionViolations', () => {
	it('block scalar の run: 本文の危険な式を行番号つきで返す', () => {
		const v = findRunExpressionViolations(wf(`git fetch origin ${expr('github.base_ref')}\necho ok`));
		expect(v).toHaveLength(1);
		expect(v[0]?.expr).toBe('github.base_ref');
		expect(v[0]?.line).toBe(6);
	});

	it('1 行 inline の run: も検査する', () => {
		const v = findRunExpressionViolations(
			`steps:\n  - run: git push https://x:${expr('steps.app-token.outputs.token')}@github.com/x.git\n`,
		);
		expect(v.map((x) => x.expr)).toEqual(['steps.app-token.outputs.token']);
	});

	it('env: 経由で渡した値は run: 本文に出ないので通す', () => {
		const text = `steps:
  - name: s
    env:
      BASE_BRANCH: \${{ github.base_ref }}
    run: |
      git fetch origin "$BASE_BRANCH"
`;
		expect(findRunExpressionViolations(text)).toEqual([]);
	});

	it('run: ではない with: script: (github-script) は対象外', () => {
		const text = `steps:
  - uses: actions/github-script@v7
    with:
      script: |
        const n = '\${{ github.base_ref }}';
`;
		expect(findRunExpressionViolations(text)).toEqual([]);
	});

	it('run: の次の step に出た式まで巻き込まない', () => {
		const text = `steps:
  - name: a
    run: echo a
  - name: b
    with:
      ref: \${{ github.head_ref }}
`;
		expect(findRunExpressionViolations(text)).toEqual([]);
	});
});

describe('リポジトリの workflow (残置 0 件)', () => {
	it('全 workflow の run: 本文に危険な式展開が無い', () => {
		const { scanned, violations } = checkWorkflows();
		expect(scanned, '検査対象が 0 件 = 検査の空振り').toBeGreaterThan(0);
		expect(violations).toEqual([]);
	});
});
