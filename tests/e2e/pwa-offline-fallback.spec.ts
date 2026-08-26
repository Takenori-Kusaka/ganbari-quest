// worker DB 分離 fixture 経由で import する (#4489。素の `@playwright/test` は config 既定の
// baseURL = worker 0 の DB に固定され、どの worker で走っても他 spec の一時 seed を観測する)。
import { expect, test } from './fixtures';

// #4644: オフライン時のページ遷移が `/offline` (ひらがなの説明ページ) に着地することを実機で検証する。
//
// **production build (preview) が前提**。SvelteKit の `$service-worker` は dev では
// `build` / `prerendered` が空配列になり (`node_modules/@sveltejs/kit/src/exports/vite/index.js`)、
// precache が成立しないため、`npm run dev` 起動ではこの spec は成立しない。
// CI の e2e job は `npm run build` → `npm run preview` で起動するため実行される
// (`.github/workflows/ci.yml` §「Build for E2E (preview mode)」/ `playwright.config.ts` webServer)。
// ローカルで回すときは `CI=1 npx playwright test tests/e2e/pwa-offline-fallback.spec.ts` を使う。

test.describe('オフライン着地 (#4644)', () => {
	test('/offline は年齢帯を問わず読めるひらがなの案内を出す', async ({ page }) => {
		await page.goto('/offline');

		await expect(page.getByTestId('offline-page')).toBeVisible();
		// 「でんぱが とどいていない」= 原因、「たしかめてね」= 子供が自分で試せる対処。
		await expect(page.getByRole('heading', { level: 1 })).toContainText('つながっていない');
		await expect(page.getByTestId('offline-page')).toContainText('でんぱ');
		await expect(page.getByTestId('offline-retry')).toBeVisible();
	});

	test('オフラインでページ遷移すると /offline に着地する', async ({ page, context }) => {
		await page.goto('/preschool/home');

		// Service Worker の install (precache) → activate 完了を待つ。
		// `ready` は activate 後に解決するため、install の `waitUntil(cache.addAll(...))` は完了済み。
		await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
			timeout: 15_000,
		});
		// フォールバック先が実際に precache されていることを確認する
		// (ここが空だと以降の assert が「503 でも通る」ゆるい検査に化ける)。
		await expect
			.poll(async () => page.evaluate(async () => Boolean(await caches.match('/offline'))), {
				timeout: 15_000,
			})
			.toBe(true);

		// 一度オンラインで開いておく (旧実装が stale として返そうとしていた経路)。
		await page.goto('/preschool/status');

		await context.setOffline(true);
		try {
			await page.goto('/preschool/status');

			await expect(page.getByTestId('offline-page')).toBeVisible();
			await expect(page.getByTestId('offline-page')).toContainText('でんぱ');
			// 503 の素の text/plain フォールバックに落ちていないこと (= 説明ページに着地している)。
			await expect(page.getByTestId('offline-retry')).toBeVisible();
		} finally {
			await context.setOffline(false);
		}
	});
});
