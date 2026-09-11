// tests/unit/architecture/e2e-worker-db-fixture-ratchet.test.ts
//
// #4489 (統合 PR #4484 で顕在化): E2E spec が `@playwright/test` を直接 import すると
// config 既定の `baseURL` (port 5190 = `data/e2e-worker-0.db`) に固定され、
// **どの worker で走っても worker 0 の server / DB を見る**。
//
// `tests/e2e/fixtures.ts` はこれを直すために作られた (worker fixture で
// `localhost:${5190 + parallelIndex}` と `e2e-worker-${parallelIndex}.db` を配る)。
// しかし移行が途中で止まっており、大半の spec は素の `@playwright/test` のままである。
//
// ## 実害 (推測ではなく実測)
//
// `child-challenge-card-badge.spec.ts` は「完了済チャレンジが無い」negative gating を assert する。
// 一方 `child-challenge-claim-flow` / `-celebration-once` / `child-celebration-click-intercept` は
// `completed=1` の sentinel 行を seed → afterEach で除去する (いずれも `./fixtures` 経由)。
//
// seed 側が worker 0 で sentinel を立てている最中に、card-badge が worker 1 から
// (fixtures 未経由なので) DB 0 を覗くと受取カードが 1 件見え、`toHaveCount(0)` が落ちる。
// worker 内のテストは直列なので、両者が同じ worker に閉じていればこの窓は存在しない。
//
// ## なぜ ratchet か (一括移行しない理由)
//
// 対象は 130 file 超で、一括変換は本 test が守ろうとしている当のもの (E2E の安定性) を
// 一度に賭ける変更になる。**新規増加を止めつつ、触った spec から順に減らす**のが安全。
// 減らしたら baseline も下げる (`base-token-routes-ratchet.test.ts` と同じ運用)。

import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」/ #4085)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * worker 分離 fixture を経由していない spec の上限。
 *
 * **この数値は下げる方向にしか動かさない。** spec を `./fixtures` へ移行したら実測値まで下げる。
 * 引き上げが必要に見えるときは、新規 spec が `@playwright/test` を直接 import している。
 */
const BASELINE = 136;

describe('E2E spec の worker DB 分離 ratchet (#4489)', () => {
	// #4712: `tests/e2e/demo-lambda/**` は別 config (`playwright.demo.config.ts`) で
	// **単一の demo server** (fixture data / DB 書き込みなし) を叩く。worker ごとの DB を
	// 持たないため `tests/e2e/fixtures.ts` の worker 分離は適用対象外 (fixtures を使うと
	// 逆に worker 0 の本番系 baseURL を指してしまう)。本 ratchet の走査から除外する。
	const specs = globSync('tests/e2e/**/*.spec.ts', { cwd: REPO_ROOT }).filter(
		(file) => !file.split('\\').join('/').startsWith('tests/e2e/demo-lambda/'),
	);
	const directImportSpecs = specs
		.filter((file) =>
			/from '@playwright\/test'/.test(readFileSync(resolve(REPO_ROOT, file), 'utf-8')),
		)
		.sort();

	it('走査が空振りしていない (guard 自体が無効化されていない)', () => {
		expect(specs.length).toBeGreaterThan(50);
	});

	it(`\`@playwright/test\` 直 import の spec は ${BASELINE} 件以下である (増やさない)`, () => {
		expect(
			directImportSpecs.length,
			`worker 分離 fixture (tests/e2e/fixtures.ts) を経由しない spec が baseline (${BASELINE}) を超えました。\n` +
				"新規 E2E spec は `import { expect, test } from './fixtures';` を使ってください。\n" +
				'素の `@playwright/test` は config 既定の baseURL (port 5190 = worker 0 の DB) に固定され、\n' +
				'どの worker で走っても worker 0 の DB を見るため、他 spec の一時 seed を観測して落ちます (#4489)。',
		).toBeLessThanOrEqual(BASELINE);
	});

	it('baseline が実測より緩んでいない (移行が進んだら下げる)', () => {
		// 実測が baseline を大きく下回ったまま放置されると ratchet が効かなくなる。
		expect(
			BASELINE - directImportSpecs.length,
			`移行が進んで実測 ${directImportSpecs.length} 件になりました。BASELINE を ${directImportSpecs.length} へ下げてください。`,
		).toBeLessThanOrEqual(5);
	});

	it('共有 DB 状態に negative assertion を置く spec は fixtures 経由である (#4489 の実害 class)', () => {
		// 他 spec が一時的に seed する `completed=1` を観測しうる spec 群。
		// ここに挙げた spec が fixtures を外れると #4484 の落ち方が再発する。
		const mustUseFixtures = [
			'tests/e2e/child-challenge-card-badge.spec.ts',
			'tests/e2e/child-challenge-claim-flow.spec.ts',
			'tests/e2e/child-challenge-celebration-once.spec.ts',
			'tests/e2e/child-celebration-click-intercept.spec.ts',
		];

		for (const spec of mustUseFixtures) {
			const source = readFileSync(resolve(REPO_ROOT, spec), 'utf-8');
			expect(
				/from '\.\/fixtures'/.test(source),
				`${spec} は worker 分離 fixture 経由でなければなりません (#4489)。\n` +
					'この spec 群は child_challenges の completed 状態を seed / assert しあうため、\n' +
					'1 本でも worker 0 固定に戻ると他 worker の in-flight sentinel を観測して落ちます。',
			).toBe(true);
		}
	});
});
