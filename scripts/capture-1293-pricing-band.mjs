#!/usr/bin/env node
// #1293: 料金プロミスバンドのスクリーンショット撮影
//   desktop 1440 / mobile 390 の 2 viewport で #pricing セクションを撮影
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

const SITE_DIR = resolve('site');
const OUT_DIR = resolve('docs/screenshots/1293-pricing-promise-band');

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
		for (const [label, width, height] of [
			['desktop-1440', 1440, 900],
			['mobile-390', 390, 844],
		]) {
			const ctx = await browser.newContext({ viewport: { width, height } });
			const page = await ctx.newPage();
			await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
			await waitForStablePage(page);
			await page.locator('#pricing').scrollIntoViewIfNeeded();
			await waitForStablePage(page, { skipNetworkIdle: true });
			await page.locator('#pricing').screenshot({
				path: join(OUT_DIR, `pricing-band-${label}.png`),
			});
			console.log(`saved pricing-band-${label}.png`);
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
