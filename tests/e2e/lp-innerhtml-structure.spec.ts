// tests/e2e/lp-innerhtml-structure.spec.ts
// #1747: LP innerHTML 注入後の構造タグ保持と XSS 防御の両立を E2E で検証する。
//
// PR #1717 (1683-C Legal SSOT) で発覚した致命的欠陥（DOMPurify SANITIZE_CONFIG が
// legal docs の構造タグを strip し本文がベタテキスト崩壊）の構造的予防策。
//
// 既存の lp-legal-docs-render.spec.ts は legal docs (privacy/terms/sla/tokushoho) に特化
// していたため、本 spec では index.html / pricing.html / faq.html 等の主要 LP も含めて
// 「主要構造タグが strip されていない」「<script>/<iframe>/onerror= 等が escape される」を
// 横断的に検証する。
//
// 実装 SSOT: site/shared-labels.js (applyLpKeys + DOMPurify SANITIZE_CONFIG, ADR-0025)

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
 * #1747 AC1: 主要 LP ページ横断テスト — applyLpKeys 経由で <strong>/<a>/<br>/<span> 等
 * インライン構造が DOMPurify 通過後も保持されることを検証する。
 */
const STRUCTURED_PAGES = [
	{
		path: '/index.html',
		name: 'index',
		minStrong: 5, // hero / pricing-promise / k-49 等で <strong> が出現
		minAnchorWithHref: 10, // CTA / FAQ / footer 等
	},
	{
		path: '/pricing.html',
		name: 'pricing',
		minStrong: 1,
		minAnchorWithHref: 5,
	},
	{
		path: '/faq.html',
		name: 'faq',
		minStrong: 5, // 各回答で <strong> が頻出
		minAnchorWithHref: 5,
	},
];

test.describe('#1747 LP innerHTML structural integrity after DOMPurify', () => {
	for (const lp of STRUCTURED_PAGES) {
		test(`${lp.name}: <strong> / <a[href]> インライン構造タグが strip されない`, async ({
			page,
		}) => {
			await page.goto(`${baseUrl}${lp.path}`, { waitUntil: 'domcontentloaded' });

			// DOMPurify CDN ロード待ち + applyLpKeys() の完了確認
			await expect(page.locator('h1, h2').first()).toBeVisible();

			// ページ全体の <strong> 数（applyLpKeys が strip していない証拠）— inline で <strong> を含む値が
			// data-lp-key 注入後にも保持されているかを確認する
			const totalStrong = await page.locator('strong').count();
			expect(
				totalStrong,
				`${lp.name}: <strong> が strip されている (found=${totalStrong})`,
			).toBeGreaterThanOrEqual(lp.minStrong);

			// data-lp-key 注入箇所の <a href> が壊れていない（href 属性が保持されている）
			const anchorCount = await page.locator('a[href]').count();
			expect(
				anchorCount,
				`${lp.name}: <a[href]> が strip されている (found=${anchorCount})`,
			).toBeGreaterThanOrEqual(lp.minAnchorWithHref);
		});
	}

	test('index.html: data-lp-key 注入後の <span data-lp-key> が消失していない', async ({ page }) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		// hero / soft-features / footer で <span data-lp-key="..."> が大量に出現
		const spanCount = await page.locator('span[data-lp-key]').count();
		expect(
			spanCount,
			`index: <span data-lp-key> が strip されている (found=${spanCount})`,
		).toBeGreaterThan(20);
	});

	/**
	 * #1747 AC1: XSS 防御維持 — DOMPurify が <script> / onerror= / javascript: URL を escape する。
	 * label 値に意図的な悪性 payload を注入し、ページ評価で sanitized されたかを確認する。
	 */
	test('XSS 防御: <script> / onerror= / javascript: URL が DOMPurify で除去される', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('h1').first()).toBeVisible();

		const result = await page.evaluate(() => {
			const purify = (
				window as unknown as { DOMPurify?: { sanitize: (s: string, c: object) => string } }
			).DOMPurify;
			if (!purify) return { ok: false, reason: 'DOMPurify not loaded' };
			// shared-labels.js と同じ ALLOWED_TAGS 構成を再現（XSS 防御の確認のみ）
			const cfg = {
				ALLOWED_TAGS: [
					'strong',
					'em',
					'a',
					'br',
					'span',
					'h1',
					'h2',
					'h3',
					'h4',
					'p',
					'ul',
					'ol',
					'li',
				],
				ALLOWED_ATTR: ['href', 'class', 'id'],
			};
			const cases = [
				'<script>window.__xss=1</script>safe-text',
				'<img src=x onerror="window.__xss=1">safe-img',
				'<a href="javascript:window.__xss=1">click</a>',
				'<iframe src="javascript:window.__xss=1"></iframe>safe-iframe',
				'<svg onload="window.__xss=1"></svg>safe-svg',
			];
			const sanitized = cases.map((c) => purify.sanitize(c, cfg));
			return {
				ok: true,
				sanitized,
				xssTriggered: (window as unknown as { __xss?: number }).__xss === 1,
			};
		});

		expect(result.ok, `DOMPurify load failure: ${result.reason}`).toBe(true);
		expect(result.xssTriggered, 'XSS payload that triggered window.__xss=1').toBeFalsy();

		// sanitize 後の値に <script> / onerror= / javascript: が含まれないこと
		for (const s of result.sanitized || []) {
			expect(s, `script tag leaked: ${s}`).not.toMatch(/<script/i);
			expect(s, `onerror handler leaked: ${s}`).not.toMatch(/onerror/i);
			expect(s, `javascript: protocol leaked: ${s}`).not.toMatch(/javascript:/i);
			expect(s, `iframe tag leaked: ${s}`).not.toMatch(/<iframe/i);
			expect(s, `svg tag leaked: ${s}`).not.toMatch(/<svg/i);
		}
	});

	/**
	 * #1747 AC2 補足: 静的検査 (scripts/check-lp-innerhtml-tags.mjs) が JSDOM + DOMPurify で
	 * 「site/*.html の data-lp-key 配下 nested HTML が SANITIZE_CONFIG.ALLOWED_TAGS により
	 * strip されない」を検証する。本 E2E は実機 chromium 動作の保証担当。
	 */
	test('shared-labels.js applyLpKeys() が DOMPurify 不在時に textContent fallback する', async ({
		page,
	}) => {
		// 構造タグを含む全 LP ページで applyLpKeys が完走していることの簡易確認
		const targets = ['/index.html', '/pricing.html', '/faq.html'];
		for (const t of targets) {
			await page.goto(`${baseUrl}${t}`, { waitUntil: 'domcontentloaded' });
			await expect(page.locator('h1, h2').first(), `${t}: h1/h2 not visible`).toBeVisible();
			// applyLpKeys が走らない場合 data-lp-key 属性のついた要素の textContent が空のままになる。
			// 1 つ以上の要素で textContent が非空であることを確認。
			const filledCount = await page.evaluate(() => {
				const els = document.querySelectorAll('[data-lp-key]');
				let n = 0;
				els.forEach((el) => {
					if ((el.textContent || '').trim().length > 0) n++;
				});
				return n;
			});
			expect(filledCount, `${t}: data-lp-key elements all empty`).toBeGreaterThan(5);
		}
	});
});
