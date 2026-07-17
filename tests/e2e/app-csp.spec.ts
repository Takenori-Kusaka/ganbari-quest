// tests/e2e/app-csp.spec.ts
// #3829 (EPIC #3408 slice C): アプリ側 CSP `script-src 'unsafe-inline'` 撤廃の回帰検証。
//
// アプリ側 (SvelteKit) の CSP は svelte.config.js `kit.csp` (hash mode) に一本化した。
// SvelteKit が hydration bootstrap の inline `<script>` を sha256 hash 化して `script-src` に
// 自動注入するため、`script-src 'unsafe-inline'` を撤廃できる (#3112 構造リスク 1 の根治)。
//
// 本 spec は「全画面 hydration」への高回帰リスクを厚く検証する:
//   ① SSR ページのレスポンス CSP に `script-src 'unsafe-inline'` が **無い** + sha256 hash が付与されている
//   ② SSR (動的) レスポンスに X-Frame-Options: DENY が付与されている (対話 HTML の clickjacking 防御)
//   ③ ページ読込時に CSP violation (Refused to execute inline script 等) の console error が **0 件**
//   ④ hydration / interactivity が生存 (child home 遷移 / admin Ark UI Menu / marketplace SPA nav が client 動作する)
//
// clickjacking 防御の適用境界 (QM runtime 検証 #3833 で是正):
//   X-Frame-Options: DENY は hooks.server.ts が resolve(event) を通る SSR / 動的レスポンス全てに付与する。
//   対話 HTML ページは全て SSR のため clickjacking 保護は確実に効く (本 spec ② で実測)。
//   一方 prerender ページ (`export const prerender = true`) は build 時に静的化され request 時に
//   server hooks を経由しないため X-Frame-Options を持たない。本アプリで唯一の prerender endpoint は
//   /sitemap.xml (非対話 XML) であり、iframe 埋め込みによる clickjacking の実害は事実上ない。
//   従って「hooks の X-Frame-Options が prerender ページの backup になる」という当初の設計前提は
//   prerender ページ自身には成立しない。本 spec は実挙動に整合させ、SSR HTML で X-Frame-Options を、
//   sitemap.xml では「prerender は server-hook header を持たない」実挙動を assert する。
//
// CI は `npm run preview` (本番ビルド) で E2E 実行 = kit.csp hash mode が実効化する環境。
// LP (site/**) 側 CSP は別 origin・別スコープ (GitHub Pages 静的配信、ADR-0029 + tests/e2e/lp-csp.spec.ts)。
// 併存関係の整理は ADR-0067 / 設計書 14 §7.1 を参照。

import { expect, type Page, test } from '@playwright/test';
import { selectElementaryChildAndDismiss, selectJuniorChildAndDismiss } from './helpers';

/** CSP violation (script/style/inline の Refused) を示す console error / pageerror を収集する */
function collectCspViolations(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const text = msg.text();
		if (
			text.includes('Content Security Policy') ||
			text.includes('Content-Security-Policy') ||
			text.includes('Refused to execute') ||
			text.includes('Refused to load') ||
			text.includes('Refused to apply')
		) {
			consoleErrors.push(text);
		}
	});
	page.on('pageerror', (err) => pageErrors.push(err.message));
	return { consoleErrors, pageErrors };
}

/**
 * SSR ページの CSP レスポンスヘッダが hash mode で hardened されていることを assert する。
 * - `script-src` directive が存在し `'unsafe-inline'` を含まない (#3829 AC2 の核心)
 * - hash mode により `sha256-` が付与されている (SvelteKit が bootstrap inline script を hash 化した証跡)
 */
function assertScriptSrcHardened(csp: string | undefined, label: string): void {
	expect(csp, `${label}: CSP レスポンスヘッダが kit.csp により付与されている`).toBeTruthy();
	const directives = (csp ?? '').split(';').map((d) => d.trim());
	const scriptSrc = directives.find((d) => d.startsWith('script-src'));
	expect(scriptSrc, `${label}: script-src directive が存在する`).toBeTruthy();
	expect(
		scriptSrc ?? '',
		`${label}: script-src に 'unsafe-inline' が無い (#3829 撤廃)`,
	).not.toContain("'unsafe-inline'");
	expect(
		scriptSrc ?? '',
		`${label}: script-src に sha256- hash が付与 (kit.csp hash mode)`,
	).toContain('sha256-');
}

/** hydration violation が無いことを assert する共通ヘルパ */
function expectNoCspViolations(
	violations: { consoleErrors: string[]; pageErrors: string[] },
	label: string,
): void {
	expect(
		violations.consoleErrors,
		`${label}: CSP violation console error: ${violations.consoleErrors.join('\n')}`,
	).toHaveLength(0);
	expect(
		violations.pageErrors,
		`${label}: CSP 由来 pageerror: ${violations.pageErrors.join('\n')}`,
	).toHaveLength(0);
}

test.describe('#3829 アプリ側 CSP script-src hash 化 (unsafe-inline 撤廃)', () => {
	test('SSR ページの CSP header が script-src unsafe-inline 撤廃 + hash 付与 + X-Frame-Options (SSR clickjacking 防御)', async ({
		page,
	}) => {
		const violations = collectCspViolations(page);
		const response = await page.goto('/switch', { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load');

		const headers = response?.headers() ?? {};
		assertScriptSrcHardened(headers['content-security-policy'], '/switch');

		// style-src は本 PR では 'unsafe-inline' を維持 (slice B = #3408 AC2 で別途)
		const styleSrc = (headers['content-security-policy'] ?? '')
			.split(';')
			.map((d) => d.trim())
			.find((d) => d.startsWith('style-src'));
		expect(styleSrc ?? '', "style-src は 'unsafe-inline' を維持 (slice B 未着手)").toContain(
			"'unsafe-inline'",
		);

		// /switch は SSR (動的) レスポンス = hooks が resolve(event) 経由で X-Frame-Options を付与する。
		// 対話 HTML の clickjacking 防御はここで実測する。
		expect(headers['x-frame-options'], 'SSR HTML に X-Frame-Options: DENY が hooks で付与されている').toBe(
			'DENY',
		);

		expectNoCspViolations(violations, '/switch');
	});

	test('prerender エンドポイント /sitemap.xml が CSP 一本化後も配信される (server-hook header は非経由)', async ({
		page,
	}) => {
		const response = await page.goto('/sitemap.xml', { waitUntil: 'domcontentloaded' });
		expect(response?.status(), '/sitemap.xml が 200 で配信される (CSP 一本化後も prerender endpoint 生存)').toBe(
			200,
		);

		// prerender ページ (`export const prerender = true`) は build 時に静的化され request 時に
		// server hooks (hooks.server.ts) を経由しない。従って hooks が付与する X-Frame-Options: DENY は
		// sitemap.xml には乗らない (QM runtime 検証 #3833 で実測 = undefined)。当初 spec は
		// `toBe('DENY')` を期待していたが実挙動と不整合だったため、実挙動に整合させる。
		// clickjacking の実害は無い: sitemap.xml は非対話 XML で iframe 埋め込みの攻撃価値が無く、
		// 対話 HTML ページは全て SSR で X-Frame-Options を確実に取得する (上の /switch test で担保)。
		expect(
			response?.headers()['x-frame-options'],
			'prerender の静的レスポンスは server-hook 由来の X-Frame-Options を持たない (実挙動)',
		).toBeUndefined();
	});

	// hydration 生存 = bootstrap inline script が CSP に blockされず実行された証跡。
	// child home への遷移は /switch でのクライアント側 child 選択 (client-only) が成立して初めて成る。
	for (const mode of [
		{ name: 'elementary', select: selectElementaryChildAndDismiss, urlRe: /\/elementary\/home/ },
		{ name: 'junior', select: selectJuniorChildAndDismiss, urlRe: /\/junior\/home/ },
	] as const) {
		test(`child home hydration 生存 (${mode.name}): client child 選択 → home 遷移 → 活動カード操作可能`, async ({
			page,
		}) => {
			const violations = collectCspViolations(page);
			await mode.select(page);
			await expect(page, 'client child 選択が成立し home に遷移 (hydration 生存)').toHaveURL(
				mode.urlRe,
			);
			await expect(
				page.locator('[data-testid^="activity-card-"]').first(),
				'活動カードが hydrate されている',
			).toBeVisible();
			expectNoCspViolations(violations, `child-home:${mode.name}`);
		});
	}

	test('admin/activities hydration 生存: Ark UI + 追加メニューが client で開く + CSP header hardened', async ({
		page,
	}) => {
		const violations = collectCspViolations(page);
		const response = await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load');
		assertScriptSrcHardened(response?.headers()['content-security-policy'], '/admin/activities');

		// Ark UI Menu は client-side hydration 完了後にのみ listener を attach する。
		// menu が開く = bootstrap script が CSP block されず実行された動かぬ証跡。
		// (#2260 Fix-6: hydration 直後は listener attach が間に合わず初回 click が空振りしうるため toPass retry)
		const trigger = page.getByTestId('header-add-activity-btn');
		await expect(trigger).toBeVisible();
		await expect(async () => {
			await trigger.click();
			await expect(page.getByTestId('menu-item-manual')).toBeVisible({ timeout: 1_000 });
		}, '+ 追加メニューが client で開く (hydration 生存)').toPass({ timeout: 10_000 });

		expectNoCspViolations(violations, '/admin/activities');
	});

	test('marketplace hydration 生存: SPA ナビ (type filter) が client router で動く + CSP header hardened', async ({
		page,
	}) => {
		const violations = collectCspViolations(page);
		const response = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load');
		assertScriptSrcHardened(response?.headers()['content-security-policy'], '/marketplace');
		// /marketplace は SSR HTML (対話ページ) = hooks が X-Frame-Options: DENY を付与する。
		// clickjacking 保護が SSR HTML で効くことを 2 ページ目でも実測する (SSR-scoped 保証)。
		expect(
			response?.headers()['x-frame-options'],
			'SSR HTML (/marketplace) に X-Frame-Options: DENY が付与されている',
		).toBe('DENY');

		// SvelteKit client router が hydrate されていれば <a> は full reload せず SPA 遷移する。
		// window に probe を置き、type filter link click 後も残存 = full reload していない = hydration 生存。
		await page.evaluate(() => {
			(window as unknown as { __hydrationProbe?: string }).__hydrationProbe = 'alive';
		});
		const filterLink = page.locator('[data-testid^="filter-type-"]').first();
		await expect(filterLink).toBeVisible();
		const beforeUrl = page.url();
		await filterLink.click();
		await expect(page, 'type filter で URL が更新される (client router 動作)').not.toHaveURL(
			beforeUrl,
		);
		const probe = await page.evaluate(
			() => (window as unknown as { __hydrationProbe?: string }).__hydrationProbe,
		);
		expect(probe, 'SPA 遷移で window probe が残存 = full reload していない = hydration 生存').toBe(
			'alive',
		);

		expectNoCspViolations(violations, '/marketplace');
	});
});
