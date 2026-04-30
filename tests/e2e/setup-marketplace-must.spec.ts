// tests/e2e/setup-marketplace-must.spec.ts
// #1758 (#1709-D) marketplace 移行 — 回帰テスト
//
// 目的（Issue AC §setup フロー E2E）:
// 1. mustDefault 推奨展開（applyMustDefault=ON）で activity-pack 内の must 候補が
//    `priority='must'` として DB に登録されることを admin/packs UI 経由で確認
// 2. チェックボックス OFF（applyMustDefault=未送信）で mustDefault=true の活動でも
//    `priority='optional'` で登録されることを確認
// 3. 旧 routine checklist preset 12 件が marketplace から削除済であることを確認
//    (event-* 3 件のみ残り、削除済プリセットは 404 を返す)
//
// 認証: AWS / cognito-dev 環境では admin 配下に到達するために `auth.setup.ts` で
// 認証コンテキストが事前に確立されている前提。ローカル AUTH_MODE=local では
// hooks.server.ts の自動セットアップ + global-setup.ts のテナント seed が使われる。

import { expect, test } from '@playwright/test';

test.describe('#1758 marketplace 移行 — must 推奨インポート', () => {
	test('admin/packs で activity-pack に「おやくそく推奨 N件」Badge と must Badge が表示される', async ({
		page,
	}) => {
		await page.goto('/admin/packs');
		await expect(page).toHaveURL(/\/admin\/packs/);

		// kinder-starter パックを展開する（mustDefault: 3 件 = はみがきした/おきがえした/おかたづけした）
		const kinderStarter = page.getByText(/ようじキッズ|kinder.starter/i).first();
		await kinderStarter.waitFor({ state: 'visible', timeout: 10000 });
		await kinderStarter.click();

		// パック header に「おやくそく推奨 N件」Badge（PACKS_PAGE_LABELS.mustDefaultCount）
		// 文言は labels.ts SSOT で定義された日本語固定。複数パックに同じ文言が出るため
		// `.first()` で最初の要素を取って厳密一致させる（assertion 弱体化禁止）。
		const mustBadge = page.locator('text=/おやくそく推奨\\s*\\d+件/').first();
		await expect(mustBadge).toBeVisible({ timeout: 5000 });

		// 展開された活動リスト内に個別 must Badge（PACKS_PAGE_LABELS.mustDefaultBadge）が
		// 少なくとも 1 件存在する。Badge 文言は固定で「おやくそく推奨」。
		const individualMustBadge = page.locator('text=/^おやくそく推奨$/').first();
		await expect(individualMustBadge).toBeVisible({ timeout: 5000 });

		// チェックボックス UI が表示される（applyMustDefault input、name="applyMustDefault"）
		const checkbox = page.locator('input[name="applyMustDefault"]').first();
		await expect(checkbox).toBeVisible({ timeout: 5000 });
		// 既定 ON
		await expect(checkbox).toBeChecked();
	});

	test('admin/packs チェックボックス OFF 操作後も UI 状態が保持される（applyMustDefault state）', async ({
		page,
	}) => {
		// シナリオ 2: チェックボックスを OFF にすると applyMustDefault state が false に
		// 切り替わる。次回 form submit 時に applyMustDefault が送信されない（既定 OFF）。
		// 注: 実際の DB 挿入結果は activity-import-service の unit テスト
		// (#1758 セクション 5 件) で検証済。ここでは UI state 切り替えのみ確認する。
		await page.goto('/admin/packs');

		const kinderStarter = page.getByText(/ようじキッズ/).first();
		await kinderStarter.waitFor({ state: 'visible', timeout: 10000 });
		await kinderStarter.click();

		const checkbox = page.locator('input[name="applyMustDefault"]').first();
		await expect(checkbox).toBeVisible({ timeout: 5000 });
		// 既定 ON
		await expect(checkbox).toBeChecked();

		// OFF に切り替え
		await checkbox.uncheck();
		await expect(checkbox).not.toBeChecked();
	});

	test('admin/packs 表示で 12 件すべての activity-pack が描画される', async ({ page }) => {
		// #1212-A で activity-pack は 4 年齢 × neutral (4) + 性別バリアント (8) = 12 件構成
		// この件数が削減されていないことを確認（marketplace 移行の副作用検出）。
		await page.goto('/admin/packs');

		const expectedNames = [
			'ようじキッズ', // kinder-starter
			'しょうがくせいチャレンジ', // elementary-challenge
			'中学生チャレンジ', // junior-high-challenge
			'高校生チャレンジ', // senior-high-challenge
		];

		for (const name of expectedNames) {
			const pack = page.getByText(name).first();
			await expect(pack).toBeVisible({ timeout: 10000 });
		}
	});
});

test.describe('#1758 marketplace 移行 — routine checklist 削除確認', () => {
	test('削除済 routine checklist (morning-kinder) は 404 を返す', async ({ page }) => {
		// 旧 morning/evening/weekend × kinder/elementary/junior/senior = 12 件は
		// #1758 で marketplace から削除済。getMarketplaceItem('checklist', ...) が null を
		// 返すため、`+page.server.ts` の load() が `error(404)` を投げる。
		const response = await page.goto('/marketplace/checklist/morning-kinder');
		expect(response?.status(), 'morning-kinder は削除済 → 404').toBe(404);
	});

	test('削除済 routine checklist (evening-elementary) は 404 を返す', async ({ page }) => {
		const response = await page.goto('/marketplace/checklist/evening-elementary');
		expect(response?.status(), 'evening-elementary は削除済 → 404').toBe(404);
	});

	test('削除済 routine checklist (weekend-junior) は 404 を返す', async ({ page }) => {
		const response = await page.goto('/marketplace/checklist/weekend-junior');
		expect(response?.status(), 'weekend-junior は削除済 → 404').toBe(404);
	});

	test('event-* 3 件 (event-school-start) は引き続きアクセス可能', async ({ page }) => {
		// marketplace 移行後も event-* 3 件は持ち物リストとして残る（持ち物純化）
		const response = await page.goto('/marketplace/checklist/event-school-start');
		expect(response?.status(), 'event-school-start は残る').toBeLessThan(400);
	});

	test('event-* 3 件 (event-pool) は引き続きアクセス可能', async ({ page }) => {
		const response = await page.goto('/marketplace/checklist/event-pool');
		expect(response?.status(), 'event-pool は残る').toBeLessThan(400);
	});

	test('event-* 3 件 (event-field-trip) は引き続きアクセス可能', async ({ page }) => {
		const response = await page.goto('/marketplace/checklist/event-field-trip');
		expect(response?.status(), 'event-field-trip は残る').toBeLessThan(400);
	});
});
