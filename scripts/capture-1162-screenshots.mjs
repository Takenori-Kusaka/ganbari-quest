#!/usr/bin/env node

// #1162 Epic 検収スクショ撮影スクリプト
// PO 検収項目 3 点を自動撮影する:
//   1. /marketplace (desktop) の age+gender 2 クリック絞込 (before/after)
//   2. LP (site/index.html) mobile ビューでマケプレ導線
//   3. /demo/checklist で 持ち物/ルーティン 2 タブ分離
//
// 前提: npm run dev:cognito が http://localhost:5174 で起動済み

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = resolve('docs/screenshots/1162-epic-verification');
const DEV_URL = 'http://localhost:5174';
const SITE_DIR = resolve('site');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
};

function startLpServer() {
	return new Promise((resolve_) => {
		const server = createServer((req, res) => {
			try {
				let url = decodeURIComponent((req.url || '/').split('?')[0]);
				if (url.endsWith('/')) url += 'index.html';
				const filePath = join(SITE_DIR, url);
				if (!existsSync(filePath) || !statSync(filePath).isFile()) {
					res.statusCode = 404;
					return res.end('not found');
				}
				const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
				res.setHeader('content-type', mime);
				res.end(readFileSync(filePath));
			} catch (e) {
				res.statusCode = 500;
				res.end(String(e));
			}
		});
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolve_({ server, url: `http://127.0.0.1:${port}` });
		});
	});
}

// フォームを POST で直接叩いて Cookie セッションを確立する。
// bind:value が headless chromium で反応しないケースを避けるため、DOM 操作を
// スキップし form action (?/login) に直接 POST する。
async function loginAsFamily(page) {
	const form = new URLSearchParams();
	form.set('email', 'family@example.com');
	form.set('password', 'Gq!Dev#Fam2026xyz');
	const res = await page.request.post(`${DEV_URL}/auth/login?/login`, {
		form: Object.fromEntries(form),
		headers: { 'x-sveltekit-action': 'true' },
		maxRedirects: 0,
		failOnStatusCode: false,
	});
	if (![200, 204, 302, 303].includes(res.status())) {
		throw new Error(`Login POST failed: ${res.status()} ${await res.text()}`);
	}
	await page.goto(`${DEV_URL}/admin`, { waitUntil: 'commit', timeout: 120_000 });
	await page.waitForURL(/\/admin/, { timeout: 60_000 }).catch(() => {});
}

async function captureMarketplace(browser) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	try {
		await loginAsFamily(page);

		await page.goto(`${DEV_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle').catch(() => {});

		// Before filter
		await page.screenshot({
			path: join(OUT_DIR, '01-marketplace-desktop-before-filter.png'),
			fullPage: true,
		});

		// Click 1: age = elementary
		const ageElem = page.locator('[data-testid="filter-age-elementary"]').first();
		if (await ageElem.isVisible({ timeout: 3000 }).catch(() => false)) {
			await ageElem.click();
			await page.waitForLoadState('networkidle').catch(() => {});
		}

		// Click 2: gender = boy
		const boyChip = page.locator('[data-testid="filter-gender-boy"]').first();
		if (await boyChip.isVisible({ timeout: 3000 }).catch(() => false)) {
			await boyChip.click();
			await page.waitForLoadState('networkidle').catch(() => {});
		}

		await page.screenshot({
			path: join(OUT_DIR, '02-marketplace-desktop-after-2click-filter.png'),
			fullPage: true,
		});
		console.log('[ok] marketplace screenshots captured');
	} finally {
		await ctx.close();
	}
}

async function captureLp(browser, lpUrl) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	try {
		await page.goto(lpUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle').catch(() => {});
		// Top of LP with header nav
		await page.screenshot({
			path: join(OUT_DIR, '03-lp-mobile-top-with-marketplace-nav.png'),
			fullPage: false,
		});

		// Full LP mobile for context
		await page.screenshot({
			path: join(OUT_DIR, '04-lp-mobile-fullpage.png'),
			fullPage: true,
		});
		console.log('[ok] LP mobile screenshots captured');
	} finally {
		await ctx.close();
	}
}

async function captureDemoChecklist(browser) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	try {
		await page.goto(`${DEV_URL}/demo/checklist`, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle').catch(() => {});
		await page.screenshot({
			path: join(OUT_DIR, '05-demo-checklist-mobile-tabs.png'),
			fullPage: true,
		});

		// Desktop view too
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.waitForTimeout(300); // layout settle
		await page.screenshot({
			path: join(OUT_DIR, '06-demo-checklist-desktop-tabs.png'),
			fullPage: true,
		});
		console.log('[ok] demo checklist screenshots captured');
	} finally {
		await ctx.close();
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const { server, url: lpUrl } = await startLpServer();
	try {
		await captureMarketplace(browser);
		await captureLp(browser, lpUrl);
		await captureDemoChecklist(browser);
	} finally {
		await browser.close();
		server.close();
	}
	console.log(`[done] screenshots saved to ${OUT_DIR}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
