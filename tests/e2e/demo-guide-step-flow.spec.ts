// tests/e2e/demo-guide-step-flow.spec.ts
// #702, #817 — デモガイドの「つぎへ」で全 7 ステップを順番に踏めることを保証する E2E
//
// 過去 2 度にわたり「ステップが 1→3→5 に飛ぶ」回帰が発生している（#317, #702）。
// 原因は DemoGuideBar の <a href={nextStep.href}> + onclick={handleAdvance} の組合せで、
// Svelte 5 reactive update により handleAdvance 直後に href が「次の次のステップ」に
// 書き換わり、ブラウザがそちらへナビゲートしてしまうこと。
//
// 修正版 (#702) では <button> + 明示 goto() に切り替えたため、1 クリック = 1 ステップ
// 進行が保証される。本 spec は全 6 ステップを順番に確認することで再回帰を防ぐ。

import { expect, type Page, test } from '@playwright/test';

/**
 * Svelte 5 onclick ハンドラは hydration 完了後にのみ DOM にバインドされる。
 * dev mode では Vite の lazy compile でハイドレーションが数十秒遅延することがあり、
 * 単に visible になっただけで click すると no-op になる。
 * `+layout.svelte` の $effect で `window.__APP_HYDRATED__ = true` が立つのを待つ。
 */
async function waitForHydration(page: Page): Promise<void> {
	await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
		timeout: 30_000,
	});
}

// dev mode の最初の /demo コンパイルは数十秒かかるため、ファイル単位で timeout を延長
test.describe.configure({ timeout: 120_000 });

test.describe('#702 デモガイド: 全ステップ順次遷移', () => {
	test('「つぎへ」ボタンで Step 1 → 2 → 3 → 4 → 5 → 6 → 7 を順番に踏める', async ({ page }) => {
		// Step 1: /demo トップから「ガイド付きデモを はじめる」をクリック
		await page.goto('/demo');
		// Hydrationが終わるまで待つ。dev mode では最初の /demo コンパイルが
		// 数十秒かかることがあり、Svelte 5 の onclick ハンドラは hydration 後に
		// バインドされるため、可視になっただけで click すると no-op になる。
		// `toBeVisible` でボタンが visible であることだけ確認したら、
		// hydration 完了マーカー（window.__APP_HYDRATED__）を待つ。
		await expect(page.getByTestId('demo-guide-start-link')).toBeVisible();
		await waitForHydration(page);
		await page.getByTestId('demo-guide-start-link').click();

		// Step 1: こどもの画面をみよう
		// `.fixed.bottom-0` は BottomNav と DemoGuideBar の両方にマッチするので、
		// 必ず data-testid="demo-guide-bar" でスコープすること（strict mode 違反回避）。
		await expect(page).toHaveURL(/\/demo\/preschool\/home/);
		const guideBar = page.getByTestId('demo-guide-bar');
		const stepIndicator = guideBar
			.locator('div.rounded-full.bg-\\[var\\(--color-brand-500\\)\\]')
			.first();
		await expect(stepIndicator).toHaveText('1');
		await expect(guideBar).toContainText('こどもの画面をみよう');

		// Step 1 → Step 2 (同一 matchPath: /demo/preschool/home)
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('2');
		await expect(guideBar).toContainText('かつどうを きろくしよう');
		// Step 2 でも /demo/preschool/home のままであることを確認
		await expect(page).toHaveURL(/\/demo\/preschool\/home/);

		// Step 2 → Step 3 (matchPath: /demo/preschool/status)
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('3');
		await expect(guideBar).toContainText('ステータスを みよう');
		await expect(page).toHaveURL(/\/demo\/preschool\/status/);

		// Step 3 → Step 4 (matchPath: /demo/preschool/battle)
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('4');
		await expect(guideBar).toContainText('バトルに ちょうせんしよう');
		await expect(page).toHaveURL(/\/demo\/preschool\/battle/);

		// Step 4 → Step 5 (matchPath: /demo/admin)
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('5');
		await expect(guideBar).toContainText('おやの画面をみよう');
		await expect(page).toHaveURL(/\/demo\/admin/);

		// Step 5 → Step 6 (matchPath: /demo/admin/license) — #817 ライセンスキー体験
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('6');
		await expect(guideBar).toContainText('プラン・お支払いを みよう');
		await expect(page).toHaveURL(/\/demo\/admin\/license/);

		// Step 6 → Step 7 (matchPath: /demo/signup) — 最終ステップ
		await page.getByTestId('demo-guide-next').click();
		await expect(stepIndicator).toHaveText('7');
		await expect(guideBar).toContainText('いかがでしたか？');
		await expect(page).toHaveURL(/\/demo\/signup/);

		// Step 7 (最終): 「プランを見る」「はじめる」CTA が表示される
		await expect(page.getByTestId('demo-guide-see-pricing')).toBeVisible();
		await expect(page.getByTestId('demo-guide-start')).toBeVisible();
		// 「つぎへ」ボタンは表示されない
		await expect(page.getByTestId('demo-guide-next')).toBeHidden();
	});

	test('「もどる」ボタンで Step 3 → 2 → 1 を順番に戻れる', async ({ page }) => {
		// Step 3 まで進む
		await page.goto('/demo');
		await expect(page.getByTestId('demo-guide-start-link')).toBeVisible();
		await waitForHydration(page);
		await page.getByTestId('demo-guide-start-link').click();
		await page.getByTestId('demo-guide-next').click(); // → Step 2
		await page.getByTestId('demo-guide-next').click(); // → Step 3

		const guideBar = page.getByTestId('demo-guide-bar');
		const stepIndicator = guideBar
			.locator('div.rounded-full.bg-\\[var\\(--color-brand-500\\)\\]')
			.first();
		await expect(stepIndicator).toHaveText('3');

		// Step 3 → 2
		await page.getByTestId('demo-guide-back').click();
		await expect(stepIndicator).toHaveText('2');
		await expect(page).toHaveURL(/\/demo\/preschool\/home/);

		// Step 2 → 1 (同一 matchPath)
		await page.getByTestId('demo-guide-back').click();
		await expect(stepIndicator).toHaveText('1');
		await expect(page).toHaveURL(/\/demo\/preschool\/home/);
	});
});
