// tests/e2e/setup-marketplace-must.spec.ts
// #1758 (#1709-D) marketplace 移行 — 回帰テスト
//
// 目的（Issue AC §setup フロー E2E）:
// - 旧 routine checklist preset 12 件が marketplace から削除済であることを確認
//   (event-* 3 件のみ残り、削除済プリセットは 404 を返す)
//
// #4691: 旧 `/admin/packs` UI 経由の must 推奨インポート検証 (3 シナリオ) は、同 UI の撤去
// (nav から到達不能 + 子供選択 / プラン上限を通らない取込経路) に伴い削除。mustDefault の
// 取込挙動は marketplace → `/admin/activities?import=` → ChildSelectionDialog の正規経路
// (tests/e2e/admin-activities-import-marketplace.spec.ts) と unit
// (tests/unit/services/activity-import-service.test.ts `#1758` セクション) で担保する。
//
// 認証: AWS / cognito-dev 環境では admin 配下に到達するために `auth.setup.ts` で
// 認証コンテキストが事前に確立されている前提。ローカル AUTH_MODE=local では
// hooks.server.ts の自動セットアップ + global-setup.ts のテナント seed が使われる。

import { expect, test } from './fixtures';

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
