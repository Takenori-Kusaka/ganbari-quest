#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
// #1288 用: マイクロコピー変更箇所の検証スクリーンショット
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const SITE_DIR = resolve('site');
const OUT_DIR = resolve('docs/screenshots/1288-lp-microcopy');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

function serveStatic(rootDir) {
	return new Promise((resolvePromise, rejectPromise) => {
		const server = createServer((req, res) => {
			let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
			if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
			const filePath = join(rootDir, urlPath);
			if (!filePath.startsWith(rootDir)) return res.writeHead(403).end();
			if (!existsSync(filePath) || !statSync(filePath).isFile())
				return res.writeHead(404).end('Not Found');
			const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': mime });
			res.end(readFileSync(filePath));
		});
		server.on('error', rejectPromise);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolvePromise({ server, port: addr.port });
		});
	});
}

async function main() {
	const { server, port } = await serveStatic(SITE_DIR);
	const browser = await chromium.launch();
	try {
		const baseUrl = `http://127.0.0.1:${port}`;

		// Desktop
		const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const dp = await dctx.newPage();

		await dp.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await dp.locator('#machine-tour').scrollIntoViewIfNeeded();
		await dp.waitForTimeout(400);
		await dp.locator('#machine-tour').screenshot({ path: join(OUT_DIR, 'tour-title-desktop.png') });
		console.log('captured tour-title-desktop.png');

		await dp.locator('.cta-bottom').scrollIntoViewIfNeeded();
		await dp.waitForTimeout(400);
		await dp.locator('.cta-bottom').screenshot({ path: join(OUT_DIR, 'cta-bottom-desktop.png') });
		console.log('captured cta-bottom-desktop.png');

		// pricing.html 機能比較テーブル (ルーティン → 朝夜の習慣リスト)
		await dp.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded' });
		await dp.locator('text=/朝夜の習慣リスト/').first().scrollIntoViewIfNeeded();
		await dp.waitForTimeout(400);
		await dp
			.locator('.feature-matrix, .pricing-table, table')
			.first()
			.screenshot({ path: join(OUT_DIR, 'pricing-routine-desktop.png') });
		console.log('captured pricing-routine-desktop.png');

		// Mobile floating CTA + final CTA
		const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const mp = await mctx.newPage();
		await mp.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await mp.locator('.cta-bottom').scrollIntoViewIfNeeded();
		await mp.waitForTimeout(500);
		await mp.locator('.cta-bottom').screenshot({ path: join(OUT_DIR, 'cta-bottom-mobile.png') });
		console.log('captured cta-bottom-mobile.png');

		// Floating CTA: scroll to middle so #floating-cta is visible
		await mp.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
		await mp.waitForTimeout(600);
		await mp.screenshot({
			path: join(OUT_DIR, 'floating-cta-mobile.png'),
			clip: { x: 0, y: 712, width: 375, height: 100 },
		});
		console.log('captured floating-cta-mobile.png');

		// Mobile machine-tour title
		await mp.locator('#machine-tour').scrollIntoViewIfNeeded();
		await mp.waitForTimeout(400);
		await mp
			.locator('#machine-tour .section-title')
			.screenshot({ path: join(OUT_DIR, 'tour-title-mobile.png') });
		console.log('captured tour-title-mobile.png');

		await dctx.close();
		await mctx.close();
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
