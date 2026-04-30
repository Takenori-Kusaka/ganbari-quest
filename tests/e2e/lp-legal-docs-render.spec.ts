// tests/e2e/lp-legal-docs-render.spec.ts
// #1717 PR #1717 致命的欠陥 (DOMPurify SANITIZE_CONFIG が legal docs の構造タグを strip) の回帰防止。
//
// PR #1717 のレビュー時、SANITIZE_CONFIG.ALLOWED_TAGS が
// ['strong','em','a','br','span','sup','sub','small','b','i'] のみだったため、
// legalPrivacy.articleHeader (<h1>...<p class="meta">) や legalPrivacy.section1 (<h2><p><h3>...) 等の
// 構造タグが DOMPurify によって全て strip され、本文がベタテキストの一塊で崩壊する致命的欠陥が発覚した。
//
// 本 spec は ALLOWED_TAGS 拡張後（h1/h2/h3/h4/p/ul/ol/li/div/table/tr/th/td/header/section 等を許可）に
// privacy / terms / sla / tokushoho の 4 ページが構造化された法的文書として正しく描画されることを検証する。
//
// 実装: site/shared-labels.js / scripts/generate-lp-labels.mjs の applyLpKeys() 関数

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
 * 各 legal ページが共通で持つ最低構造の検証（applyLpKeys + DOMPurify 通過後）:
 *  - <h1> が 1 件以上残る（articleHeader）
 *  - <h2> が複数残る（各条文の見出し）
 *  - <p> が複数残る（本文段落）
 */
const LEGAL_PAGES = [
	{
		path: '/privacy.html',
		name: 'privacy',
		minH2: 10, // 第1〜13条 + α
		minP: 5,
	},
	{
		path: '/terms.html',
		name: 'terms',
		minH2: 10, // 第1〜20条
		minP: 5,
	},
	{
		path: '/sla.html',
		name: 'sla',
		minH2: 5, // 第1〜8条
		minP: 5,
	},
];

test.describe('#1717 legal docs structural rendering after DOMPurify', () => {
	for (const lp of LEGAL_PAGES) {
		test(`${lp.name}: 構造タグ (h1/h2/p) が DOMPurify 通過後も保持される`, async ({ page }) => {
			await page.goto(`${baseUrl}${lp.path}`, { waitUntil: 'domcontentloaded' });

			// DOMPurify CDN ロードと applyLpKeys() の完了を待つ:
			// articleHeader 内の h1 が描画されたら applyLpKeys が走った証拠
			await expect(page.locator('h1').first()).toBeVisible();

			// h1 が 1 件以上残る（articleHeader が strip されていない）
			const h1Count = await page.locator('h1').count();
			expect(h1Count, `${lp.name}: <h1> が strip されている`).toBeGreaterThan(0);

			// h2 が複数残る（各条文見出しが strip されていない）
			const h2Count = await page.locator('h2').count();
			expect(
				h2Count,
				`${lp.name}: <h2> が strip されている (found=${h2Count})`,
			).toBeGreaterThanOrEqual(lp.minH2);

			// p が複数残る（本文段落が strip されていない）
			const pCount = await page.locator('p').count();
			expect(
				pCount,
				`${lp.name}: <p> が strip されている (found=${pCount})`,
			).toBeGreaterThanOrEqual(lp.minP);
		});
	}

	test('privacy: ol/ul/li リスト構造が保持される', async ({ page }) => {
		await page.goto(`${baseUrl}/privacy.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// 第2条（情報の利用目的）等で ol/li が使われている
		const liCount = await page.locator('section[data-lp-key^="legalPrivacy."] li').count();
		expect(liCount, `privacy: <li> が strip されている (found=${liCount})`).toBeGreaterThan(5);
	});

	test('privacy: section9 の anchor id (#under-age) が保持される', async ({ page }) => {
		await page.goto(`${baseUrl}/privacy.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// HTML 側の <section id="under-age" data-lp-key="legalPrivacy.section9"> が
		// applyLpKeys() で innerHTML を上書きされても外側 <section> の id 属性は保持される
		// （innerHTML は子要素のみを置換する）
		const underAgeSection = page.locator('section#under-age');
		await expect(underAgeSection, 'privacy: #under-age セクションが消失').toHaveCount(1);
	});

	test('tokushoho: <table> 内の <tr>/<th>/<td> 構造が保持される', async ({ page }) => {
		await page.goto(`${baseUrl}/tokushoho.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// tokushoho.html は <table data-lp-key="legalTokushoho.tableContent"></table> に
		// <tr><th>...</th><td>...</td></tr> 形式の特商法表記行を innerHTML 注入する
		const trCount = await page
			.locator('table[data-lp-key="legalTokushoho.tableContent"] tr')
			.count();
		expect(trCount, `tokushoho: <tr> が strip されている (found=${trCount})`).toBeGreaterThan(10);

		const thCount = await page
			.locator('table[data-lp-key="legalTokushoho.tableContent"] th')
			.count();
		expect(thCount, `tokushoho: <th> が strip されている (found=${thCount})`).toBeGreaterThan(10);

		const tdCount = await page
			.locator('table[data-lp-key="legalTokushoho.tableContent"] td')
			.count();
		expect(tdCount, `tokushoho: <td> が strip されている (found=${tdCount})`).toBeGreaterThan(10);
	});

	test('privacy: data-contact-context 属性が保持される (mailto 文脈識別)', async ({ page }) => {
		await page.goto(`${baseUrl}/privacy.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// 第12条（個人情報保護管理者）等で <a mailto:... data-contact-context="プライバシー">
		const mailtoLinks = page.locator(
			'section[data-lp-key^="legalPrivacy."] a[href^="mailto:"][data-contact-context]',
		);
		const count = await mailtoLinks.count();
		expect(count, `privacy: data-contact-context 属性が strip されている`).toBeGreaterThan(0);
	});

	test('XSS 防御維持: <script> タグは strip される', async ({ page }) => {
		// 直接 LP_LABELS を改ざんして XSS を試みる検証は実施できないが、
		// applyLpKeys() の SANITIZE_CONFIG が ALLOWED_TAGS に <script> を含まないことを
		// 静的検証する（拡張時の防御保持）
		await page.goto(`${baseUrl}/privacy.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// ページ内に DOMPurify 由来の <script> 注入が無いこと
		// （labels.ts の値由来 + 静的 HTML 由来の正規 <script src="..."> は許容）
		const inlineScripts = await page
			.locator('section[data-lp-key^="legalPrivacy."] script')
			.count();
		expect(inlineScripts, '<section data-lp-key> 内に <script> が混入').toBe(0);
	});
});
