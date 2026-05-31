/**
 * Stagehand v3 API surface assertion test (PR #2695 Day 3 fatal 真因解消)
 *
 * 目的: v2 → v3 breaking change の **実装 / mock からの乖離** を CI で機械的に検出する。
 * 本回 (Day 3) の fatal は v3 SDK install 状態で v2 API surface のコードを書いていた実装バグ。
 * 同 class の bug を二度と通さないため、以下の structural invariant を assert する。
 *
 * SSOT: tmp/stagehand-v3-migration-notes.md
 *
 * 範囲:
 *   1. @browserbasehq/stagehand v3 module の named export 存在 (Stagehand / V3)
 *   2. Mock Stagehand instance が v3 API surface に整合
 *      (`stagehand.context.addCookies`, `stagehand.context.activePage`,
 *       `stagehand.act`, `stagehand.observe`, `stagehand.extract`)
 *   3. Mock 経路で setChildContext / executeStep が v3 形態で動作 (`stagehand.page` 経由禁止)
 *   4. runAxeAudit が mock mode で realistic 5 violations 返す
 *   5. runChildFriendlyAudit が age-tier SSOT に整合
 *
 * Anti-pattern guard: v3 では `stagehand.page` プロパティは存在しないため、
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

describe('Stagehand v3 module export surface', () => {
	it('@browserbasehq/stagehand exports Stagehand and V3 (alias) classes', async () => {
		const sdk = await import('@browserbasehq/stagehand');
		expect(sdk.Stagehand).toBeDefined();
		expect(sdk.V3).toBeDefined();
		// v3 では Stagehand === V3 (index.d.ts alias)
		expect(sdk.Stagehand).toBe(sdk.V3);
	});

	it('Stagehand class has act / observe / extract on instance (not on .page)', async () => {
		const sdk = await import('@browserbasehq/stagehand');
		const proto = sdk.Stagehand.prototype;
		expect(typeof proto.act).toBe('function');
		expect(typeof proto.observe).toBe('function');
		expect(typeof proto.extract).toBe('function');
		// v3 では context は getter (descriptor)
		const ctxDesc = Object.getOwnPropertyDescriptor(proto, 'context');
		expect(ctxDesc?.get).toBeDefined();
	});
});

describe('Mock Stagehand instance — v3 API surface 整合', () => {
	it('createStagehand({ mock: true }) は context.addCookies / context.activePage を持つ', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			expect(sh._mockMode).toBe(true);
			// v3: context は instance property
			expect(sh.context).toBeDefined();
			expect(typeof sh.context.addCookies).toBe('function');
			expect(typeof sh.context.activePage).toBe('function');

			// v3 breaking change guard: stagehand.page は存在してはならない
			// (v2 では存在したプロパティ。本 PR で撤去済を assert)
			expect((sh as unknown as { page?: unknown }).page).toBeUndefined();
		} finally {
			await sh.close();
		}
	});

	it('Mock instance は act / observe / extract を持つ (V3 直呼出 API)', async () => {
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

	it('activePage() は同期メソッド (context.d.ts §64 整合、Promise なし) を返す', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			const page = sh.context.activePage();
			// 同期メソッドなので Promise ではなく Page object を直接返す
			expect(page).toBeDefined();
			expect(page._mockMode).toBe(true);
			expect(typeof page.goto).toBe('function');
			expect(typeof page.screenshot).toBe('function');
		} finally {
			await sh.close();
		}
	});
});

describe('setChildContext / executeStep — v3 形態で動作', () => {
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

	it('executeStep は stagehand.page 経由を **使わず** v3 経路で SS + observe', async () => {
		const { createStagehand, executeStep, ACTIVITY_PACK_FLOW } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		const tmp = await mkdtemp(join(tmpdir(), 'stagehand-v3-test-'));
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
			// v3: executeStep の戻り値に page も含まれる (run-poc 側で axe に渡す)
			expect(result.page).toBeDefined();
			expect(result.page._mockMode).toBe(true);
		} finally {
			await sh.close();
			await rm(tmp, { recursive: true, force: true });
		}
	});

	it('getActivePage は v3 context.activePage() を wrap (mock も同形態)', async () => {
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

describe('axe-runner — mock mode で realistic 5 violations', () => {
	it('runAxeAudit が mock page で 5 件 dummy violations を返す + JSON 出力', async () => {
		const { runAxeAudit } = await loadAxe();
		const mockPage = { _mockMode: true };
		const tmp = await mkdtemp(join(tmpdir(), 'axe-v3-test-'));
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

describe('Anti-regression — v2 API patterns must NOT appear in mock', () => {
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

	it('mock page は v2 の page.context() メソッドを持たない (v3 では stagehand.context に hoist 済)', async () => {
		const { createStagehand } = await loadModule();
		const sh = await createStagehand({ baseUrl: 'http://localhost:5180', mock: true });
		try {
			const page = sh.context.activePage();
			// v2 の Playwright Page は page.context() で BrowserContext を返したが、v3 で撤去
			expect(typeof (page as unknown as { context?: () => unknown }).context).not.toBe('function');
		} finally {
			await sh.close();
		}
	});
});
