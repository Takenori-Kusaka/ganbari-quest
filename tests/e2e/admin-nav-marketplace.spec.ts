// tests/e2e/admin-nav-marketplace.spec.ts
// #1170: マケプレをグローバルナビに昇格した導線の E2E 検証
//
// 検証対象:
// 1. /marketplace は認証不要のパブリックルート (ADR-0036) として 200 で開ける
// 2. 管理画面 (/admin) の「活動設定」カテゴリ submenu に nav-marketplace が含まれる
//    (Desktop: hover で dropdown を開く / Mobile 375x667: category button tap で submenu を開く)
// 3. LP (site/index.html, site/pricing.html) の header-nav に lp-nav-marketplace が含まれる
//
// 注意:
//   - ローカル E2E は AUTH_MODE=local のため /admin へのアクセスは素通し (cognito mock 不要)
//   - LP は静的 HTML のため、lp-copy-layout.spec.ts と同じ node:http 静的サーバパターンで検証
//   - Mobile viewport では `tests/e2e/helpers.ts` 流の testid ベースのセレクタを使用

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

let lpServer: Server;
let lpBaseUrl: string;

test.beforeAll(async () => {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		lpServer = createServer((req, res) => {
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
		lpServer.on('error', rejectPromise);
		lpServer.listen(0, '127.0.0.1', () => {
			const addr = lpServer.address();
			if (!addr || typeof addr === 'string') {
				rejectPromise(new Error('Failed to bind LP static server'));
				return;
			}
			lpBaseUrl = `http://127.0.0.1:${addr.port}`;
			resolvePromise();
		});
	});
});

test.afterAll(async () => {
	await new Promise<void>((resolvePromise) => lpServer.close(() => resolvePromise()));
});

test.describe('#1170 マケプレ グローバルナビ導線', () => {
	// ============================================================
	// 1. /marketplace は認証不要で開ける (ADR-0036)
	// ============================================================
	test('/marketplace がパブリックルートとして 200 で開ける', async ({ page }) => {
		const response = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		// マケプレのページ本体が描画されていることを軽く確認
		await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	});

	// ============================================================
	// 2. 管理画面 Desktop: 活動設定 dropdown に nav-marketplace が含まれる
	// AdminLayout は md:block / md:hidden で Desktop/Mobile を切り替えているため、
	// mobile viewport (Pixel 7) では `nav[data-tutorial="nav-desktop"]` 自体が hidden。
	// よって Desktop 専用テストとして viewport.width >= 768 の場合のみ実行する。
	// ============================================================
	test('Desktop 管理画面: 活動設定 dropdown に nav-marketplace が visible', async ({
		page,
		viewport,
	}) => {
		test.skip(
			!viewport || viewport.width < 768,
			'Desktop-only: AdminLayout Desktop nav is hidden on mobile viewport (md:hidden)',
		);
		test.slow(); // Vite dev cold compile
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });

		// 「活動設定」カテゴリボタンを hover して dropdown を開く
		// navCategories[].id === 'customize' / label は NAV_CATEGORIES.customize.label
		// ボタン内のテキスト 'アクティビティ' or equivalent — data-tutorial は nav-desktop
		const desktopNav = page.locator('nav[data-tutorial="nav-desktop"]');
		await expect(desktopNav).toBeVisible();

		// category.label は NAV_CATEGORIES.customize.label ('活動設定')
		const customizeBtn = desktopNav.getByRole('button', { name: /活動設定/ });
		await expect(customizeBtn).toBeVisible();
		await customizeBtn.hover();

		// dropdown 内の nav-marketplace link
		const marketplaceLink = page.getByTestId('nav-marketplace');
		await expect(marketplaceLink).toBeVisible();
		await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');
	});

	// ============================================================
	// 3. 管理画面 Mobile (375x667): 活動設定 submenu に nav-marketplace-mobile が含まれる
	// ============================================================
	test('Mobile 375x667 管理画面: 活動設定 submenu に nav-marketplace-mobile が visible', async ({
		browser,
	}) => {
		test.slow();
		const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
		const page = await ctx.newPage();
		try {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });

			// Mobile bottom nav — 活動設定 category button
			const mobileNav = page.locator('nav[data-tutorial="nav-primary"]');
			await expect(mobileNav).toBeVisible();
			const customizeBtn = mobileNav.getByRole('button', { name: /活動設定/ });
			await expect(customizeBtn).toBeVisible();
			await customizeBtn.click();

			// submenu 内の nav-marketplace-mobile link
			const marketplaceLink = page.getByTestId('nav-marketplace-mobile');
			await expect(marketplaceLink).toBeVisible();
			await expect(marketplaceLink).toHaveAttribute('href', '/marketplace');
		} finally {
			await ctx.close();
		}
	});

	// ============================================================
	// 4. LP /index.html header-nav: lp-nav-marketplace が absolute URL を指す
	// site/shared.css: @media (max-width: 768px) で `.header-nav { display: none }` かつ
	// `.hamburger` を表示。mobile では hamburger を開いてから visibility 検証する。
	// ============================================================
	test('LP /index.html: lp-nav-marketplace が visible で /marketplace に遷移する', async ({
		page,
		viewport,
	}) => {
		await page.goto(`${lpBaseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		if (viewport && viewport.width <= 768) {
			await page.locator('button.hamburger').click();
		}
		const link = page.getByTestId('lp-nav-marketplace');
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', 'https://ganbari-quest.com/marketplace');
	});

	// ============================================================
	// 5. LP /pricing.html header-nav: lp-nav-marketplace が absolute URL を指す
	// ============================================================
	test('LP /pricing.html: lp-nav-marketplace が visible で /marketplace に遷移する', async ({
		page,
		viewport,
	}) => {
		await page.goto(`${lpBaseUrl}/pricing.html`, { waitUntil: 'domcontentloaded' });
		if (viewport && viewport.width <= 768) {
			await page.locator('button.hamburger').click();
		}
		const link = page.getByTestId('lp-nav-marketplace');
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', 'https://ganbari-quest.com/marketplace');
	});
});
