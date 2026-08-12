// tests/unit/architecture/playwright-auth-fixture-spec-exclusion.test.ts
//
// #4485 (第20回リリース監査 / 統合 PR #4484 で検出): `playwright/.auth/*.json` を使う spec を
// local e2e config (`playwright.config.ts`) から除外し忘れる class を lock する。
//
// ## なぜ instance 修正で終わらせないか (ADR-0061 same-class N→guard)
//
// `playwright/.auth/*.json` を作るのは `tests/e2e/auth.setup.ts` で、これは
// **cognito-dev config の `setup` project でしか走らない**。したがって local config
// (playwright.config.ts) に混ざった spec は fixture 不在で必ず ENOENT で落ちる。
//
// 同じ抜けは既に 2 度成立している:
//   - #2346/#2347 stripe-checkout-labels / -monthly-yearly (BASE_TEST_IGNORE のコメントに ENOENT と明記)
//   - #4309 ops-export-authz (統合 PR #4484 の e2e-test ×3 shard を red にした。本 guard の契機)
//
// しかも軽量レーン (feature → develop PR) は e2e を回さないため **統合 PR まで発覚しない**。
// 検出が最も遅い位置に落ちる class なので、instance ではなく class を機械で閉じる。
//
// ## 例外の扱い
//
// spec 側で登録自体を env gate している場合 (describe を条件付きで登録し、local lane では
// auth 依存ブロックを一切登録しない) は local config に載っていても落ちない。これは
// EXEMPT に理由付きで明示する。理由なしの黙った例外は作らない。

import { globSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」/ #4085)。
// unit lane の並列実行で FS を奪い合うと既定 5s を超えるため明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * 除外リストに載せなくてよい spec と、その理由。
 *
 * key = tests/e2e からの相対パス / value = 理由 (空文字・定型 stub は禁止)。
 */
const EXEMPT: Record<string, string> = {
	'auth.setup.ts':
		'fixture の生成側そのもの。cognito-dev config の setup project だけが実行し、local config は testIgnore ではなく testMatch 非該当で触れない',
	'parent-gate.spec.ts':
		'PARENT_GATE_FORCE_ACTIVE=true のときだけ auth 依存 describe を登録する env gate があり、local lane では storageState を要求する describe が 1 つも登録されない (spec 冒頭の registerParentGateTests 分岐)',
};

/** local config の BASE_TEST_IGNORE に列挙された glob (静的な文字列リテラルのみ)。 */
function extractBaseTestIgnoreGlobs(source: string): string[] {
	const block = source.match(/const BASE_TEST_IGNORE = \[([\s\S]*?)\n\];/);
	if (!block) {
		throw new Error(
			'playwright.config.ts の BASE_TEST_IGNORE を解析できませんでした。' +
				'定義の形を変えた場合は本 fitness function の抽出も追随させてください。',
		);
	}
	return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('playwright/.auth fixture を使う spec は local e2e config から除外されている (#4485)', () => {
	const ignoreGlobs = extractBaseTestIgnoreGlobs(
		readFileSync(resolve(REPO_ROOT, 'playwright.config.ts'), 'utf-8'),
	);

	const specFiles = globSync('tests/e2e/**/*.{spec,setup}.ts', { cwd: REPO_ROOT });
	const authDependentSpecs = specFiles
		.filter((file) => readFileSync(resolve(REPO_ROOT, file), 'utf-8').includes('playwright/.auth/'))
		.map((file) => relative('tests/e2e', file).replace(/\\/g, '/'))
		.sort();

	it('抽出が空振りしていない (guard 自体が無効化されていない)', () => {
		expect(authDependentSpecs.length).toBeGreaterThan(5);
		expect(ignoreGlobs.length).toBeGreaterThan(5);
	});

	it('EXEMPT の理由は実体のある文言である (空・stub を許さない)', () => {
		for (const [spec, reason] of Object.entries(EXEMPT)) {
			expect(reason.trim().length, `${spec} の EXEMPT 理由が短すぎます`).toBeGreaterThan(20);
		}
	});

	it('EXEMPT に実在しない spec を残さない (削除された spec の除外理由が腐るのを防ぐ)', () => {
		for (const spec of Object.keys(EXEMPT)) {
			expect(
				authDependentSpecs,
				`EXEMPT の ${spec} は playwright/.auth を参照していません`,
			).toContain(spec);
		}
	});

	it.each(
		authDependentSpecs,
	)('%s は BASE_TEST_IGNORE に載っているか、理由付きで EXEMPT されている', (spec) => {
		if (EXEMPT[spec]) return;

		const basename = spec.split('/').pop() as string;
		const covered = ignoreGlobs.some((g) => g.endsWith(`/${basename}`) || g.endsWith(`/${spec}`));

		expect(
			covered,
			`tests/e2e/${spec} は playwright/.auth/*.json を参照しているのに ` +
				'playwright.config.ts の BASE_TEST_IGNORE から漏れています。\n' +
				'fixture は cognito-dev config の setup project でしか作られないため、local lane では ' +
				'ENOENT で必ず落ちます (#4309 / #2346 と同 class)。\n' +
				`対処: BASE_TEST_IGNORE に '**/${basename}' を追加する。` +
				'env gate 等で local lane では auth 依存 describe を登録しない設計なら、' +
				'本 test の EXEMPT に理由付きで追加する。',
		).toBe(true);
	});
});
