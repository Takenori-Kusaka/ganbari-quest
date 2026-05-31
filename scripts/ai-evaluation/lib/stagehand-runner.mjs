/**
 * Stagehand v3 自動探索 runner (Issue #2692 / EPIC #2691 POC)
 *
 * 役割:
 *   - port 5180 demo Lambda env で 5 step critical flow を自動探索
 *   - 5 fixture child (901-906) を selectedChildId cookie 経由で切替
 *   - 各 step で SS + axe-core report 撮影
 *   - Stagehand init / act / observe を wrap (v3 API は変動するため最小依存)
 *
 * Mock mode (--mock flag、Day 3 mock smoke test 用、Issue #2692):
 *   - 実 browser 起動なし、Stagehand 依存 load なし
 *   - createStagehand → MockStagehand instance を返す (act/observe/screenshot は dummy 動作)
 *   - executeStep → dummy SS placeholder (1x1 PNG) + dummy observed 文字列を返す
 *   - 「pipeline structural 健全性のみ検証 (cost $0)」目的、実 Claude API 評価は別 thread
 *
 * SSOT:
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §3
 *   - tmp/stagehand-v3-migration-notes.md (v2 → v3 breaking change SSOT、Day 3 fatal 真因解消)
 *   - src/lib/server/demo/demo-data.ts (5 fixture child 901-906)
 *   - tests/e2e/admin-activities-import-marketplace.spec.ts (critical flow reference)
 *
 * 環境:
 *   - AI_EVAL_BASE_URL (default: http://localhost:5180、AUTH_MODE=anonymous + DATA_SOURCE=demo)
 *   - ANTHROPIC_API_KEY (Stagehand LLM client 用、本 POC は CLI からは別 manage)
 *
 * Stagehand v3 採用根拠: ADR-0014 OSS 先調査ルール + tmp/round18-parallel-path-stack-2026-05-30.md §A.4
 *   - TypeScript native = 本 product SvelteKit + Vite stack 整合
 *   - 既存 playwright.config.ts の port 5180 直接拡張可能
 *   - act/extract/observe atomic primitives で AI 自律性 + reproducibility 両立
 *
 * v3 API surface (`.d.ts` 直読、推測禁止、PR #2695 Day 3 fatal 真因解消):
 *   - `stagehand.context.addCookies(cookies)` — context.d.ts §154
 *   - `stagehand.context.activePage()` → understudy/Page (CDP 直接、Playwright 不使用) — context.d.ts §64
 *   - `stagehand.act(instruction, opts) / observe(instruction, opts) / extract(...)` — v3 instance 直呼出 (v3.d.ts §150/169)
 *   - **`stagehand.page` プロパティは v3 で存在しない** (Day 3 fatal の真因)
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 1x1 PNG dummy bytes (Stagehand mock SS placeholder 用、base64 decoded)
 * red dot PNG (smallest valid PNG with alpha channel)
 */
const DUMMY_PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
	'base64',
);

/**
 * 5 fixture child SSOT (src/lib/server/demo/demo-data.ts L10-14)
 *
 * - baby (901): たろうくん (1歳、admin UI 同型)
 * - preschool (902): ひなちゃん (5歳、#1893 LP 用代表ペルソナ)
 * - elementary (903): けんたくん (8歳、#1893 LP 用代表)
 * - junior (904): さくらちゃん (14歳)
 * - senior (906): けいすけくん (17歳)
 */
export const FIXTURE_CHILDREN = {
	baby: 901,
	preschool: 902,
	elementary: 903,
	junior: 904,
	senior: 906,
};

export const AGE_MODES = Object.keys(FIXTURE_CHILDREN);

/**
 * activity-pack critical flow 5 step 定義
 * (tmp/round18-parallel-path-first-review-plan-2026-05-30.md §1 整合)
 */
export const ACTIVITY_PACK_FLOW = [
	{
		step: 1,
		label: '/admin/activities 遷移 + 初回印象',
		url: '/admin/activities',
		action: null, // 遷移のみ
		nngFocus: '#6 認識 / #8 美的最小限',
	},
	{
		step: 2,
		label: 'header `+` button → menu open',
		url: '/admin/activities',
		action: 'Click the "+" button in the header to open the add menu',
		nngFocus: '#2 適合 / #4 一貫性',
	},
	{
		step: 3,
		label: 'menu インポート → import panel 表示',
		url: '/admin/activities',
		action: 'Click "みんなのテンプレートから探す" menu item',
		nngFocus: '#4 一貫性 / #7 柔軟性',
	},
	{
		step: 4,
		label: 'preset 一覧から activity-pack 選択',
		url: '/admin/activities',
		action: 'Click the first activity-pack preset card to open details',
		nngFocus: '#1 visibility / #6 認識',
	},
	{
		step: 5,
		label: 'インポート CTA → 子供選択 dialog → 取込完了 toast',
		url: '/admin/activities',
		action: 'Click the "インポート" CTA, then select all children and confirm',
		nngFocus: '#1 visibility / #9 error recovery / #10 help',
	},
];

/**
 * Stagehand を lazy import (依存未配置時の fallback for dev環境)
 */
async function loadStagehand() {
	try {
		const { Stagehand } = await import('@browserbasehq/stagehand');
		return Stagehand;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`@browserbasehq/stagehand load 失敗: ${msg}\n` +
				`本 POC は npm install -D @browserbasehq/stagehand@^3.4 が前提です。`,
		);
	}
}

/**
 * Mock Stagehand instance (--mock flag 用、Issue #2692 mock smoke test、v3 API 整合)
 *
 * v3 API surface を模倣 (`tmp/stagehand-v3-migration-notes.md` §大局的書き直し方針 §5):
 *   - `stagehand.context.addCookies / activePage()` (v2 の page.context() 経由を撤去)
 *   - `stagehand.act / observe / extract` (v3 instance 直呼出)
 *   - activePage() 戻りの Page も `_mockMode` を持つ (axe-runner 分岐用)
 *   - 実 browser / Stagehand SDK 起動なし、cost $0、Anthropic key 不要
 *
 * 「pipeline structural 健全性のみ検証」目的。
 */
/**
 * @param {{ baseUrl: string }} opts
 * @returns {{
 *   _mockMode: true,
 *   context: {
 *     addCookies: (cookies: Array<Record<string, unknown>>) => Promise<void>,
 *     activePage: () => any,
 *     _getCookiesForTest: () => Array<Record<string, unknown>>,
 *   },
 *   act: (instruction: unknown, options?: unknown) => Promise<{ success: boolean, message: string }>,
 *   observe: (instruction: unknown, options?: unknown) => Promise<Array<{ description: string }>>,
 *   extract: (instruction?: unknown, schema?: unknown, options?: unknown) => Promise<{ extraction: string }>,
 *   close: () => Promise<void>,
 * }}
 */
function createMockStagehand({ baseUrl }) {
	/** @type {Array<Record<string, unknown>>} */
	const cookies = [];
	const mockPage = {
		_mockMode: /** @type {const} */ (true), // axe-runner.mjs が `page?._mockMode` で分岐するため必須
		_currentUrl: baseUrl,
		/** @param {string} url */
		async goto(url) {
			this._currentUrl = url;
			return null;
		},
		/** @param {{ path: string }} opts */
		async screenshot({ path }) {
			// dummy 1x1 PNG を書き込む (structural test 用 placeholder)
			await fs.mkdir(dirname(path), { recursive: true });
			await fs.writeFile(path, DUMMY_PNG_1X1);
			return DUMMY_PNG_1X1;
		},
		url() {
			return this._currentUrl;
		},
		/**
		 * @param {unknown} _fnOrExpr
		 * @param {unknown} [_arg]
		 */
		async evaluate(_fnOrExpr, _arg) {
			// v3 Page.evaluate (page.d.ts §276). runChildFriendlyAudit が呼ぶ
			// (実 mode は axe-runner 側で別途実装、本 mock は structural test only)
			return null;
		},
		/**
		 * @param {string} _selector
		 * @param {unknown} _fn
		 */
		async $$eval(_selector, _fn) {
			// 後方互換 (v3 Page には $$eval 存在しないが、axe-runner.mjs runChildFriendlyAudit が
			// 現状この API を使うため mock では維持。実 mode 移行時は evaluate ベースに書き直す TODO)
			return [
				{ tag: 'button', w: 64, h: 64, text: 'OKボタン' },
				{ tag: 'button', w: 48, h: 48, text: 'キャンセル' }, // baby=120/preschool=80 で違反
				{ tag: 'a', w: 100, h: 32, text: 'リンク' }, // 全 mode で違反 (h<44)
				{ tag: 'button', w: 88, h: 88, text: 'みんなのテンプレートから探す' },
				{ tag: '[role="button"]', w: 72, h: 72, text: 'インポート' },
				{ tag: 'button', w: 40, h: 40, text: '✕' }, // 全 mode 違反候補
				{ tag: 'a', w: 200, h: 56, text: '詳細を見る' },
			];
		},
	};
	const mockContext = {
		/** @param {Array<Record<string, unknown>>} c */
		async addCookies(c) {
			cookies.push(...c);
		},
		activePage() {
			// v3 では activePage() は **同期メソッド** (context.d.ts §64、Promise なし)
			return mockPage;
		},
		_getCookiesForTest() {
			// test 用 inspection helper、本番 path には影響なし
			return cookies;
		},
	};
	return {
		_mockMode: /** @type {const} */ (true),
		context: mockContext,
		// v3 では stagehand.act / observe は instance 直呼出 (v3.d.ts §150 / §169)
		/**
		 * @param {unknown} instructionOrAction
		 * @param {unknown} [_options]
		 */
		async act(instructionOrAction, _options) {
			const desc =
				typeof instructionOrAction === 'string'
					? instructionOrAction
					: JSON.stringify(instructionOrAction);
			return { success: true, message: `[MOCK act] ${desc.slice(0, 60)}` };
		},
		/**
		 * @param {unknown} instructionOrOptions
		 * @param {unknown} [_options]
		 */
		async observe(instructionOrOptions, _options) {
			const text =
				typeof instructionOrOptions === 'string'
					? instructionOrOptions
					: /** @type {{ instruction?: string }} */ (instructionOrOptions)?.instruction ||
						'(no instruction)';
			return [{ description: `[MOCK observed] ${text.slice(0, 80)}` }];
		},
		/**
		 * @param {unknown} [_instruction]
		 * @param {unknown} [_schema]
		 * @param {unknown} [_options]
		 */
		async extract(_instruction, _schema, _options) {
			return { extraction: '[MOCK extract] dummy text' };
		},
		async close() {
			// no-op
		},
	};
}

/**
 * Stagehand v3 instance を本 product POC 標準設定で初期化
 *
 * 戻り値は実 SDK の `import('@browserbasehq/stagehand').Stagehand` または Mock instance
 * (`createMockStagehand` 戻り) のいずれか。型は `Promise<unknown>` で広げ、test 側 / run-poc.mjs 側で
 * `as unknown as` narrow する運用。Mock instance は `_mockMode: true` で識別可能。
 *
 * @param {Object} opts
 * @param {string} opts.baseUrl - http://localhost:5180 等 (demo Lambda env)
 * @param {string} [opts.apiKey] - ANTHROPIC_API_KEY (Stagehand LLM client 用、mock=true 時は不要)
 * @param {string} [opts.modelName='claude-opus-4-7'] - Stagehand 内部 LLM model
 * @param {boolean} [opts.mock=false] - true で Mock Stagehand instance を返す (cost $0、Issue #2692)
 * @returns {Promise<unknown>} initialized Stagehand instance (or Mock instance with `_mockMode: true`)
 */
export async function createStagehand({
	baseUrl,
	apiKey,
	modelName = 'claude-opus-4-7',
	mock = false,
}) {
	if (!baseUrl) throw new Error('baseUrl 必須 (例: http://localhost:5180)');

	if (mock) {
		console.log('[stagehand] MOCK mode: 実 browser / SDK 起動なし、dummy SS 生成のみ');
		return createMockStagehand({ baseUrl });
	}

	if (!apiKey) throw new Error('apiKey 必須 (ANTHROPIC_API_KEY、mock=true 時は不要)');

	const Stagehand = await loadStagehand();
	// Stagehand v3 init parameters (V3Options, options.d.ts §38 直読 SSOT)
	// v2 breaking change:
	//   - modelName / modelClientOptions → model (ModelConfiguration、model.d.ts §1)
	//   - headless → localBrowserLaunchOptions.headless にネスト
	//   - domSettleTimeoutMs → domSettleTimeout (リネーム)
	//
	// v3 model name 形式: `provider/model` (anthropic/claude-opus-4-7 等)
	// docs: https://docs.stagehand.dev/v3/configuration/models#configuration-setup
	// `claude-` prefix で始まる場合は anthropic を自動付与し後方互換維持
	const stagehandModelName =
		typeof modelName === 'string' && !modelName.includes('/') && modelName.startsWith('claude-')
			? `anthropic/${modelName}`
			: modelName;
	const stagehand = new Stagehand({
		env: 'LOCAL',
		model: {
			modelName: stagehandModelName,
			apiKey,
		},
		localBrowserLaunchOptions: {
			headless: true, // CI 想定 + POC は headless で十分
		},
		verbose: 1,
		domSettleTimeout: 3000,
	});
	await stagehand.init();
	return stagehand;
}

/**
 * 5 fixture child を selectedChildId cookie で切替
 *
 * 既存 capture-hp-screenshots.mjs (#2097 PR-B1) と同じ機構を Stagehand context に適用。
 * demo Lambda env (AUTH_MODE=anonymous + DATA_SOURCE=demo、ADR-0048) では認証不要、
 * selectedChildId 1 件で child filter 条件切替可。
 *
 * v3 API: `stagehand.context.addCookies(cookies)` (context.d.ts §154、v2 の page.context() 経由を撤去)
 *
 * @param {{ context: { addCookies: (cookies: Array<Record<string, unknown>>) => Promise<void> } }} stagehand
 * @param {string} baseUrl
 * @param {string|number} childId
 */
export async function setChildContext(stagehand, baseUrl, childId) {
	const url = new URL(baseUrl);
	await stagehand.context.addCookies([
		{
			name: 'selectedChildId',
			value: String(childId),
			domain: url.hostname,
			path: '/',
		},
	]);
}

/**
 * v3 で active Page を取得する helper (`stagehand.context.activePage()`).
 *
 * Note: context.d.ts §64 で activePage() は **同期** `Page | undefined` を返す。
 * Promise は付かないが、互換性のため await 可能な形で wrap (mock も同形態)。
 * 戻り値は `understudy/Page` 型 (CDP 直接、Playwright 不使用)。
 *
 * @param {{ context: { activePage: () => any | undefined } }} stagehand
 * @returns {Promise<any>}
 */
export async function getActivePage(stagehand) {
	const page = stagehand.context.activePage();
	if (!page) {
		throw new Error(
			'[stagehand] activePage() が undefined (init 未完了 or popup race condition)。' +
				' stagehand.init() の await 完了後に呼出すこと。',
		);
	}
	return page;
}

/**
 * 単一 step を実行 + SS 撮影 + observe で UI state extract (v3 API 整合)
 *
 * v3 breaking change 対処:
 *   - `stagehand.page` プロパティ撤去 → `await getActivePage(stagehand)` で Page 取得
 *   - act / observe は V3 instance 直呼出 (page 経由しない)
 *
 * @param {{
 *   context: { activePage: () => any | undefined },
 *   act: (instruction: string, options?: unknown) => Promise<unknown>,
 *   observe: (instruction: string, options?: unknown) => Promise<unknown>,
 * }} stagehand
 * @param {{ step: number, label: string, url: string, action: string | null, nngFocus: string }} step - ACTIVITY_PACK_FLOW item
 * @param {string} baseUrl
 * @param {string} ssPath - SS 出力先 absolute path
 * @returns {Promise<{ observed: unknown, screenshotPath: string, page: any }>}
 */
export async function executeStep(stagehand, step, baseUrl, ssPath) {
	const fullUrl = new URL(step.url, baseUrl).toString();
	const page = await getActivePage(stagehand);

	// 遷移 (step 1 のみ完全遷移、それ以降は同じページで action 連鎖)
	// v3 Page.goto options は { waitUntil, timeoutMs } (page.d.ts §138、v2 の `timeout` から rename)
	if (step.step === 1) {
		await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeoutMs: 15000 });
	}

	// action 実行 (step 2-5、Stagehand act API、LLM 自律解釈で UI 操作)
	// v3 では stagehand.act(instruction, options) (V3 instance 直呼出、page 経由しない)
	if (step.action) {
		try {
			await stagehand.act(step.action);
		} catch (err) {
			// action 失敗時は SS だけ撮って続行 (POC は best-effort、Stagehand v3 API 変動対応)
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[stagehand] step ${step.step} act 失敗: ${msg}`);
		}
	}

	// SS 撮影 (fullPage、本 POC は mobile-like 780x1688 想定だが Stagehand default size でも可)
	// v3 Page.screenshot は { path, fullPage } 受付 (page.d.ts §206、Playwright-style 互換)
	await fs.mkdir(dirname(ssPath), { recursive: true });
	await page.screenshot({ path: ssPath, fullPage: true });

	// observe で現在 UI state extract (LLM 経由、optional)
	// v3 observe(instruction, options) signature (v3.d.ts §169)
	/** @type {unknown} */
	let observed = null;
	try {
		observed = await stagehand.observe(
			`Briefly describe what is visible on screen for step ${step.step}: ${step.label}`,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[stagehand] step ${step.step} observe 失敗: ${msg}`);
	}

	return { observed, screenshotPath: ssPath, page };
}

/**
 * Stagehand instance を安全に close (POC error path でも resource leak しない)
 * @param {{ close: () => Promise<void> }} stagehand
 */
export async function closeStagehand(stagehand) {
	try {
		await stagehand.close();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[stagehand] close 失敗 (無視): ${msg}`);
	}
}
