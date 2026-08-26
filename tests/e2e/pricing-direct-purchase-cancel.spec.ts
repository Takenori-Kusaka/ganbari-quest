// tests/e2e/pricing-direct-purchase-cancel.spec.ts
// #2098 AC5 / #4501: pricing.html の購入導線 + 解約 CTA 動作確認
//
// #4501: 「今すぐ購入」CTA (`?direct=true&billing=monthly`) は **消費箇所ゼロの死に配線**
//        だったため撤去した。本 spec は「復活していないこと」と「購入導線がトライアル
//        1 本に統一され、1 回限りが開示されていること」を見る
// AC5: pricing.html 既存ユーザー向け解約導線 (#2103 F-2) が `/admin/subscription` (Stripe Customer
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
//   - `billing-portal.spec.ts`: /admin/subscription 内 Stripe Portal 起動を扱う既存 spec
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

test.describe('#4501: 直接購入 CTA は撤去され、購入導線はトライアルに統一されている', () => {
	// 旧 spec (#2098 AC4) は `?direct=true&billing=monthly` を持つ「今すぐ購入」CTA の存在を
	// 固定していた。**この 2 つのパラメータは src 全体で消費箇所ゼロ**で、CTA を押した顧客は
	// 通常のトライアル動線に落ち、ボタン文言まで「7日間 無料体験をはじめる」に変わっていた
	// (#4501 GAMMA-SC-03)。つまり旧 assert は「死んだ配線」を守っていた。
	// PO 決裁 2「今すぐ購入 CTA は当面トライアル動線に統一する」に従い、CTA と虚偽の注記
	// (「決済情報の入力が必要です」) を撤去し、**復活したら落ちる**形に置き換える
	// (assertion の弱体化ではなく、誤りを守っていた期待値の反転 — ADR-0006)。

	test('直接購入 CTA と死にパラメータが存在しない', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		await expect(page.locator('[data-direct-purchase]')).toHaveCount(0);
		await expect(page.locator('.cta-direct-note')).toHaveCount(0);

		const html = await page.content();
		expect(html, 'direct=true は消費箇所が無いパラメータ').not.toContain('direct=true');
		expect(html, 'billing= も同様に未消費 (年額は #2719 で廃止済)').not.toContain('billing=');
	});

	test('プランごとの CTA はトライアル 1 本で、?plan= だけを渡す', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		const ctas = page.locator('a.plan-cta[href*="/auth/signup"]');
		const count = await ctas.count();
		expect(count).toBeGreaterThanOrEqual(2); // Standard + Premium

		for (let i = 0; i < count; i++) {
			const href = (await ctas.nth(i).getAttribute('href')) ?? '';
			expect(href).toMatch(/\/auth\/signup\?plan=(standard|family|premium)$/);
		}
	});

	test('トライアルが 1 回限りであることが CTA の直下に開示されている (#4501 PO 決裁 3)', async ({
		page,
	}) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		const notes = page.locator('.cta-trial-note');
		expect(await notes.count()).toBeGreaterThanOrEqual(2);
		expect(await notes.first().textContent()).toMatch(/1 ?回かぎり|1 ?回限り/);
	});

	test('月額/年額トグルは撤去されたまま (#3212)', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		await expect(page.locator('input[name="billing-cycle"]')).toHaveCount(0);
	});
});

test.describe('#2098 AC5: pricing.html 解約 CTA (#2103 F-2 γ ハイブリッド)', () => {
	test('AC5-1: 既存ユーザー向け解約導線リンクが `/admin/subscription` を指す', async ({ page }) => {
		await page.goto(`${baseUrl}/pricing.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// .existing-cancel-link 内に admin/subscription へのリンク
		const cancelLink = page
			.locator('.existing-cancel-link a[href*="/admin/subscription"]')
			.or(page.locator('a[href*="ganbari-quest.com/admin/subscription"]'));
		const count = await cancelLink.count();
		expect(count).toBeGreaterThanOrEqual(1);

		const firstLink = cancelLink.first();
		await expect(firstLink).toBeVisible({ timeout: 10_000 });

		const href = (await firstLink.getAttribute('href')) ?? '';
		expect(href).toContain('/admin/subscription');
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
