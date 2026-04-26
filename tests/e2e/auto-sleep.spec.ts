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
		// page.clock で Date.now() を制御
		await page.clock.install();

		await selectKinderChild(page);

		// preschool/home にいることを確認
		await expect(page).toHaveURL(/\/preschool\/home/);

		// アクティブ状態を模擬（pointerdown イベントを送信し続ける）
		// setInterval(1000ms) が ACTIVE_MS 累積するには 15分*60 = 900 回分の tick が必要
		// 実際には各 tick で "now - lastActive < INACTIVE_RESET_MS" を満たす必要がある
		// lastActive を常に "直前" にするため、clock の advance 前に pointerdown を送る

		// 最初のアクティビティ（lastActive を設定）
		await page.dispatchEvent('body', 'pointerdown');

		// 14分59秒分は何も起きない（1秒刻みで時間を進める）
		// タイマーが起動するまで少し待つ（onMount が実行されるタイミング）
		await page.waitForFunction(() => typeof window !== 'undefined');

		// 15分+1tick 経過させる
		// 各 setInterval(1000ms) の tick ごとに pointerdown をまとめて advance する
		// page.clock.fastForward は tick イベントを正しく発火する
		for (
			let elapsed = 0;
			elapsed < ACTIVE_MS + TICK_INTERVAL_MS;
			elapsed += INACTIVE_RESET_MS / 2
		) {
			// 30秒ごとに pointerdown で lastActive を更新（非アクティブリセットを防ぐ）
			await page.dispatchEvent('body', 'pointerdown');
			await page.clock.fastForward(INACTIVE_RESET_MS / 2);
		}

		// /switch に遷移することを確認（タイムアウトは余裕を持って設定）
		await expect(page).toHaveURL('/switch', { timeout: 5000 });
	});

	test('非アクティブ1分でタイマーがリセットされる（リダイレクトが遅延する）', async ({ page }) => {
		await page.clock.install();

		await selectKinderChild(page);
		await expect(page).toHaveURL(/\/preschool\/home/);

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
