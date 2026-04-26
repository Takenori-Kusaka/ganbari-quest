// tests/e2e/auto-sleep.spec.ts
// #1292 子供画面の自動スリープ（15分アクティブで /switch にリダイレクト）E2E テスト

import { expect, test } from '@playwright/test';
import { selectKinderChild } from './helpers';

// 自動スリープ設定（src/routes/(child)/+layout.svelte と同期）
const ACTIVE_MS = 15 * 60 * 1000;
const INACTIVE_RESET_MS = 60 * 1000;
const TICK_INTERVAL_MS = 1000;

test.describe('#1292 自動スリープ', () => {
	test('15分連続アクティブで /switch にリダイレクトされる', async ({ page }) => {
		// page.clock で Date.now() と setInterval を制御
		// （selectKinderChild の前にインストールし、onMount の setInterval も偽クロック管理下に置く）
		await page.clock.install();

		await selectKinderChild(page);

		// preschool/home にいることを確認
		await expect(page).toHaveURL(/\/preschool\/home/);

		// headless Chromium では document.hidden が常に true になり sleepTimer がスキップされる。
		// page.evaluate() でページ遷移完了後に document インスタンスの hidden プロパティを
		// 直接オーバーライドする（bringToFront() は headless モードでは document.hidden を変更しない）。
		// addInitScript() は full navigation 時のみ有効で SPA 遷移後には適用されないため不適。
		await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', {
				configurable: true,
				get: () => false,
			});
		});

		// 最初のアクティビティ（lastActive を設定）
		await page.dispatchEvent('body', 'pointerdown');

		// 15分+1tick 経過させる
		// 30秒ごとに pointerdown → fastForward を繰り返す
		for (
			let elapsed = 0;
			elapsed < ACTIVE_MS + TICK_INTERVAL_MS;
			elapsed += INACTIVE_RESET_MS / 2
		) {
			// 30秒ごとに pointerdown で lastActive を更新（非アクティブリセットを防ぐ）
			await page.dispatchEvent('body', 'pointerdown');
			await page.clock.fastForward(INACTIVE_RESET_MS / 2);
		}

		// SvelteKit の goto('/switch') は内部で setTimeout/Promise を使ってナビゲーションを
		// キューに積む。偽クロック下では fastForward で保留 tick を発火させてから
		// resume() でリアルタイムに戻し、SvelteKit ルーターの非同期処理を完了させる。
		await page.clock.fastForward(1000);
		await page.clock.resume();

		// /switch に遷移することを確認（resume 後はリアルタイムで待機）
		await expect(page).toHaveURL('/switch', { timeout: 10000 });
	});

	test('非アクティブ1分でタイマーがリセットされる（リダイレクトが遅延する）', async ({ page }) => {
		await page.clock.install();

		await selectKinderChild(page);
		await expect(page).toHaveURL(/\/preschool\/home/);
		await page.bringToFront();

		// アクティビティを送信
		await page.dispatchEvent('body', 'pointerdown');

		// 14分経過（リダイレクトされないはず）
		for (let elapsed = 0; elapsed < 14 * 60 * 1000; elapsed += 30000) {
			await page.dispatchEvent('body', 'pointerdown');
			await page.clock.fastForward(30000);
		}

		// 1分間非アクティブ → タイマーリセット
		await page.clock.fastForward(INACTIVE_RESET_MS + 1000);

		// まだ /preschool/home にいること（リセットされたのでリダイレクトされない）
		await expect(page).toHaveURL(/\/preschool\/home/);
	});

	test('baby モードは自動スリープしない', async ({ page }) => {
		await page.clock.install();

		// baby 子供を選択
		await page.goto('/switch');
		const babyButton = page
			.locator('[data-testid^="child-select-"]')
			.filter({ hasText: 'はなこちゃん' });
		await expect(babyButton).toBeVisible();
		await babyButton.click();
		await page.waitForURL(/\/baby\/home/);
		await page.bringToFront();

		// アクティビティを送信
		await page.dispatchEvent('body', 'pointerdown');

		// 20分経過させる
		for (let elapsed = 0; elapsed < 20 * 60 * 1000; elapsed += 30000) {
			await page.dispatchEvent('body', 'pointerdown');
			await page.clock.fastForward(30000);
		}

		// baby は自動スリープしないのでまだ /baby/ 配下にいること
		await expect(page).toHaveURL(/\/baby\//);
	});
});
