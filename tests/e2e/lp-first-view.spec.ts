// tests/e2e/lp-first-view.spec.ts
// #1163: LP (site/index.html) の 1st view 要件を E2E で担保
//   - Mobile 375×812 viewport で初回ビューポートに signup CTA が存在
//   - 料金カードがドキュメント高さの 75% 以内（最終 CTA より前）に存在
//   - ログインは NAV 内に `.nav-login` ghost button として描画される (#1285、CTA policy §7.2)

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

test.describe('#1163 LP 1st view 要件', () => {
	test('Mobile 375×812 の初回ビューポートに「無料で始める」CTA が見える', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		// #1290: 先頭 DOM 要素はヘッダーの `.nav-signup` だがモバイルでは `display:none`。
		// 1st view 要件は hero 本体に無料で始める CTA が見えることなので hero 配下を検査する。
		const signupCta = page.locator('.hero a.btn-primary', { hasText: '無料で始める' }).first();
		await expect(signupCta).toBeVisible();

		const box = await signupCta.boundingBox();
		expect(box, 'signup CTA boundingBox を取得できること').not.toBeNull();
		if (box) {
			expect(box.y, 'signup CTA が初回ビューポート内 (y < 812) に収まる').toBeLessThan(812);
			expect(box.y, 'signup CTA は hero セクション内（y > 0）').toBeGreaterThanOrEqual(0);
		}

		await ctx.close();
	});

	test('#1290 Desktop ヘッダーに常時 `.nav-signup` primary CTA が表示される (PC persistent)', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const headerSignup = page.locator('.header-nav a.nav-signup');
		await expect(headerSignup, 'PC ヘッダーに `.nav-signup` が存在する').toBeVisible();
		await expect(headerSignup).toHaveAttribute('href', /\/auth\/signup/);
		await expect(headerSignup).toHaveText('無料で始める');
		await expect(headerSignup).toHaveAttribute('data-testid', 'lp-nav-signup');

		// スクロール後もヘッダーごと sticky で追従し、CTA が見え続ける
		await page.evaluate(() => window.scrollTo(0, 3000));
		await expect(headerSignup, 'スクロール後もヘッダーの signup CTA が可視').toBeVisible();

		await ctx.close();
	});

	test('#1290 Mobile 375 では `.nav-signup` は非表示 (floating-cta と二重表示回避)', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const headerSignup = page.locator('.header-nav a.nav-signup');
		await expect(headerSignup, 'モバイルでは `.nav-signup` は display:none').toBeHidden();

		await ctx.close();
	});

	test('料金プロミスバンドがドキュメント高さの 75% 以内（最終 CTA の前）に存在する (#1293)', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`);

		const pricingBand = page.locator('#pricing .pp-band').first();
		await expect(pricingBand).toBeAttached({ timeout: 15_000 });

		const { bandTop, docHeight } = await page.evaluate(() => {
			const el = document.querySelector('#pricing .pp-band') as HTMLElement;
			return {
				bandTop: el.getBoundingClientRect().top + window.scrollY,
				docHeight: document.body.scrollHeight,
			};
		});
		const ratio = bandTop / docHeight;
		expect(
			ratio,
			`料金プロミスバンド Y=${bandTop}/docHeight=${docHeight} (=${(ratio * 100).toFixed(1)}%) が 75% 以内`,
		).toBeLessThanOrEqual(0.75);

		await ctx.close();
	});

	test('ログインは NAV 内の ghost button (.nav-login) として視覚的に区別される', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		// #1285: ログインは `.nav-login` ghost button (border + transparent bg) で NAV 内に描画される
		const loginLink = page.locator('.header-nav a.nav-login', { hasText: 'ログイン' });
		await expect(loginLink).toBeVisible();
		await expect(loginLink).toHaveAttribute('href', /\/auth\/login/);
		await expect(loginLink).toHaveAttribute('data-testid', 'lp-nav-login');

		// ghost button は border をもつ（nav-text とは視覚的に区別される）
		const borderWidth = await loginLink.evaluate((el) => getComputedStyle(el).borderTopWidth);
		expect(
			borderWidth,
			`ログインは枠線を持つ ghost button であること (borderTopWidth=${borderWidth})`,
		).not.toBe('0px');

		// `.nav-login` はプライマリ CTA と同じ `.btn-primary` 装飾にはしない（role 区別のため）
		const primaryLogin = page.locator('a.btn-primary', { hasText: 'ログイン' });
		await expect(
			primaryLogin,
			'ログインは .btn-primary 化しないこと (サインアップと役割を分離)',
		).toHaveCount(0);

		await ctx.close();
	});
});
