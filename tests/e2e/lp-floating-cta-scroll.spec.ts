// tests/e2e/lp-floating-cta-scroll.spec.ts
// #1732: floating-cta（モバイル下部追従 CTA）の文言がスクロール深度に応じて
// hero / mid / bottom の 3 phase で切替わることを E2E で担保する。
//
// 関連:
//   - site/index.html  (floating-cta 要素 + scroll listener)
//   - src/lib/domain/labels.ts (LP_FLOATING_CTA_LABELS)
//   - site/shared-labels.js (自動生成、GANBARI_LABELS.lp.floatingCta を提供)
//   - docs/design/lp-content-map.md §7.4 floating-cta 深度別文言

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

/**
 * docHeight を基準に N% の地点までスクロールする。
 * SHOW_AFTER_PX (500) を超えるよう注意。
 */
async function scrollToPercent(page: import('@playwright/test').Page, percent: number) {
	await page.evaluate((p) => {
		const docH = document.documentElement.scrollHeight || document.body.scrollHeight;
		const winH = window.innerHeight;
		const maxScroll = Math.max(1, docH - winH);
		const target = Math.floor((maxScroll * p) / 100);
		window.scrollTo(0, target);
	}, percent);
}

test.describe('#1732 floating-cta スクロール深度別文言', () => {
	test('mobile 375 で hero phase は heroText / heroButton を表示', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const floatingCta = page.locator('#floating-cta');
		await expect(floatingCta).toHaveAttribute('data-floating-cta', 'container');

		// hero pass 直後（10% 地点）— mid 閾値 30% 未満
		await scrollToPercent(page, 10);
		await expect(floatingCta).toHaveClass(/visible/);
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'hero');

		const text = page.locator('#floating-cta-text');
		await expect(text).toContainText('全機能を家族で試せる');
		await expect(text).toContainText('クレジットカード不要');

		const button = page.locator('#floating-cta-button');
		await expect(button).toHaveText('無料で始める');
		await expect(button).toHaveAttribute('href', /\/auth\/signup/);

		await ctx.close();
	});

	test('mobile 375 で mid phase に切替わると midText / midButton (デモを見る) を表示', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		// mid 閾値 30% 〜 bottom 閾値 70% の間、50% の地点へ
		await scrollToPercent(page, 50);

		const floatingCta = page.locator('#floating-cta');
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'mid');

		const text = page.locator('#floating-cta-text');
		// #1892 (PO-4-6 2 回目指摘): 「コアループ」内部用語撤廃で midText を「3 つの仕組みは 1 分で体験」に置換
		await expect(text).toContainText('3 つの仕組みは 1 分で体験');

		const button = page.locator('#floating-cta-button');
		await expect(button).toHaveText('デモを見る');
		await expect(button).toHaveAttribute('href', /\/demo/);

		// mid は hero と異なる文言であることを担保（Issue AC: hero と完全一致しない）
		await expect(text).not.toContainText('全機能を家族で試せる');

		await ctx.close();
	});

	test('mobile 375 で bottom phase は bottomText / 無料で始める を表示', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		// bottom 閾値 70% 以上、80% の地点（footer 200px 手前で hidden になる前）へ
		await scrollToPercent(page, 80);

		const floatingCta = page.locator('#floating-cta');
		// 80% は footer 直前で hidden になる可能性があるため phase 属性のみ確認
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'bottom');

		const text = page.locator('#floating-cta-text');
		await expect(text).toContainText('ここまで読まれた方へ');

		const button = page.locator('#floating-cta-button');
		await expect(button).toHaveText('無料で始める');
		await expect(button).toHaveAttribute('href', /\/auth\/signup/);

		// bottom は hero と異なる補強コピーであることを担保
		await expect(text).not.toContainText('全機能を家族で試せる');

		await ctx.close();
	});

	test('スクロール深度ごとに 3 phase 全て遷移する（hero → mid → bottom 順）', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const floatingCta = page.locator('#floating-cta');

		await scrollToPercent(page, 10);
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'hero');

		await scrollToPercent(page, 40);
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'mid');

		await scrollToPercent(page, 75);
		await expect(floatingCta).toHaveAttribute('data-floating-cta-phase', 'bottom');

		await ctx.close();
	});

	test('desktop ≥769 では floating-cta は非表示（既存挙動維持）', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

		const floatingCta = page.locator('#floating-cta');
		// CSS @media (min-width:769px) で display:none !important
		await expect(floatingCta).toBeHidden();

		await ctx.close();
	});
});
