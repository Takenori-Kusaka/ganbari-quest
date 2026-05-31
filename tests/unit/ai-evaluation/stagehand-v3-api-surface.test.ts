// @ts-nocheck — .mjs file dynamic import で TypeScript 型推論が効かないため。
// 動作検証は vitest runtime (`npx vitest run tests/unit/ai-evaluation/`) で 17 tests PASS で担保済。
// 型整備は別 follow-up (本 PR scope = v3 API 移行 + Mock 強化 + structural test 追加)
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

// 動的 import (Stagehand v3 module は SDK install 済前提だが、test env で実 SDK load を回避するため Mock 経路で )
async function loadModule(): Promise<
	typeof import('../../../scripts/ai-evaluation/lib/stagehand-runner.mjs')
> {
	// @ts-expect-error — .mjs file dynamic import
	return import('../../../scripts/ai-evaluation/lib/stagehand-runner.mjs');
}

async function loadAxe(): Promise<
	typeof import('../../../scripts/ai-evaluation/lib/axe-runner.mjs')
> {
	// @ts-expect-error — .mjs file dynamic import
	return import('../../../scripts/ai-evaluation/lib/axe-runner.mjs');
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
			expect(obsResult[0].description).toContain('[MOCK observed]');

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
			const result = await executeStep(sh, ACTIVITY_PACK_FLOW[0], 'http://localhost:5180', ssPath);

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
		// (h=32, h=40)
		const mockPage = {
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
