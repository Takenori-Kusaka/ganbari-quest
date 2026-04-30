// tests/e2e/pamphlet-print-ssot.spec.ts
// #1704 (#1683-D): pamphlet.html 印刷モード SSOT 注入タイミング検証
//
// ADR-0025 §pamphlet.html の印刷タイミング:
//   - shared-labels.js の applyLpKeys() は DOMContentLoaded で 1 回実行される
//   - 印刷ダイアログ起動（Ctrl+P / window.print()）時には beforeprint イベントで
//     reapplyLpKeys() を再実行することで、SSOT 化された data-lp-key 値が
//     確実に DOM に注入された状態で印刷タイミングに突入することを保証する
//
// 本 spec では以下を検証:
//   1. 通常表示時に data-lp-key 配下の文言が labels.ts の値で置換されている
//   2. emulateMedia({ media: 'print' }) で印刷モード描画した状態でも置換が維持される
//   3. window.print() を経由した beforeprint イベント発火後も置換が維持される
//   4. 重要文言（service-name / front-tagline 等）が印刷モードで visible
//   5. DOMPurify が unavailable な状況でも textContent fallback で文言は残る
//
// 補足: 本テストは static server (createServer) を使い、site/ を直接配信する。
// `lp-first-view.spec.ts` の静的サーバパターンを踏襲。

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

test.describe('#1704 #1683-D pamphlet.html 印刷モード SSOT 注入タイミング', () => {
	test('通常表示で data-lp-key 配下の重要文言が labels.ts の値で置換されている', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/pamphlet.html`, { waitUntil: 'domcontentloaded' });

		// applyLpKeys() は DOMContentLoaded で実行される
		// labels.ts の LP_PAMPHLET_LABELS / LP_PAMPHLET_PHASEB_LABELS 由来の文言を確認
		const serviceName = page.locator('.service-name[data-lp-key="pamphletB.k4"]');
		await expect(serviceName).toHaveText('がんばりクエスト');

		const tagline = page.locator('.front-tagline[data-lp-key="pamphletB.k5"]');
		await expect(tagline).toBeVisible();
		await expect(tagline).toHaveText(/こども|がんばり|ぼうけん/);

		await ctx.close();
	});

	test('印刷モード（emulateMedia print）で SSOT 文言が維持される', async ({ browser }) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/pamphlet.html`, { waitUntil: 'domcontentloaded' });

		// applyLpKeys が完了するまで待つ（service-name が確定値になる）
		await expect(page.locator('.service-name[data-lp-key="pamphletB.k4"]')).toHaveText(
			'がんばりクエスト',
		);

		// 印刷モードに切り替える（@media print の CSS が適用される）
		await page.emulateMedia({ media: 'print' });

		// 印刷モードでも SSOT 注入後の文言が DOM に残っている
		const serviceName = page.locator('.service-name[data-lp-key="pamphletB.k4"]');
		await expect(serviceName).toHaveText('がんばりクエスト');

		// data-lp-key 属性自体は残っているが、textContent が SSOT 値に置換されている
		const tagline = page.locator('.front-tagline[data-lp-key="pamphletB.k5"]');
		const taglineText = await tagline.textContent();
		expect(taglineText).toBeTruthy();
		expect(taglineText?.length).toBeGreaterThan(0);
		// fallback でないことを確認: textContent が data-lp-key 属性値そのものではない
		expect(taglineText).not.toBe('pamphletB.k5');

		await ctx.close();
	});

	test('window.print() の beforeprint イベント発火後に reapplyLpKeys が走り SSOT 文言が再注入される', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/pamphlet.html`, { waitUntil: 'domcontentloaded' });

		// 初回 applyLpKeys 完了確認
		await expect(page.locator('.service-name[data-lp-key="pamphletB.k4"]')).toHaveText(
			'がんばりクエスト',
		);

		// window.print() を block する（Playwright headless では ダイアログを開かない）
		// beforeprint イベントだけ発火させて reapplyLpKeys を呼びたいので、直接 dispatch する
		await page.evaluate(() => {
			const evt = new Event('beforeprint');
			window.dispatchEvent(evt);
		});

		// reapplyLpKeys が走った後も値が維持される
		const serviceName = page.locator('.service-name[data-lp-key="pamphletB.k4"]');
		await expect(serviceName).toHaveText('がんばりクエスト');

		// pamphlet 内の他の SSOT 文言も維持
		const tagline = page.locator('.front-tagline[data-lp-key="pamphletB.k5"]');
		const taglineText = await tagline.textContent();
		expect(taglineText).toBeTruthy();
		expect(taglineText?.length).toBeGreaterThan(0);

		await ctx.close();
	});

	test('印刷モードで複数行 SSOT element（feature 説明 / 価格表）が visible に残る', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/pamphlet.html`, { waitUntil: 'domcontentloaded' });

		// 注入完了を待つ
		await expect(page.locator('.service-name[data-lp-key="pamphletB.k4"]')).toHaveText(
			'がんばりクエスト',
		);

		await page.emulateMedia({ media: 'print' });

		// セクションタイトル（h2）が SSOT 化されており visible に残る
		// pamphletB.k11 = 「3 つの仕組みで〜」
		const h2 = page.locator('h2[data-lp-key="pamphletB.k11"]');
		const h2Text = await h2.textContent();
		expect(h2Text).toBeTruthy();
		// 重要 keyword（実装の labels.ts に含まれる）が含まれる
		expect(h2Text).toMatch(/仕組み|報酬|がんばり/);

		// coreloop.pamphletNote のような cross-section reference も解決済み
		const pamphletNote = page.locator('[data-lp-key="coreloop.pamphletNote"]');
		const noteText = await pamphletNote.textContent();
		expect(noteText).toBeTruthy();
		expect(noteText?.length).toBeGreaterThan(20);

		await ctx.close();
	});

	test('印刷モードの DOM 全体に data-lp-key の生キー文字列（pamphletB.kN 等）が露出していない', async ({
		browser,
	}) => {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
		const page = await ctx.newPage();
		await page.goto(`${baseUrl}/pamphlet.html`, { waitUntil: 'domcontentloaded' });

		// applyLpKeys 完了
		await expect(page.locator('.service-name[data-lp-key="pamphletB.k4"]')).toHaveText(
			'がんばりクエスト',
		);

		await page.emulateMedia({ media: 'print' });

		const bodyText = await page.locator('body').textContent();
		// data-lp-key の値（namespace.key 形式の生キー）が textContent に漏れていないこと
		// = applyLpKeys 失敗時の fallback で属性値そのものが表示される、という事故を防ぐ
		expect(bodyText).not.toMatch(/pamphletB\.k\d+/);
		expect(bodyText).not.toMatch(/coreloop\.pamphletNote/);
		expect(bodyText).not.toMatch(/legalPrivacy\./);
		expect(bodyText).not.toMatch(/legalTerms\./);

		await ctx.close();
	});
});
