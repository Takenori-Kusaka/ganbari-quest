#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
// #1286 用: 安心訴求セクションの PC / mobile スクリーンショット
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

const SITE_DIR = resolve('site');
const OUT_DIR = resolve('docs/screenshots/1286-lp-trust-section');

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
		// Desktop
		const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const dp = await dctx.newPage();
		await dp.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
		await dp.locator('#trust').scrollIntoViewIfNeeded();
		await waitForStablePage(dp, { skipNetworkIdle: true });
		await dp.locator('#trust').screenshot({ path: join(OUT_DIR, 'trust-desktop.png') });
		console.log('captured trust-desktop.png');

		// Mobile 375×812
		const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
		const mp = await mctx.newPage();
		await mp.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
		await mp.locator('#trust').scrollIntoViewIfNeeded();
		await waitForStablePage(mp, { skipNetworkIdle: true });
		await mp.locator('#trust').screenshot({ path: join(OUT_DIR, 'trust-mobile.png') });
		console.log('captured trust-mobile.png');

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
