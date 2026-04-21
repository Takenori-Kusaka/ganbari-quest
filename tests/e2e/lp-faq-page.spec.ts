// tests/e2e/lp-faq-page.spec.ts
// #1291 B1-LP-3: FAQ 専用ページ (site/faq.html) の smoke 検証
//   - ページが 200 で返る
//   - 5 カテゴリがすべて描画される
//   - Q&A が最低 20 件掲載されている
//   - トップ LP から faq.html への導線が存在する
//   - pricing.html のフッターに faq.html リンクがある

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

test.describe('#1291 FAQ 専用ページ', () => {
	test('faq.html が 200 で返り h1「よくあるご質問」が表示される', async ({ page }) => {
		const response = await page.goto(`${baseUrl}/faq.html`, { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		await expect(page.locator('h1')).toHaveText('よくあるご質問');
	});

	test('5 カテゴリすべてが描画される (trial / pricing / privacy / usage / technical)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/faq.html`, { waitUntil: 'domcontentloaded' });

		for (const id of ['trial', 'pricing', 'privacy', 'usage', 'technical']) {
			const section = page.locator(`#${id}`);
			await expect(section, `category #${id} が存在`).toBeVisible();
			await expect(section.locator('h2'), `category #${id} に h2 が存在`).toBeVisible();
		}
	});

	test('Q&A が最低 20 件掲載されている (Issue AC)', async ({ page }) => {
		await page.goto(`${baseUrl}/faq.html`, { waitUntil: 'domcontentloaded' });
		const items = page.locator('.faq-category details.faq-item');
		const count = await items.count();
		expect(count, `faq-item 件数 (found=${count})`).toBeGreaterThanOrEqual(20);
	});

	test('details/summary が展開可能 (キーボード + クリック)', async ({ page }) => {
		await page.goto(`${baseUrl}/faq.html`, { waitUntil: 'domcontentloaded' });
		const firstItem = page.locator('.faq-category details.faq-item').first();
		await expect(firstItem).toHaveJSProperty('open', false);
		await firstItem.locator('summary').click();
		await expect(firstItem).toHaveJSProperty('open', true);
	});

	test('トップ LP (index.html) の FAQ セクションに faq.html への導線がある', async ({ page }) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		const faqLink = page.locator('#faq a[href="faq.html"]').first();
		await expect(faqLink).toBeVisible();
	});

	test('pricing.html のフッターに faq.html リンクがある', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded' });
		const footerFaqLink = page.locator('.footer a[href="faq.html"]');
		await expect(footerFaqLink).toBeVisible();
	});
});
