// tests/e2e/lp-no-achievement-revival.spec.ts
// #1782: LP に「実績 & 称号」「実績解放」「称号コレクション」訴求が再混入しないことを保証する
// E2E 回帰テスト。
//
// ADR-0012 §6（収集目的の独立 UI / 称号コレクション閲覧ページ /
// ミッションリスト UI 駆動導線 禁止）整合 + #404 廃止合意の revert 復活への対応として、
// LP の machine-tour [04]-① 「実績 & 称号」カード削除が定着していることを確認する。
//
// 注: scripts/measure-lp-dimensions.mjs の STRICT_FORBIDDEN_TERMS で同様の検出が行われるが、
// E2E では SSOT 注入後の DOM レンダリング結果を検査する点が異なる
// （innerHTML 注入前の HTML 直書き値ではなく、applyLpKeys() 注入後の実際の表示文字列を検証）。

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

const FORBIDDEN_PHRASES_INDEX = ['実績解放', '実績 & 称号', '実績 &amp; 称号', '称号コレクション'];

test.describe('#1782 実績機能廃止後の LP 再混入防止', () => {
	test('LP index.html の表示テキストに禁止語彙が含まれない', async ({ page }) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		// applyLpKeys() の SSOT 注入完了を待つ
		await page.waitForFunction(
			() => document.querySelector('h1[data-lp-key]')?.textContent?.length ?? 0,
			{ timeout: 5000 },
		);

		const bodyText = (await page.locator('body').innerText()) ?? '';
		for (const phrase of FORBIDDEN_PHRASES_INDEX) {
			expect(bodyText, `LP 本文に禁止語彙 "${phrase}" が再混入していない`).not.toContain(phrase);
		}
	});

	test('machine-tour セクションは 2 cards に圧縮されている (旧 ① 実績 & 称号 削除)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		// machine-tour 配下の tour-card 数 = 2
		const tourCards = page.locator('#machine-tour .tour-card');
		await expect(tourCards).toHaveCount(2);

		// 持ち物チェックリスト + RPG バトルが残る
		await expect(page.locator('[data-testid="feature-belongings-checklist"]')).toBeVisible();
		await expect(page.locator('[data-testid="feature-rpg-battle"]')).toBeVisible();
	});

	test('faq.html / pricing.html / pamphlet.html にも禁止語彙が含まれない', async ({ page }) => {
		const targets = ['/faq.html', '/pricing.html', '/pamphlet.html'];
		for (const path of targets) {
			await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
			await page.waitForLoadState('domcontentloaded');
			const bodyText = (await page.locator('body').innerText()) ?? '';
			for (const phrase of FORBIDDEN_PHRASES_INDEX) {
				expect(bodyText, `${path} に禁止語彙 "${phrase}" が再混入していない`).not.toContain(phrase);
			}
		}
	});

	test('feature-titles.webp 参照が LP から削除されている (broken image 解消)', async ({ page }) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		const titlesImgs = page.locator('img[src*="feature-titles"]');
		await expect(titlesImgs).toHaveCount(0);
	});
});
