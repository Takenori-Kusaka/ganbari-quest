// tests/e2e/pricing-direct-purchase-cancel.spec.ts
// #2098 AC4 / AC5: pricing.html 直接購入 CTA + 解約 CTA 動作確認
//
// AC4: pricing.html での Standard / Family 直接購入 CTA (Tower 型二段 CTA 下段、#2102 F-1)
//      が正しい URL (`?direct=true&billing=monthly|yearly`) を持ち、月額/年額トグルで切替される
// AC5: pricing.html 既存ユーザー向け解約導線 (#2103 F-2) が `/admin/billing` (Stripe Customer
//      Portal 経由) を正しく指している
//
// 設計判断 (Pre-PMF + 静的 LP 配信):
//   `[data-direct-purchase]` / `.cta-direct-note` / `.existing-cancel-link` /
//   `.hero-cancel-disclaimer` / `.hero-price-band` は LP `site/pricing.html` 専用 selector。
//   SvelteKit app route `/pricing` (`src/routes/pricing/+page.svelte`) には存在しない。
//   本 spec は `lp-faq-page.spec.ts` と同じく `createServer` で `site/` を静的配信し、
//   独自 baseUrl から `/pricing.html` を直接叩く方式に統一する (#2247 QM BLOCK 修正)。
//
//   完全 E2E (Stripe Checkout 遷移 → mock webhook → license 発行 → tenant.plan 更新) は
//   実 Stripe API 連携が必要で test 環境再現困難 (ADR-0010 Bucket B、Pre-PMF オーバーヘッド)。
//   本 spec は LP 上の CTA href / 構造的存在 / billing-cycle トグル動作の smoke を確実に保証し、
//   実 Stripe 動線は別途 cognito-dev `upgrade-flow.spec.ts` / `upgrade-oneclick.spec.ts` で
//   page.route() モック化された範囲を扱う。本 spec は LP 側 (認証不要なページ) の責務に絞る。
//
// 既存 spec との関係:
//   - `pricing-page-signup.spec.ts`: 7 日間無料体験 CTA (`?plan=...`) を扱う既存 spec
//   - `billing-portal.spec.ts`: /admin/billing 内 Stripe Portal 起動を扱う既存 spec
//   - 本 spec は両者の中間: pricing.html 上の「直接購入」「解約」CTA href 検証
//
// 実行: npx playwright test tests/e2e/pricing-direct-purchase-cancel.spec.ts

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

test.describe('#2098 AC4: pricing.html 直接購入 CTA (Tower 型二段 CTA 下段、#2102 F-1)', () => {
	test('AC4-1: Standard 直接購入 CTA が `?direct=true&billing=monthly` を含む', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		const standardDirect = page.locator('[data-direct-purchase="standard"]');
		await expect(standardDirect).toBeVisible({ timeout: 10_000 });

		const href = (await standardDirect.getAttribute('href')) ?? '';
		expect(href).toContain('plan=standard');
		expect(href).toContain('direct=true');
		expect(href).toContain('billing=monthly'); // 初期状態は monthly
	});

	test('AC4-2: Family 直接購入 CTA が `?direct=true&billing=monthly` を含む', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		const familyDirect = page.locator('[data-direct-purchase="family"]');
		await expect(familyDirect).toBeVisible({ timeout: 10_000 });

		const href = (await familyDirect.getAttribute('href')) ?? '';
		expect(href).toContain('plan=family');
		expect(href).toContain('direct=true');
		expect(href).toContain('billing=monthly');
	});

	test('AC4-3: 直接購入 CTA に「決済情報の入力が必要」注記が併設されている (#2102 F-3)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// .cta-direct-note (cta-trial-note とペアで存在) — 訴求軸 C 整合 (#2104 F-3)
		const notes = page.locator('.cta-direct-note');
		const noteCount = await notes.count();
		expect(noteCount).toBeGreaterThanOrEqual(2); // Standard + Family の 2 箇所

		// 注記が「決済情報の入力が必要」を含む (CC 登録不要訴求との整合確保)
		const firstNoteText = await notes.first().textContent();
		expect(firstNoteText).toMatch(/決済情報|カード|ライセンスキー/);
	});

	test('AC4-4: 月額/年額トグル (billing-cycle) は撤去され、直接購入 CTA は billing=monthly 固定 (#3212)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// #3212: 年額廃止 (#2719) に伴い billing-cycle トグルを撤去。トグル DOM が存在しないこと。
		await expect(page.locator('input[name="billing-cycle"]')).toHaveCount(0);

		// 直接購入 CTA は billing=monthly 固定 (yearly を生成しない)
		const directCtas = page.locator('a[data-direct-purchase]');
		const ctaCount = await directCtas.count();
		expect(ctaCount).toBeGreaterThanOrEqual(1);
		for (let i = 0; i < ctaCount; i++) {
			const href = (await directCtas.nth(i).getAttribute('href')) ?? '';
			expect(href).toContain('billing=monthly');
			expect(href).not.toContain('billing=yearly');
		}
	});
});

test.describe('#2098 AC5: pricing.html 解約 CTA (#2103 F-2 γ ハイブリッド)', () => {
	test('AC5-1: 既存ユーザー向け解約導線リンクが `/admin/billing` を指す', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// .existing-cancel-link 内に admin/billing へのリンク
		const cancelLink = page
			.locator('.existing-cancel-link a[href*="/admin/billing"]')
			.or(page.locator('a[href*="ganbari-quest.com/admin/billing"]'));
		const count = await cancelLink.count();
		expect(count).toBeGreaterThanOrEqual(1);

		const firstLink = cancelLink.first();
		await expect(firstLink).toBeVisible({ timeout: 10_000 });

		const href = (await firstLink.getAttribute('href')) ?? '';
		expect(href).toContain('/admin/billing');
	});

	test('AC5-2: FAQ で解約経路 (Stripe 請求管理ページ) が明示されている', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// FAQ summary 「解約したらデータはすぐに削除されますか？」が存在する
		const faqSummary = page.locator('summary', { hasText: /解約/ });
		const count = await faqSummary.count();
		expect(count).toBeGreaterThanOrEqual(1);
	});

	test('AC5-3: hero-price-band が「いつでも解約できます」訴求を含む (CANCEL_TERMS.anytimeOk)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		const heroBand = page.locator('.hero-price-band, [data-lp-key="pricing.heroPriceBand"]');
		const bandText = (await heroBand.first().textContent()) ?? '';
		// CANCEL_TERMS.anytime / anytimeOk 由来の訴求文 (terms.ts SSOT)
		expect(bandText).toMatch(/いつでも解約/);
	});

	test('AC5-4: 解約期間 disclaimer (30 日読み取り専用 / 日割り返金なし) が明示されている', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// .hero-cancel-disclaimer 内に「30 日間は読み取り専用」「日割り返金はありません」
		// が明示されている (改正消費者契約法 / FTC Click-to-Cancel Rule 整合、#2103 軸 B)
		const disclaimer = page.locator(
			'.hero-cancel-disclaimer, [data-lp-key="pricing.heroCancelDisclaimer"]',
		);
		const text = (await disclaimer.first().textContent()) ?? '';
		expect(text).toMatch(/読み取り専用|完全に削除|日割り返金/);
	});
});
