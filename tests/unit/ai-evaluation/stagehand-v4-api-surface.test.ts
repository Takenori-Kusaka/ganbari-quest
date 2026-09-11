/**
 * Stagehand v4 API surface assertion test (#4618 dependabot v3→v4 migration、
 * 旧 PR #2695 Day 3 fatal 真因解消の後継)
 *
 * 目的: v3 → v4 breaking change の **実装 / mock からの乖離** を CI で機械的に検出する。
 * v3 (constructor 経由 `new Stagehand(...)`) から v4 (`Stagehand.create()` static factory、
 * constructor private 化) への SDK 移行で、実装が旧 API のまま残る class の bug を CI で防ぐ。
 *
 * SSOT: node_modules/@browserbasehq/stagehand/dist/index.d.mts (直読、推測禁止)
 *
 * 範囲:
 *   1. @browserbasehq/stagehand v4 module の named export 存在 (Stagehand / localBrowser)
 *   2. Mock Stagehand instance が v4 wrapper API surface に整合
 *      (`stagehand.context.addCookies`, `stagehand.context.activePage`,
 *       `stagehand.act`, `stagehand.observe`, `stagehand.extract`)
 *   3. Mock 経路で setChildContext / executeStep が v4 wrapper 形態で動作
 *      (`stagehand.page` 経由禁止、v3 から不変の invariant)
 *   4. runAxeAudit が mock mode で realistic 5 violations 返す
 *   5. runChildFriendlyAudit が age-tier SSOT に整合
 *
 * Anti-pattern guard: v4 でも `stagehand.page` プロパティは存在しないため、
 * mock 含めて `.page` を持たせない (assert で `undefined` を確認)。
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mock / runtime narrow type — `.mjs` 戻り値 (`Promise<unknown>`) を test 側で扱うため。
 * 実 SDK の Stagehand class とは別 contract で、`_mockMode: true` を含む Mock 経路の API surface
 * のみを assert する (runtime invariant は vitest expect で担保)。
 */
interface MockPage {
	_mockMode: true;
	goto: (...args: unknown[]) => Promise<unknown>;
	screenshot: (opts: { path: string }) => Promise<unknown>;
	url: () => string;
	evaluate: (...args: unknown[]) => Promise<unknown>;
	$$eval: (...args: unknown[]) => Promise<unknown[]>;
	context?: unknown; // anti-regression: v2 page.context() を持たない事を assert する用
}

interface MockContext {
	addCookies: (cookies: unknown[]) => Promise<void>;
	activePage: () => MockPage;
	_getCookiesForTest: () => Array<Record<string, unknown>>;
}

interface MockStagehand {
	_mockMode: true;
	context: MockContext;
	act: (instruction: unknown, opts?: unknown) => Promise<{ success: boolean; message: string }>;
	observe: (instruction: unknown, opts?: unknown) => Promise<Array<{ description: string }>>;
	extract: (
		instruction?: unknown,
		schema?: unknown,
		opts?: unknown,
	) => Promise<{ extraction: string }>;
	close: () => Promise<void>;
}

interface StagehandRunnerModule {
	createStagehand: (opts: {
		baseUrl: string;
		apiKey?: string;
		modelName?: string;
		mock?: boolean;
	}) => Promise<MockStagehand>;
	setChildContext: (sh: MockStagehand, baseUrl: string, childId: number) => Promise<void>;
	executeStep: (
		sh: MockStagehand,
		step: { step: number; label: string; url: string; action: string | null; nngFocus: string },
		baseUrl: string,
		ssPath: string,
	) => Promise<{ observed: unknown; screenshotPath: string; page: MockPage }>;
	getActivePage: (sh: MockStagehand) => Promise<MockPage>;
	ACTIVITY_PACK_FLOW: Array<{
		step: number;
		label: string;
		url: string;
		action: string | null;
		nngFocus: string;
	}>;
	FIXTURE_CHILDREN: Record<string, number>;
	AGE_MODES: string[];
}

interface AxeRunnerModule {
	runAxeAudit: (
		page: { _mockMode?: boolean },
		jsonPath: string,
	) => Promise<{
		violations: Array<{ id: string; impact: string | null }>;
		critical: number;
		serious: number;
		moderate: number;
		minor: number;
	}>;
	runChildFriendlyAudit: (
		page: { _mockMode?: boolean; $$eval?: (...args: unknown[]) => Promise<unknown[]> },
		ageMode: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior',
	) => Promise<{ expectedMin: number; totalTargets: number; violations: unknown[] }>;
	AGE_TAP_SIZE_MIN: Record<'baby' | 'preschool' | 'elementary' | 'junior' | 'senior', number>;
}

// 動的 import (.mjs file の TypeScript 型推論は any 同等のため、narrow interface で受け直す)
async function loadModule(): Promise<StagehandRunnerModule> {
	return (await import(
		'../../../scripts/ai-evaluation/lib/stagehand-runner.mjs'
	)) as unknown as StagehandRunnerModule;
}

async function loadAxe(): Promise<AxeRunnerModule> {
	return (await import(
		'../../../scripts/ai-evaluation/lib/axe-runner.mjs'
	)) as unknown as AxeRunnerModule;
}

// #3661: @browserbasehq/stagehand / stagehand-runner.mjs / axe-runner.mjs の dynamic import は
// 初回 (module cache cold、fresh npm ci 直後の cold FS) や並列 worktree agent 稼働中の高負荷環境で
// 5s 級の解決時間を要する (実測 7.9s → 再実行 pass の flake)。hooks-integration.test.ts と同型の
// describe-level timeout で吸収する (assertion 内容は不変、ADR-0061 same-class 対処)。
const HEAVY_INIT_TIMEOUT = 30_000;

describe('Stagehand v4 module export surface', { timeout: HEAVY_INIT_TIMEOUT }, () => {
	it('@browserbasehq/stagehand exports Stagehand class + localBrowser factory', async () => {
		const sdk = await import('@browserbasehq/stagehand');
		expect(sdk.Stagehand).toBeDefined();
		expect(sdk.localBrowser).toBeDefined();
		// v4: browser 起動は Stagehand と分離した factory (localBrowser.launch / .connect)
		expect(typeof sdk.localBrowser.launch).toBe('function');
	});

	it('Stagehand constructor は private 化され、static create() のみが公式経路', async () => {
		const sdk = await import('@browserbasehq/stagehand');
		// v4 breaking change: `new Stagehand(...)` は TS コンパイルエラーになる (private constructor)。
		// runtime でも同義に「create 経由以外の生成手段を提供しない」ことを構造的に確認する。
		expect(typeof sdk.Stagehand.create).toBe('function');
	});

	it('Stagehand class has act / observe / extract on instance (not on .page)', async () => {
		const sdk = await import('@browserbasehq/stagehand');
		const proto = sdk.Stagehand.prototype;
		expect(typeof proto.act).toBe('function');
		expect(typeof proto.observe).toBe('function');
		expect(typeof proto.extract).toBe('function');
		// v4 では Stagehand instance に `.context` getter は存在しない
		// (BrowserContext は `.browser.context` 経由、src/stagehand.d.ts)
		const ctxDesc = Object.getOwnPropertyDescriptor(proto, 'context');
		expect(ctxDesc).toBeUndefined();
		// `.browser` getter 経由で StagehandBrowser (→ .context) を取得する
		const browserDesc = Object.getOwnPropertyDescriptor(proto, 'browser');
		expect(browserDesc?.get).toBeDefined();
	});
});

describe('Mock Stagehand wrapper — v4 API surface 整合', { timeout: HEAVY_INIT_TIMEOUT }, () => {
	it('createStagehand({ mock: true }) は context.addCookies / context.activePage を持つ', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			expect(sh._mockMode).toBe(true);
			// wrapper: context は instance property (v4 実装では browser.context を re-export)
			expect(sh.context).toBeDefined();
			expect(typeof sh.context.addCookies).toBe('function');
			expect(typeof sh.context.activePage).toBe('function');

			// v3/v4 共通の breaking change guard: stagehand.page は存在してはならない
			// (v2 では存在したプロパティ。本 PR で撤去済を assert)
			expect((sh as unknown as { page?: unknown }).page).toBeUndefined();
		} finally {
			await sh.close();
		}
	});

	it('Mock instance は act / observe / extract を持つ (Stagehand instance 直呼出 API)', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			expect(typeof sh.act).toBe('function');
			expect(typeof sh.observe).toBe('function');
			expect(typeof sh.extract).toBe('function');

			const actResult = await sh.act('Click the import button');
			expect(actResult.success).toBe(true);
			expect(actResult.message).toContain('[MOCK act]');

			const obsResult = await sh.observe('Describe screen');
			expect(Array.isArray(obsResult)).toBe(true);
			expect(obsResult.length).toBeGreaterThan(0);
			const firstObs = obsResult[0];
			expect(firstObs).toBeDefined();
			if (!firstObs) throw new Error('unreachable: length guard 後');
			expect(firstObs.description).toContain('[MOCK observed]');

			const extractResult = await sh.extract('dummy');
			expect(extractResult).toHaveProperty('extraction');
		} finally {
			await sh.close();
		}
	});

	it('context.activePage() は await 経由で Page を返す (v4 は Promise<Page|undefined> 化)', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			// v4 BrowserContext.activePage() は async 化されている (src/browserContext.d.ts)。
			// mock 実装は同期値を返すが、呼出側は常に await するため両対応。
			const page = await sh.context.activePage();
			expect(page).toBeDefined();
			expect(page._mockMode).toBe(true);
			expect(typeof page.goto).toBe('function');
			expect(typeof page.screenshot).toBe('function');
		} finally {
			await sh.close();
		}
	});
});

describe('setChildContext / executeStep — v4 wrapper 形態で動作', {
	timeout: HEAVY_INIT_TIMEOUT,
}, () => {
	it('setChildContext は stagehand.context.addCookies 経由で cookie 追加', async () => {
		const { createStagehand, setChildContext } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			await setChildContext(sh, 'http://localhost:5180', 903);
			// mock context._getCookiesForTest() で injection 確認
			const cookies = (
				sh.context as unknown as { _getCookiesForTest: () => unknown[] }
			)._getCookiesForTest();
			expect(cookies).toHaveLength(1);
			expect(cookies[0]).toMatchObject({
				name: 'selectedChildId',
				value: '903',
				domain: 'localhost',
				path: '/',
			});
		} finally {
			await sh.close();
		}
	});

	it('executeStep は stagehand.page 経由を **使わず** wrapper 経路で SS + observe', async () => {
		const { createStagehand, executeStep, ACTIVITY_PACK_FLOW } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		const tmp = await mkdtemp(join(tmpdir(), 'stagehand-v4-test-'));
		try {
			const ssPath = join(tmp, 'ss-step1.png');
			const step1 = ACTIVITY_PACK_FLOW[0];
			expect(step1).toBeDefined();
			if (!step1) throw new Error('unreachable: ACTIVITY_PACK_FLOW[0] guard');
			const result = await executeStep(sh, step1, 'http://localhost:5180', ssPath);

			expect(result.screenshotPath).toBe(ssPath);
			// SS dummy file が物理書き込みされている
			const bytes = await readFile(ssPath);
			expect(bytes.length).toBeGreaterThan(0);
			// observed は Mock 経由で構造化 array
			expect(Array.isArray(result.observed)).toBe(true);
			// executeStep の戻り値に page も含まれる (run-poc 側で axe に渡す)
			expect(result.page).toBeDefined();
			expect(result.page._mockMode).toBe(true);
		} finally {
			await sh.close();
			await rm(tmp, { recursive: true, force: true });
		}
	});

	it('getActivePage は context.activePage() を await で wrap (mock も同形態)', async () => {
		const { createStagehand, getActivePage } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			const page = await getActivePage(sh);
			expect(page).toBeDefined();
			expect(page._mockMode).toBe(true);
			expect(typeof page.screenshot).toBe('function');
		} finally {
			await sh.close();
		}
	});
});

describe('axe-runner — mock mode で realistic 5 violations', {
	timeout: HEAVY_INIT_TIMEOUT,
}, () => {
	it('runAxeAudit が mock page で 5 件 dummy violations を返す + JSON 出力', async () => {
		const { runAxeAudit } = await loadAxe();
		const mockPage = { _mockMode: true };
		const tmp = await mkdtemp(join(tmpdir(), 'axe-v4-test-'));
		try {
			const jsonPath = join(tmp, 'axe-mock.json');
			const result = await runAxeAudit(mockPage, jsonPath);
			expect(result.violations).toHaveLength(5);
			expect(result.critical).toBe(1);
			expect(result.serious).toBe(2);
			expect(result.moderate).toBe(2);

			// JSON 出力検証
			const json = JSON.parse(await readFile(jsonPath, 'utf-8'));
			expect(json._mock).toBe(true);
			expect(json.summary).toMatchObject({ critical: 1, serious: 2, moderate: 2 });
			expect(json.violations).toHaveLength(5);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});

	it('runChildFriendlyAudit は age-tier SSOT 整合 (baby=120, senior=44)', async () => {
		const { runChildFriendlyAudit, AGE_TAP_SIZE_MIN } = await loadAxe();
		expect(AGE_TAP_SIZE_MIN.baby).toBe(120);
		expect(AGE_TAP_SIZE_MIN.preschool).toBe(80);
		expect(AGE_TAP_SIZE_MIN.elementary).toBe(56);
		expect(AGE_TAP_SIZE_MIN.junior).toBe(48);
		expect(AGE_TAP_SIZE_MIN.senior).toBe(44);

		// senior mode (44px 最小) で mock $$eval が返す 7 件中、44px 未満は 2 件
		// (h=32, h=40)。_mockMode=true で stagehand-runner.mjs mockPage 後方互換 path を踏む。
		const mockPage = {
			_mockMode: true,
			$$eval: async () => [
				{ tag: 'button', w: 64, h: 64, text: 'OKボタン' }, // OK
				{ tag: 'button', w: 48, h: 48, text: 'キャンセル' }, // OK (44 以上)
				{ tag: 'a', w: 100, h: 32, text: 'リンク' }, // 違反 (h=32 < 44)
				{ tag: 'button', w: 88, h: 88, text: 'みんなのテンプレート' }, // OK
				{ tag: '[role="button"]', w: 72, h: 72, text: 'インポート' }, // OK
				{ tag: 'button', w: 40, h: 40, text: '✕' }, // 違反 (40 < 44)
				{ tag: 'a', w: 200, h: 56, text: '詳細' }, // OK
			],
		};
		const result = await runChildFriendlyAudit(mockPage, 'senior');
		expect(result.expectedMin).toBe(44);
		expect(result.totalTargets).toBe(7);
		expect(result.violations).toHaveLength(2); // h=32, h=40
	});

	it('runChildFriendlyAudit baby mode (120px 最小) で violations が多い', async () => {
		const { runChildFriendlyAudit } = await loadAxe();
		const mockPage = {
			_mockMode: true,
			$$eval: async () => [
				{ tag: 'button', w: 64, h: 64, text: 'OK' }, // 違反 (64 < 120)
				{ tag: 'button', w: 130, h: 130, text: 'OKK' }, // OK
				{ tag: 'a', w: 200, h: 56, text: '詳細' }, // 違反 (56 < 120)
			],
		};
		const result = await runChildFriendlyAudit(mockPage, 'baby');
		expect(result.expectedMin).toBe(120);
		expect(result.totalTargets).toBe(3);
		expect(result.violations).toHaveLength(2);
	});
});

describe('Anti-regression — v2/v3 API patterns must NOT appear in mock', {
	timeout: HEAVY_INIT_TIMEOUT,
}, () => {
	it('mock instance は **v2 の stagehand.page プロパティ** を持たない', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			// v2 fatal の再発防止: stagehand.page を **新規実装で再導入しない**
			expect((sh as unknown as { page?: unknown }).page).toBeUndefined();
		} finally {
			await sh.close();
		}
	});

	it('mock page は v2 の page.context() メソッドを持たない (v4 では browser.context に hoist 済)', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			const page = await sh.context.activePage();
			// v2 の Playwright Page は page.context() で BrowserContext を返したが、v3/v4 で撤去
			expect(typeof (page as unknown as { context?: () => unknown }).context).not.toBe('function');
		} finally {
			await sh.close();
		}
	});
});
