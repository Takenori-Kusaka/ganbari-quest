// tests/e2e/pricing-features.spec.ts
// #792: /pricing の features 欄が plan-features-audit.md の棚卸し結果と一致することを確認する
//
// 棚卸しで削除した項目が UI に残っていないこと、および
// 新しく追加した項目が確実に表示されていることを保証する。
// 文言の微調整は許容するため、substring マッチで検証する。

import { expect, test } from '@playwright/test';

test.describe('#792 /pricing features 棚卸し', () => {
	test.beforeEach(async ({ page }) => {
		test.slow(); // Vite dev コールドコンパイル
		await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
	});

	test('standard カードに棚卸しで確定した機能がすべて表示される', async ({ page }) => {
		// プラン名は h2 で出ている
		const standardCard = page.locator('.plan-card.recommended');
		await expect(standardCard).toBeVisible();
		await expect(standardCard).toContainText('スタンダード');

		// 棚卸しで確定した項目（#722: AI 提案は family 専用に移動）
		await expect(standardCard).toContainText('お子さまの登録人数：無制限');
		await expect(standardCard).toContainText('オリジナル活動の作成：無制限');
		await expect(standardCard).toContainText('特別なごほうび設定');
		await expect(standardCard).toContainText('1年間の履歴保持');
	});

	test('family カードに棚卸しで確定したファミリー固有機能が表示される', async ({ page }) => {
		// family は .plan-card の 3 番目（recommended でも not recommended でも family 固有のクラスはない）
		// → プラン名で特定する
		const familyCard = page.locator('.plan-card', { hasText: 'ファミリー' }).first();
		await expect(familyCard).toBeVisible();

		// family 固有の差別化項目（#722: AI 自動提案を追加）
		await expect(familyCard).toContainText('スタンダードの全機能');
		await expect(familyCard).toContainText('AI 自動提案');
		await expect(familyCard).toContainText('きょうだいランキング');
		await expect(familyCard).toContainText('ひとことメッセージ');
		await expect(familyCard).toContainText('無制限の履歴保持');
		await expect(familyCard).toContainText('メールサポート');
	});

	test('棚卸しで削除された項目は standard / family カードに表示されない', async ({ page }) => {
		// #792 棚卸し: plan-gate されていない or 未稼働のため削除
		const standardCard = page.locator('.plan-card.recommended');
		const familyCard = page.locator('.plan-card', { hasText: 'ファミリー' }).first();

		// 月次比較レポート: plan-gate されていないため全プラン参照可
		await expect(familyCard).not.toContainText('月次比較レポート');

		// 週次メールレポート: cron 未稼働のため掲載保留
		await expect(standardCard).not.toContainText('週次メールレポート');

		// アバター変更: #866 で canCustomAvatar を削除。全プラン共通機能として扱う
		await expect(standardCard).not.toContainText('アバター変更');
		await expect(standardCard).not.toContainText('アバター画像');

		// #722: AI 提案は standard から削除、family 専用に
		await expect(standardCard).not.toContainText('AI による活動提案');
		await expect(standardCard).not.toContainText('AI 自動提案');
		// family には AI 自動提案が直接表示される
		await expect(familyCard).toContainText('AI 自動提案');
	});

	test('free カードの内容は変わらない（回帰防止）', async ({ page }) => {
		const freeCard = page.locator('.plan-card', { hasText: 'フリー' }).first();
		await expect(freeCard).toBeVisible();
		await expect(freeCard).toContainText('お子さまの登録：2人まで');
		await expect(freeCard).toContainText('オリジナル活動の作成：3個まで');
		await expect(freeCard).toContainText('90日間の履歴保持');
		// 有料機能が誤って free に混入していないこと
		await expect(freeCard).not.toContainText('AI 自動提案');
		await expect(freeCard).not.toContainText('特別なごほうび');
	});
});
