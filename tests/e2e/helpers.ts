// tests/e2e/helpers.ts
// E2E テスト共通ヘルパー — data-testid ベースの堅牢なセレクタ

import { expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// 子供選択
// ============================================================

/** 最初の子供を選択してホーム画面に遷移 */
export async function selectChild(page: Page) {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').first();
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby|lower|upper|teen)\/home/);
}

/** 指定の子供を名前で選択してホーム画面に遷移 */
export async function selectChildByName(page: Page, name: string) {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').filter({ hasText: name });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby|lower|upper|teen)\/home/);
}

/** ゆうきちゃん(kinder)を選択 */
export async function selectKinderChild(page: Page) {
	await selectChildByName(page, 'ゆうきちゃん');
}

/** てすとくん(baby)を選択 */
export async function selectBabyChild(page: Page) {
	await selectChildByName(page, 'てすとくん');
}

// ============================================================
// オーバーレイ dismiss
// ============================================================

/** ログインボーナスのおみくじ・誕生日レビュー・各種オーバーレイを閉じる */
export async function dismissOverlays(page: Page) {
	// おみくじオーバーレイを閉じる
	const hasOmikuji = await page
		.getByText('きょうのうんせい')
		.isVisible()
		.catch(() => false);
	if (hasOmikuji) {
		try {
			const omikujiBtn = page.getByRole('button', { name: /タップしてすすむ/ });
			await omikujiBtn.waitFor({ timeout: 4000 });
			await omikujiBtn.click();
			await page.waitForTimeout(500);
		} catch {
			// ボタンが出なかった場合
		}
	}
	// 誕生日レビューオーバーレイを閉じる
	try {
		const birthdayBtn = page.getByRole('button', { name: /はじめる/ });
		if (await birthdayBtn.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
		}
	} catch {
		// なければスキップ
	}
	// 特別報酬や汎用オーバーレイを閉じる
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(400);
		try {
			const closeBtn = page.getByRole('button', { name: /とじる|閉じる|OK|やったー/ });
			if (await closeBtn.isVisible().catch(() => false)) {
				await closeBtn.click();
				await page.waitForTimeout(300);
			} else {
				break;
			}
		} catch {
			break;
		}
	}
	await page.waitForTimeout(300);
}

/** 子供を選択してオーバーレイを閉じた状態にする */
export async function selectChildAndDismiss(page: Page) {
	await selectChild(page);
	await dismissOverlays(page);
}

// ============================================================
// 活動カード — data-testid ベースのセレクタ
// ============================================================

/** 未記録の活動カードを取得（data-testid="activity-card-*" かつ disabled でないボタン） */
export function getAvailableActivities(page: Page) {
	return page.locator('button[data-testid^="activity-card-"]:not([disabled])');
}

/** 全ての活動カード（完了済み含む） */
export function getAllActivityCards(page: Page) {
	return page.locator('[data-testid^="activity-card-"]');
}

// ============================================================
// 活動記録フロー
// ============================================================

/** 未記録の活動を記録する（並列テストの競合対策で複数リトライ） */
export async function recordAnyActivity(page: Page): Promise<boolean> {
	const activities = getAvailableActivities(page);
	const count = await activities.count();

	for (let i = 0; i < Math.min(count, 10); i++) {
		await activities.nth(i).click();

		// 確認ダイアログが出るのを待つ
		try {
			const dialog = page.locator('[data-testid="confirm-dialog"]');
			await dialog.waitFor({ timeout: 2000 });
		} catch {
			continue;
		}

		await page.locator('[data-testid="confirm-record-btn"]').click();

		// 記録成功の結果オーバーレイを待つ
		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 2000 });
			return true;
		} catch {
			// ALREADY_RECORDED — 次の活動へ
			await page
				.locator('[data-testid="confirm-dialog"]')
				.waitFor({ state: 'hidden', timeout: 1000 })
				.catch(() => {});
		}
	}
	return false;
}
