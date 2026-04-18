// tests/e2e/lp-first-view.spec.ts
// #1163: LP (site/index.html) の 1st view 要件を E2E で担保
//   - Mobile 375×812 viewport で初回ビューポートに signup CTA が存在
//   - 料金カードがドキュメント高さの 75% 以内（最終 CTA より前）に存在
//   - ログインはボタン化されず NAV テキストリンクのみ (CTA policy §7.2)

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

		const signupCta = page.locator('a.btn-primary', { hasText: '無料で始める' }).first();
		await expect(signupCta).toBeVisible();

		const box = await signupCta.boundingBox();
		expect(box, 'signup CTA boundingBox を取得できること').not.toBeNull();
		if (box) {
			expect(box.y, 'signup CTA が初回ビューポート内 (y < 812) に収まる').toBeLessThan(812);
			expect(box.y, 'signup CTA は hero セクション内（y > 0）').toBeGreaterThanOrEqual(0);
		}

		await ctx.close();
	});

	test('料金カードがドキュメント高さの 75% 以内（最終 CTA の前）に存在する', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });

		const pricingCard = page.locator('#pricing .pricing-summary-card').first();
		await expect(pricingCard).toBeAttached();

		const { cardTop, docHeight } = await page.evaluate(() => {
			const el = document.querySelector('#pricing .pricing-summary-card') as HTMLElement;
			return {
				cardTop: el.getBoundingClientRect().top + window.scrollY,
				docHeight: document.body.scrollHeight,
			};
		});
		const ratio = cardTop / docHeight;
		expect(
			ratio,
			`料金カード Y=${cardTop}/docHeight=${docHeight} (=${(ratio * 100).toFixed(1)}%) が 75% 以内`,
		).toBeLessThanOrEqual(0.75);

		await ctx.close();
	});

	test('ログインはボタン化されず、NAV 内のテキストリンクのみ', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const loginLink = page.locator('.header-nav a.nav-text', { hasText: 'ログイン' });
		await expect(loginLink).toBeVisible();
		await expect(loginLink).toHaveAttribute('href', /\/auth\/login/);

		const loginButton = page.locator('.btn', { hasText: 'ログイン' });
		await expect(loginButton, 'ログインは .btn 化されないこと').toHaveCount(0);

		await ctx.close();
	});
});
