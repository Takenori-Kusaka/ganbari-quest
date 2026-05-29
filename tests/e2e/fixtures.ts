// tests/e2e/fixtures.ts
//
// #2648 Phase A Step A-5: worker-scoped fixture for per-worker SQLite isolation。
//
// 設計根拠 (deep research `a70be0e3278d98fd2` §7.5 + Playwright 公式 fixture pattern):
//
// 1. **worker-scoped fixture (`{ scope: 'worker' }`)**:
//    - test-scoped (default) は test ごとに作り直しコストが発生
//    - worker-scoped は worker session 中 1 回だけ初期化、全 test で共有 = SQLite file path / port を
//      worker session 中 fixed にできる (per-worker DB isolation の自然な対応)
//
// 2. **workerInfo.parallelIndex**:
//    - 0-based、playwright が自動 set
//    - global-setup.ts が `for (i of [0..WORKER_COUNT-1])` で seed した DB file と 1:1 対応
//    - `workerInfo.workerIndex` ではなく `parallelIndex` を使うこと
//      (workerIndex は worker process が retry/再起動した場合の累積 index)
//
// 3. **workerBaseURL**:
//    - playwright config の `use.baseURL` (default = http://localhost:5190) を上書きするための fixture
//    - 各 worker は `http://localhost:${BASE_PORT + parallelIndex}` に接続
//    - これにより worker[0] は port 5190 (worker[0] DB)、worker[1] は port 5191 (worker[1] DB) に隔離
//
// 4. **import 元 spec での切替方法**:
//    - 旧: `import { test, expect } from '@playwright/test';`
//    - 新: `import { test, expect } from './fixtures';`
//    - 既存 spec はそのまま (Step A-6 で pin-activity のみ移植、Phase B で順次)
//
// 5. **base URL の渡し方**:
//    - test 内で `page.goto('/switch')` のような相対 path → fixture `workerBaseURL` を `use.baseURL`
//      に override 注入することで Playwright が自動的に worker 別 port に解決する
//    - これは Playwright の test override pattern `test.use({ baseURL: workerBaseURL })` を fixture
//      内で行う代わりに、context-options override で実現する (workerInfo.parallelIndex 経由)

import path from 'node:path';
import { test as base, expect } from '@playwright/test';

// playwright.config.ts と一致させる必要あり (research §7.5)。
// 将来 dotenv / shared config に集約する候補だが、Phase A scope では 2 箇所 hardcode で OK。
const BASE_PORT = 5190;

type WorkerFixtures = {
	/**
	 * 本 worker が touch すべき SQLite file の絶対 path。
	 * test 内で SQLite を直接読みたい spec (将来追加候補) が参照する。
	 */
	workerDbPath: string;

	/**
	 * 本 worker が接続すべき preview/dev server の base URL。
	 * `http://localhost:${BASE_PORT + parallelIndex}` (e.g. worker[0] = 5190, worker[1] = 5191)。
	 */
	workerBaseURL: string;
};

export const test = base.extend<{ baseURL: string }, WorkerFixtures>({
	workerDbPath: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture system requires `{}` for dependency-free worker fixtures (https://playwright.dev/docs/test-fixtures)
		async ({}, use, workerInfo) => {
			const dbPath = path.resolve(`data/e2e-worker-${workerInfo.parallelIndex}.db`);
			await use(dbPath);
		},
		{ scope: 'worker' },
	],
	workerBaseURL: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture system requires `{}` for dependency-free worker fixtures (https://playwright.dev/docs/test-fixtures)
		async ({}, use, workerInfo) => {
			const url = `http://localhost:${BASE_PORT + workerInfo.parallelIndex}`;
			await use(url);
		},
		{ scope: 'worker' },
	],
	/**
	 * `baseURL` を override し worker fixture の値で配布する。
	 * これにより `import { test } from './fixtures'` した spec の `page.goto('/switch')` 等は
	 * 自動的に `http://localhost:${BASE_PORT + parallelIndex}` 経由で解決される。
	 * = pin-activity が worker[1] (port 5191、DB e2e-worker-1.db) に振り分けられた場合
	 *   並列実行中の他 spec (worker[0] = port 5190 = e2e-worker-0.db) と SQLite file が分離される。
	 *
	 * Playwright 公式 pattern (https://playwright.dev/docs/test-fixtures#overriding-fixtures):
	 * test fixture を worker fixture から resolve する。
	 */
	baseURL: async ({ workerBaseURL }, use) => {
		await use(workerBaseURL);
	},
});

export { expect };
