// tests/e2e/lp-copy-layout.spec.ts
// #1164: LP マイクロコピーのレイアウト品質を E2E で担保
//   - feature-monthly-report / feature-routine-checklist / feature-belongings-checklist
//     の各段落が text-align 左寄せ (left|start) で、1 行 40 文字以下 × 最大 3 行以内に収まる
//   - feature-section 内に feature-belongings-checklist 要素が存在する (持ち物 CL 独立)
// Note: feature-gender-preset は #1287/#1573 のLP改訂（soft-features 4カード拡張）で
//       feature-monthly-report に置き換えられたためテスト対象を更新（2026-04-27）

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

const PARAGRAPH_TESTIDS = [
	'feature-monthly-report',
	'feature-routine-checklist',
	'feature-belongings-checklist',
] as const;

test.describe('#1164 LP copy layout', () => {
	for (const testid of PARAGRAPH_TESTIDS) {
		test(`${testid} の段落が 1 行 40 文字以下 × 最大 3 行以内`, async ({ browser }) => {
			const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
			const page = await ctx.newPage();
			await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

			const card = page.getByTestId(testid);
			await expect(card).toBeVisible();

			const paragraph = card.locator('p').first();
			await expect(paragraph).toBeVisible();

			const textAlign = await paragraph.evaluate((el) => getComputedStyle(el).textAlign);
			expect(['left', 'start']).toContain(textAlign);

			// 段落の textContent は HTML ソースの literal \n + <br> 由来の改行は含まない。
			// innerText は <br> / block を \n に変換するため行数チェックに使う。
			const innerText = await paragraph.evaluate((el) => (el as HTMLElement).innerText);
			const lines = innerText
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => l.length > 0);

			expect(lines.length, `${testid} 行数 (${lines.length}) が 3 行以下`).toBeLessThanOrEqual(3);
			for (const line of lines) {
				expect(
					line.length,
					`${testid} 行 "${line}" の文字数 (${line.length}) が 40 文字以下`,
				).toBeLessThanOrEqual(40);
			}

			await ctx.close();
		});
	}

	test('feature-section 内に持ち物チェックリスト枠が存在 (#1164)', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const section = page.getByTestId('feature-section');
		await expect(section).toBeAttached();

		const belongingsCard = section.getByTestId('feature-belongings-checklist');
		await expect(belongingsCard).toBeAttached();

		const heading = belongingsCard.locator('h3').first();
		await expect(heading).toHaveText(/持ち物チェックリスト/);

		const image = belongingsCard.locator('img').first();
		await expect(image).toHaveAttribute('src', /feature-belongings-checklist/);

		await ctx.close();
	});
});
