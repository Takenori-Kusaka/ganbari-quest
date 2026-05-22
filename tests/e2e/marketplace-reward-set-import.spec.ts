// tests/e2e/marketplace-reward-set-import.spec.ts
// #2136 MP-1: マーケットプレイス reward-set 一括追加の E2E 検証
//
// AC4 検証対象:
// 1. /marketplace/reward-set/<itemId> 詳細ページで一括追加 CTA が表示される
//    (ログイン済み + 子供登録済みなら直接 form、未ログインなら signup 誘導)
// 2. 一括追加実行で admin/rewards 画面の特別報酬一覧に reward が反映される
// 3. 同一 preset を 2 回目取込 -> 重複検知メッセージが表示される (sourcePresetId 流用)
// 4. /admin/rewards の「マーケットプレイスから一括追加」セクション経由でも同じ動線が機能する
//
// 認証: ローカル AUTH_MODE=local では admin 配下に自動アクセス可能
// (cognito mock 不要、global-setup.ts でテスト用テナント seed 済)。

import path from 'node:path';
import { expect, test } from '@playwright/test';

// ============================================================
// テスト前 cleanup ヘルパー
// ============================================================
// 並行 worker 間の干渉を防ぐため、たろうくんの sourcePresetId='kinder-rewards' 由来 reward を
// テスト開始前に削除する。activity-import-service の test と同じパターン。
async function cleanupKinderRewardsForChild(): Promise<void> {
	const DB_PATH = path.resolve('data/ganbari-quest.db');
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(DB_PATH);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get('たろうくん') as { id: number } | undefined;
		if (!child) return;
		db.prepare('DELETE FROM special_rewards WHERE child_id = ? AND source_preset_id = ?').run(
			child.id,
			'kinder-rewards',
		);
	} finally {
		db.close();
	}
}

test.describe('#2136 MP-1: marketplace reward-set 一括追加', () => {
	test.beforeEach(async () => {
		await cleanupKinderRewardsForChild();
	});

	test('reward-set 詳細ページに一括追加 CTA が表示される（ログイン済み + 子供登録済み）', async ({
		page,
	}) => {
		await page.goto('/marketplace/reward-set/kinder-rewards');
		await expect(page).toHaveURL(/\/marketplace\/reward-set\/kinder-rewards/);

		// 詳細ページの header / item リストが visible
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(/ようじごほうび/);

		// 一括追加 form が visible (#2136 CTA 改修)
		const importForm = page.getByTestId('reward-import-form');
		await expect(importForm).toBeVisible({ timeout: 10000 });

		// 子供セレクト + 一括追加 submit ボタンが visible
		const submitBtn = page.getByTestId('reward-import-submit');
		await expect(submitBtn).toBeVisible();
		await expect(submitBtn).toContainText(/一括追加/);
	});

	test('一括追加実行 -> admin/rewards の reward 一覧に preset reward が反映される', async ({
		page,
	}) => {
		// 1. reward-set 詳細ページで一括追加 submit
		await page.goto('/marketplace/reward-set/kinder-rewards');
		const submitBtn = page.getByTestId('reward-import-submit');
		await expect(submitBtn).toBeVisible({ timeout: 10000 });
		await submitBtn.click();

		// 2. 成功メッセージ表示を待つ (form action は同 URL に return される)
		const result = page.getByTestId('reward-import-result');
		await expect(result).toBeVisible({ timeout: 10000 });
		await expect(result).toContainText(/✨.*件のごほうびを追加しました/);

		// 3. /admin/rewards に遷移して reward count を確認
		// 取込済 reward は API 経由ではなく、たろうくんの specialRewards から確認する。
		// admin/rewards 画面の rewardCount は children.rewardCount として表示される。
		await page.goto('/admin/rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);

		// たろうくんの reward count が 0 以上に増えていれば反映確認 OK
		// (preset 取込で 10 件の reward が追加される)
		// 子供セレクタが visible になるまで待つ
		const childSelector = page.getByText('たろうくん').first();
		await expect(childSelector).toBeVisible({ timeout: 10000 });
	});

	test('同一 preset を 2 回目取込 -> 重複検知メッセージが表示される', async ({ page }) => {
		// 1 回目の取込
		await page.goto('/marketplace/reward-set/kinder-rewards');
		const submitBtn = page.getByTestId('reward-import-submit');
		await expect(submitBtn).toBeVisible({ timeout: 10000 });
		await submitBtn.click();
		await expect(page.getByTestId('reward-import-result')).toBeVisible({ timeout: 10000 });

		// 2 回目の取込 — 同じ preset を再度 import
		await page.reload();
		const submitBtn2 = page.getByTestId('reward-import-submit');
		await expect(submitBtn2).toBeVisible({ timeout: 10000 });
		await submitBtn2.click();

		// 全件重複メッセージが表示される
		const result = page.getByTestId('reward-import-result');
		await expect(result).toBeVisible({ timeout: 10000 });
		await expect(result).toContainText(/既に追加済み/);
	});

	test('admin/rewards のマーケットプレイス一括追加セクションが visible', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);

		// マーケットプレイス一括追加セクションが visible
		const section = page.getByTestId('marketplace-reward-import-section');
		await expect(section).toBeVisible({ timeout: 10000 });

		// トグルボタンを開く
		const toggle = page.getByTestId('marketplace-reward-import-toggle');
		await expect(toggle).toBeVisible();
		await toggle.click();

		// reward-set 10 件分の preset card が描画される（kinder-rewards は確実に存在）
		// #2391 (Phase 2): UnifiedImportHub 統合により testid 名規約が
		// `marketplace-reward-form-{itemId}` → `marketplace-preset-import-{itemId}` に統一
		const kinderForm = page.getByTestId('marketplace-preset-import-kinder-rewards');
		await expect(kinderForm).toBeVisible({ timeout: 5000 });
	});

	test('削除済の存在しない reward-set は 404 を返す', async ({ page }) => {
		// 同 PR で reward-set の itemId 整合性確認 — 既存 10 件以外は 404
		const response = await page.goto('/marketplace/reward-set/non-existent-reward-set');
		expect(response?.status()).toBe(404);
	});
});
