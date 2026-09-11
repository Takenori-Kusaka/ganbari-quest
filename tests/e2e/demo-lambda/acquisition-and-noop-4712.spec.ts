// tests/e2e/demo-lambda/acquisition-and-noop-4712.spec.ts
//
// #4712: デモ (AUTH_MODE=anonymous + DATA_SOURCE=demo) の「獲得導線」と「no-op 再表示」の回帰。
//
// 検証する顧客体験:
//   1. デモを気に入った見込み客が申し込める — 申込 / ログイン CTA は本番 host の絶対 URL に着地し、
//      demo host に「送信しても何も起きない」フォームを出さない
//   2. 再訪しても侵襲的モーダル・完了できないバナーが出ない (ADR-0012「記録する → 数秒で閉じる」)
//   3. 旧 URL `/demo/switch` が `//switch` (プロトコル相対 = 外部ホスト) に飛ばない

import { expect, test } from '@playwright/test';
import { DEMO_LABELS } from '../../../src/lib/domain/labels';

test.describe('#4712 デモの獲得導線', () => {
	test('/auth/signup は本番 host の申込画面へ 302 (デモ host にフォームを出さない)', async ({
		request,
	}) => {
		const res = await request.get('/auth/signup', { maxRedirects: 0 });
		expect(res.status()).toBe(302);
		expect(res.headers().location).toBe(DEMO_LABELS.signupHref);
	});

	test('/auth/login も本番 host のログイン画面へ 302', async ({ request }) => {
		const res = await request.get('/auth/login', { maxRedirects: 0 });
		expect(res.status()).toBe(302);
		expect(res.headers().location).toBe(DEMO_LABELS.loginHref);
	});

	test('marketplace / admin の申込 CTA を辿ると本番 host に着地する (相対 CTA も救済される)', async ({
		page,
	}) => {
		await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		const cta = page.locator('a[href="/auth/login"], a[href="/auth/signup"]').first();
		if ((await cta.count()) > 0) {
			const href = await cta.getAttribute('href');
			const res = await page.request.get(href ?? '/auth/login', { maxRedirects: 0 });
			// 相対 CTA でも server 側 302 で本番 host に出る
			expect(res.status()).toBe(302);
			expect(res.headers().location).toMatch(/^https:\/\/www\.ganbari-quest\.com\/auth\//);
		}
		// admin ホーム下部のデモ CTA は絶対 URL を直接指す
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		const demoCta = page.locator(`a[href="${DEMO_LABELS.signupHref}"]`);
		await expect(demoCta.first()).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('#4712 デモの再訪時の no-op 表示', () => {
	test('/admin を 2 回開いても「プレミアムへようこそ」モーダルが出ない', async ({ page }) => {
		for (const _pass of [1, 2]) {
			await page.goto('/admin', { waitUntil: 'domcontentloaded' });
			await expect(page.getByText('プレミアムへようこそ')).toHaveCount(0);
		}
	});

	test('/switch にセットアップ再開バナー (自己ループ) が出ない', async ({ page }) => {
		await page.goto('/switch', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('setup-resume-banner')).toHaveCount(0);
	});

	test('子供画面を 2 回開いてもおうえんモーダルが出ない', async ({ page }) => {
		for (const _pass of [1, 2]) {
			await page.goto('/preschool/home', { waitUntil: 'domcontentloaded' });
			await expect(page.getByTestId('cheer-overlay')).toHaveCount(0);
		}
	});
});

test.describe('#4712 デモの月次レポート', () => {
	test('レポート画面に活動回数 0 以外が出る (fixture の活動ログが集計される)', async ({ page }) => {
		await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
		const body = (await page.locator('body').textContent()) ?? '';
		// 「活動 0 回」だけが並ぶ状態 (旧 stub) では 1 件も数字が出ない。
		// fixture には直近 0〜10 日の活動ログがあるため、少なくとも 1 つは 1 以上の回数が出る。
		expect(body).not.toMatch(/^\s*$/);
		const hasNonZeroCount = /(\d+)\s*回/.test(body)
			? [...body.matchAll(/(\d+)\s*回/g)].some((m) => Number(m[1]) > 0)
			: false;
		expect(hasNonZeroCount, 'レポートに 1 回以上の活動が集計されて表示される').toBe(true);
	});
});

test.describe('#4712 旧 URL の正規化', () => {
	test('/demo/switch は //switch ではなく /switch に 308 する', async ({ request }) => {
		const res = await request.get('/demo/switch', { maxRedirects: 0 });
		expect(res.status()).toBe(308);
		expect(res.headers().location).toBe('/switch');
	});

	test('/demo/ も // ではなく / に 308 する', async ({ request }) => {
		const res = await request.get('/demo/', { maxRedirects: 0 });
		expect(res.status()).toBe(308);
		expect(res.headers().location).toBe('/');
	});
});
