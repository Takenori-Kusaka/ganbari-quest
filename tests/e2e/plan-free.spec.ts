// tests/e2e/plan-free.spec.ts
// #751: 無料プランの機能ゲート E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で DevCognitoAuthProvider の
// dev-tenant-free（plan=free）でログインし、
// 「free だからこそ表示される / disabled される」UI を一通り確認する。
//
// 設計意図:
//  - free のときに見えるべきアップセル CTA / locked badge / disabled 状態を
//    positive assertion で押さえる
//  - plan-standard / plan-family の negative assertion とミラー関係になり、
//    プラン境界の回帰検知を双方向で担保する
//
// #1535: loginAsPlan() を storageState ベースに移行
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-free

import { expect, test } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/free.json' });

test.describe('#751 free プラン — 機能ゲート', () => {
	test('/admin/subscription の PlanStatusCard が free を示し、アップグレード CTA が見える', async ({
		page,
	}) => {
		await page.goto('/admin/subscription');
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
		// free 専用のアップグレード CTA が表示される
		await expect(page.getByTestId('plan-status-free-cta')).toBeVisible();
		// トライアル中バッジは出ない（dev-tenant-free はトライアル未開始想定）
		await expect(page.getByTestId('plan-status-trial-badge')).toHaveCount(0);
	});

	test('/admin ホームには PlanStatusCard を出さず header アップグレード導線で誘導する (#3033)', async ({
		page,
	}) => {
		await page.goto('/admin');
		// #3033: body 常設プランカードは撤去 (プラン情報は /admin/subscription に一本化)
		const upgradeBtn = page.locator('[data-tutorial="upgrade-btn"]');
		await expect(upgradeBtn).toBeVisible({ timeout: 30_000 });
		await expect(upgradeBtn).toHaveAttribute('href', '/admin/subscription');
		await expect(page.getByTestId('plan-status-card')).toHaveCount(0);
	});

	// #3033 (PO 指摘 2026-06-12): 旧 #2901 AC4 の「not-started バナーで制限機能を列挙」は
	// 全ページ常設がモバイルで画面の半分を占めるため撤去 (supersede)。
	// 「何が制限されるか」の recognition はロック機能接触時の文脈表示
	// (本 spec の AiSuggestPanel テスト / rewards-upgrade-banner / export-upsell) が担う。
	test('/admin ホームに常設トライアルバナーが出ない (#3033)', async ({ page }) => {
		await page.goto('/admin');
		await expect(page.locator('[data-tutorial="upgrade-btn"]')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-gated-features')).toHaveCount(0);
	});

	test('/admin/reports — weekly-report-upsell バナーが表示される', async ({ page }) => {
		await page.goto('/admin/reports');
		// #735: 無料プラン向け upsell はタブの外に出し、ページ到達時点で常に表示される
		await expect(page.getByTestId('weekly-report-upsell')).toBeVisible();
	});

	test('/admin/settings/data — エクスポートはアップセル表示で disabled', async ({ page }) => {
		// #2323 (EPIC #2319 ④): data 管理 UI は /admin/settings/data に移行済
		await page.goto('/admin/settings/data');
		// free 用アップセルカードが見える
		await expect(page.getByTestId('export-upsell')).toBeVisible();
		// data-export-button 自体は disabled 状態（hidden ではなく見せたうえで操作不可）
		const exportBtn = page.getByTestId('data-export-button').first();
		await expect(exportBtn).toBeVisible();
		await expect(exportBtn).toBeDisabled();
	});

	test('/admin/activities — AiSuggestPanel が plan-locked + アップセル CTA を出す', async ({
		page,
	}) => {
		await page.goto('/admin/activities');
		// EPIC #2253 / #2255: header + dropdown menu から AI を選択
		// Svelte ハイドレーション完了を待つ（addBtn の onclick ハンドラ束縛を保証）。
		const addBtn = page.getByTestId('header-add-activity-btn');
		await expect(addBtn).toBeVisible({ timeout: 15_000 });

		// + dropdown menu から AI を選択
		// （AiSuggestPanel は Dialog 内 addMode='ai' のときのみ描画される）
		// Ark UI menu は open 直後の outside-click 判定で閉じることがある (flake) ため、
		// item が可視にならなければ menu を再オープンする
		await addBtn.click();
		const aiItem = page.getByTestId('menu-item-ai');
		try {
			await expect(aiItem).toBeVisible({ timeout: 5_000 });
		} catch {
			await addBtn.click();
			await expect(aiItem).toBeVisible({ timeout: 10_000 });
		}
		await aiItem.click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();

		const panel = page.getByTestId('ai-suggest-panel');
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-plan-locked', 'true');
		await expect(page.getByTestId('ai-suggest-locked-badge')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-upgrade-card')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-upgrade-cta')).toBeVisible();
	});

	test('/admin/rewards — アップグレードバナーが表示される', async ({ page }) => {
		// plan-gated-features.spec.ts でも検証済みだが、
		// free プランの正面検証パッケージとしてここでも押さえる
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	// #2316: 旧 /admin/messages 「ひとことメッセージ」family-only ゲートテストは削除。
	//   #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
	//   メッセージ機能は応援機能の付随要素として全プラン解放された。
	//   ADR-0006 (assertion erosion ban) に従い skip ではなく削除。
	//   free プランのゲート確認は /admin/rewards rewards-upgrade-banner で担保。
});
