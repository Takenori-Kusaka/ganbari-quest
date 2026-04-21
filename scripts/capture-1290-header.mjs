// #1290: ヘッダー常時 signup CTA のスクリーンショット撮影
//   desktop 1440 / laptop 1024 / mobile 390 の 3 viewport x 2 state (top / scrolled)
//   + selfhost.html desktop 1440 x 1 = 計 7 枚
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const SITE_DIR = resolve('site');
const OUT_DIR = resolve('docs/screenshots/1290-header-persistent-cta');

const MIME = {
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
		srv.listen(0, '127.0.0.1', () => {
			const a = srv.address();
			res({ srv, port: a.port });
		});
	});
}

async function capture({ page, url, width, height, name, scroll = 0 }) {
	await page.setViewportSize({ width, height });
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
	await page.waitForLoadState('networkidle').catch(() => {});
	if (scroll > 0) {
		await page.evaluate((y) => window.scrollTo(0, y), scroll);
		await page.waitForTimeout(300);
	}
	const path = join(OUT_DIR, `${name}.png`);
	// header-only clip for focus (top 200px)
	await page.screenshot({ path, clip: { x: 0, y: 0, width, height: Math.min(200, height) } });
	console.log(`saved ${path}`);
}

async function captureFull({ page, url, width, height, name }) {
	await page.setViewportSize({ width, height });
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
	await page.waitForLoadState('networkidle').catch(() => {});
	const path = join(OUT_DIR, `${name}.png`);
	await page.screenshot({ path });
	console.log(`saved ${path}`);
}

async function main() {
	const { srv, port } = await startServer();
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	try {
		const base = `http://127.0.0.1:${port}`;
		// index.html — desktop 1440 (top + scrolled)
		await captureFull({
			page,
			url: `${base}/index.html`,
			width: 1440,
			height: 900,
			name: 'index-desktop-1440-top',
		});
		await capture({
			page,
			url: `${base}/index.html`,
			width: 1440,
			height: 900,
			name: 'index-desktop-1440-header-top',
		});
		await page.evaluate(() => window.scrollTo(0, 2500));
		await page.waitForTimeout(400);
		await page.screenshot({
			path: join(OUT_DIR, 'index-desktop-1440-header-scrolled.png'),
			clip: { x: 0, y: 0, width: 1440, height: 200 },
		});
		console.log('saved index-desktop-1440-header-scrolled.png');

		// index.html — laptop 1024
		await capture({
			page,
			url: `${base}/index.html`,
			width: 1024,
			height: 768,
			name: 'index-laptop-1024-header-top',
		});

		// index.html — mobile 390 (header closed + hamburger open)
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		await page.waitForLoadState('networkidle').catch(() => {});
		await page.screenshot({
			path: join(OUT_DIR, 'index-mobile-390-header-closed.png'),
			clip: { x: 0, y: 0, width: 390, height: 200 },
		});
		console.log('saved index-mobile-390-header-closed.png');
		// open hamburger
		await page.click('.hamburger');
		await page.waitForTimeout(300);
		await page.screenshot({
			path: join(OUT_DIR, 'index-mobile-390-hamburger-open.png'),
			clip: { x: 0, y: 0, width: 390, height: 500 },
		});
		console.log('saved index-mobile-390-hamburger-open.png');

		// selfhost.html — desktop 1440
		await capture({
			page,
			url: `${base}/selfhost.html`,
			width: 1440,
			height: 900,
			name: 'selfhost-desktop-1440-header-top',
		});
	} finally {
		await browser.close();
		srv.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
