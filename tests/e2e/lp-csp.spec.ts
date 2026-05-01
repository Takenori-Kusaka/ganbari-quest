// tests/e2e/lp-csp.spec.ts
// #1719 / ADR-0029: LP CSP 多層防御の検証
//   - 全 10 LP ページに `<meta http-equiv="Content-Security-Policy">` が存在すること
//   - CSP の必須指令 (default-src / script-src / style-src / object-src 'none' / base-uri) が含まれること
//   - script-src には `https://cdn.jsdelivr.net` が allowlist 入りしていること（DOMPurify CDN）
//   - 実際にページをロードした際に Console / Page error が発生しないこと（CSP violation により script が読み込めない等）
//
// 戦略選択の根拠は ADR-0029 を参照。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const SITE_DIR = resolve('site');

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		server = createServer((req, res) => {
			let urlPath = decodeURIComponent((req.url || '/').split('?')[0] ?? '/');
			if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
			const filePath = join(SITE_DIR, urlPath);
			if (!filePath.startsWith(SITE_DIR)) {
				res.writeHead(403);
				res.end();
				return;
			}
			if (!existsSync(filePath) || !statSync(filePath).isFile()) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
			const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': mime });
			res.end(readFileSync(filePath));
		});
		server.on('error', rejectPromise);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				rejectPromise(new Error('Failed to bind LP static server'));
				return;
			}
			baseUrl = `http://127.0.0.1:${addr.port}`;
			resolvePromise();
		});
	});
});

test.afterAll(async () => {
	await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
});

// 対象ページ一覧（ADR-0029 §決定 1: site/*.html 全 10 ファイル）
const LP_PAGES = [
	'/index.html',
	'/pricing.html',
	'/faq.html',
	'/pamphlet.html',
	'/selfhost.html',
	'/privacy.html',
	'/terms.html',
	'/sla.html',
	'/tokushoho.html',
	'/help/license-key.html',
] as const;

test.describe('#1719 / ADR-0029 LP CSP 多層防御', () => {
	for (const pagePath of LP_PAGES) {
		test(`${pagePath} に CSP meta tag が存在し必須指令を満たす`, async ({ browser }) => {
			const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const page = await ctx.newPage();
			await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'domcontentloaded' });

			const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]');
			await expect(cspMeta, `${pagePath} に CSP meta tag が存在する`).toHaveCount(1);

			const cspContent = await cspMeta.getAttribute('content');
			expect(cspContent, 'CSP の content 属性が取得できる').toBeTruthy();
			if (!cspContent) {
				await ctx.close();
				return;
			}

			// 必須指令が含まれていることを検証
			expect(cspContent, "default-src 'self'").toContain("default-src 'self'");
			expect(cspContent, 'script-src に self を含む').toMatch(/script-src[^;]*'self'/);
			expect(cspContent, 'script-src に jsdelivr を allowlist').toMatch(
				/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/,
			);
			expect(cspContent, 'style-src に self を含む').toMatch(/style-src[^;]*'self'/);
			expect(cspContent, "object-src 'none' で <object>/<embed> 禁止").toMatch(
				/object-src\s+'none'/,
			);
			expect(cspContent, "base-uri 'self' で base 注入を防止").toMatch(/base-uri\s+'self'/);

			await ctx.close();
		});
	}

	test('index.html ロード時に CSP violation が発生しない', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();

		const consoleErrors: string[] = [];
		const pageErrors: Error[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') {
				const text = msg.text();
				// CSP violation 関連のエラーをキャプチャ。other (404 等) はテスト範囲外
				if (
					text.includes('Content Security Policy') ||
					text.includes('CSP') ||
					text.includes('Refused to load') ||
					text.includes('Refused to execute')
				) {
					consoleErrors.push(text);
				}
			}
		});
		page.on('pageerror', (err) => pageErrors.push(err));

		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		// DOMPurify / splidejs / budoux / shared-labels.js の defer ロード完了を待つ
		await page.waitForLoadState('load');

		expect(consoleErrors, `CSP violation: ${consoleErrors.join('\n')}`).toHaveLength(0);
		expect(
			pageErrors.map((e) => e.message),
			'CSP 由来の page error なし',
		).toHaveLength(0);

		await ctx.close();
	});

	test('CSP 配下でも DOMPurify が正常にロードされ window.DOMPurify が利用可能', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load');

		// DOMPurify が CDN (https://cdn.jsdelivr.net) からロードされ
		// CSP の `script-src https://cdn.jsdelivr.net` allowlist で許可されることを確認
		const hasDOMPurify = await page.evaluate(() => {
			return (
				typeof (window as unknown as { DOMPurify?: { sanitize: unknown } }).DOMPurify !==
					'undefined' &&
				typeof (window as unknown as { DOMPurify: { sanitize: unknown } }).DOMPurify.sanitize ===
					'function'
			);
		});
		expect(hasDOMPurify, 'window.DOMPurify.sanitize が利用可能').toBe(true);

		await ctx.close();
	});

	test('CSP 配下で SSOT 注入 (data-lp-key) が機能している', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load');

		// ADR-0025 で確立した SSOT 注入機構が CSP 配下でも動作することを確認
		// （data-lp-key 要素のテキストが空でないこと）
		const sampleKey = page.locator('[data-lp-key="indexB.k1"]').first();
		await expect(sampleKey, 'CSP 配下でも data-lp-key 要素が存在').toBeAttached();
		const text = await sampleKey.textContent();
		expect(text?.trim().length, 'data-lp-key の SSOT 注入後にテキストが入っている').toBeGreaterThan(
			0,
		);

		await ctx.close();
	});
});
