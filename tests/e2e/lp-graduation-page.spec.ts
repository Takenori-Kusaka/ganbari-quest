// tests/e2e/lp-graduation-page.spec.ts
// #1848: graduation.html 別ページ smoke 検証
//   - graduation.html が 200 で返る
//   - 5 ステージ (preschool/elementary/junior/senior/graduate) すべて描画される
//   - 各 stage に拡張サイズ (240px+) の gr-shot が含まれる
//   - LP 本体 (index.html) の #growth-roadmap CTA に graduation.html へのリンクがある
//   - LP 本体 #growth-roadmap セクションは CTA 1 行短縮 (旧 5 ステージ展開なし)
//   - footer に graduation.html リンクが index.html / pricing.html / faq.html / graduation.html すべてに存在する

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

test.describe('#1848 graduation.html 別ページ', () => {
	test('graduation.html が 200 で返り h1 が表示される', async ({ page }) => {
		const response = await page.goto(`${baseUrl}/graduation.html`, {
			waitUntil: 'domcontentloaded',
		});
		expect(response?.status()).toBe(200);
		await expect(page.locator('h1')).toHaveText('3 歳から 18 歳まで、そして「卒業」へ');
	});

	test('5 ステージすべて (preschool/elementary/junior/senior/graduate) が描画される', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/graduation.html`, { waitUntil: 'domcontentloaded' });
		for (const stage of ['preschool', 'elementary', 'junior', 'senior', 'graduate']) {
			const stageEl = page.locator(`article.gr-stage[data-stage="${stage}"]`);
			await expect(stageEl, `stage=${stage} が存在`).toBeVisible();
			await expect(stageEl.locator('h2'), `stage=${stage} に h2 がある`).toBeVisible();
		}
	});

	test('gr-shot が拡張サイズ (240px+) で表示される (Issue AC: 機能伝達不足を解消)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/graduation.html`, { waitUntil: 'domcontentloaded' });
		const firstShot = page.locator('article.gr-stage .gr-shot').first();
		await expect(firstShot).toBeVisible();
		const computedMaxHeight = await firstShot.evaluate((el) =>
			Number.parseInt(window.getComputedStyle(el).maxHeight, 10),
		);
		// mobile viewport で max-height: 240px (LP 本体 96px / 120px から拡張)
		expect(
			computedMaxHeight,
			`gr-shot.max-height computed=${computedMaxHeight}px (≥ 240px 要求)`,
		).toBeGreaterThanOrEqual(240);
	});

	test('パンくず (ホーム → 成長ロードマップ) が存在する', async ({ page }) => {
		await page.goto(`${baseUrl}/graduation.html`, { waitUntil: 'domcontentloaded' });
		const breadcrumb = page.locator('.graduation-breadcrumb');
		await expect(breadcrumb).toBeVisible();
		await expect(breadcrumb.locator('a[href="index.html"]')).toHaveText('ホーム');
	});

	test('LP 本体 (index.html) の #growth-roadmap CTA に graduation.html リンクがある', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		const ctaLink = page.locator('#growth-roadmap a[href="graduation.html"]').first();
		await expect(ctaLink).toBeVisible();
	});

	test('LP 本体 #growth-roadmap は CTA 1 行に短縮されている (旧 5 ステージ展開がない)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		// LP 本体には .gr-stage が 0 件 (graduation.html に移管済み)
		const stages = page.locator('#growth-roadmap .gr-stage');
		const count = await stages.count();
		expect(
			count,
			`LP 本体 #growth-roadmap.gr-stage 件数 (found=${count}, 期待=0)`,
		).toBe(0);
	});

	test('LP 主要 4 ページの footer に graduation.html リンクがある (navigable 担保)', async ({
		page,
	}) => {
		for (const path of ['/index.html', '/pricing.html', '/faq.html', '/graduation.html']) {
			await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
			const footerLink = page.locator('.footer a[href="graduation.html"]');
			await expect(
				footerLink,
				`${path} の footer に graduation.html リンクが存在`,
			).toBeVisible();
		}
	});
});
