#!/usr/bin/env node
// #1291: FAQ 専用ページ (site/faq.html) のスクリーンショット撮影
//   desktop 1440 / mobile 390 の 2 viewport x full-page + top-fold
//   + index.html の縮小された FAQ セクション = 計 5 枚
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

const SITE_DIR = resolve('site');
const OUT_DIR = resolve('docs/screenshots/1291-faq-page');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
};

function startServer() {
	return new Promise((res, rej) => {
		const srv = createServer((req, rq) => {
			let p = decodeURIComponent((req.url || '/').split('?')[0] ?? '/');
			if (p === '/' || p === '') p = '/index.html';
			const fp = join(SITE_DIR, p);
			if (!fp.startsWith(SITE_DIR) || !existsSync(fp) || !statSync(fp).isFile()) {
				rq.writeHead(404);
				rq.end();
				return;
			}
			rq.writeHead(200, {
				'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream',
			});
			rq.end(readFileSync(fp));
		});
		srv.on('error', rej);
		srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
	});
}

async function main() {
	const { srv, port } = await startServer();
	const browser = await chromium.launch();
	try {
		// Desktop 1440 — faq.html full
		{
			const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
			const page = await ctx.newPage();
			await page.goto(`http://127.0.0.1:${port}/faq.html`, { waitUntil: 'domcontentloaded' });
			await waitForStablePage(page);
			await page.screenshot({
				path: join(OUT_DIR, 'faq-desktop-1440-full.png'),
				fullPage: true,
			});
			console.log('saved faq-desktop-1440-full.png');
			await page.screenshot({
				path: join(OUT_DIR, 'faq-desktop-1440-top.png'),
				clip: { x: 0, y: 0, width: 1440, height: 900 },
			});
			console.log('saved faq-desktop-1440-top.png');
			await ctx.close();
		}

		// Mobile 390 — faq.html full + TOC open (first category expanded)
		{
			const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
			const page = await ctx.newPage();
			await page.goto(`http://127.0.0.1:${port}/faq.html`, { waitUntil: 'domcontentloaded' });
			await waitForStablePage(page);
			await page.screenshot({
				path: join(OUT_DIR, 'faq-mobile-390-top.png'),
				clip: { x: 0, y: 0, width: 390, height: 844 },
			});
			console.log('saved faq-mobile-390-top.png');

			// Expand first Q of trial category
			await page.locator('#trial details.faq-item').first().locator('summary').click();
			await waitForStablePage(page, { skipNetworkIdle: true });
			await page.locator('#trial').scrollIntoViewIfNeeded();
			await waitForStablePage(page, { skipNetworkIdle: true });
			await page.screenshot({
				path: join(OUT_DIR, 'faq-mobile-390-category-trial-expanded.png'),
				fullPage: false,
			});
			console.log('saved faq-mobile-390-category-trial-expanded.png');
			await ctx.close();
		}

		// Desktop 1440 — index.html の FAQ 縮小セクション
		{
			const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
			const page = await ctx.newPage();
			await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
			await waitForStablePage(page);
			await page.locator('#faq').scrollIntoViewIfNeeded();
			await waitForStablePage(page, { skipNetworkIdle: true });
			await page.locator('#faq').screenshot({
				path: join(OUT_DIR, 'index-faq-section-shrunk.png'),
			});
			console.log('saved index-faq-section-shrunk.png');
			await ctx.close();
		}
	} finally {
		await browser.close();
		srv.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
