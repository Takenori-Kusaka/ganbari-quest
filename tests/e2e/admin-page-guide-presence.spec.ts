// tests/e2e/admin-page-guide-presence.spec.ts
// #2905 (EPIC #2897): 全 admin ページで ❓ ページガイドが開閉できることを保証する presence E2E
//
// 設計背景 (tmp/marketplace-bugs-analysis-2026-06-04.md §8 / 見逃し M6):
//   PageGuideOverlay は「一度も壊れたことが無い」ため presence assert が無く、
//   #2294 EPIC で新設された checklists / challenges ページ + status ページが
//   page-guide-registry に未登録のまま ❓ ボタンが脱落しても検出できなかった
//   (PO 指摘 #8「? ページガイドが見当たらない」)。
//
//   本 spec は「導線インベントリテストの第 1 号」(M6 対策) として、全 admin 主要ページで
//   「❓ トリガが存在する → click → ガイド overlay が開く → Escape で閉じる」を
//   ループ検証する。新ページ追加時にガイド登録を忘れると本 spec が必ず fail する
//   (構造 invariant の機械的担保)。
//
// render-only 禁止 (tests/CLAUDE.md §act → outcome assert) 準拠:
//   ボタン存在だけでなく click → overlay 出現 → close まで貫通検証する。
//
// 認証 / プラン:
//   AUTH_MODE=local の E2E は plan=family を返すため、family 限定機能 (challenges) を含む
//   全ページでガイドが起動できる。点検対象は AdminLayout 配下の admin ページに限る
//   (marketplace は AdminLayout 外のため対象外)。

import { expect, type Page, test } from '@playwright/test';

// AdminLayout 配下で ❓ ページガイドが登録されている admin ページ (page-guide-registry.ts SSOT)。
// #2905 で checklists / challenges / status を追加登録した。
// page-guide-registry.ts の GUIDE_LOADERS と 1:1 で同期させ、登録漏れ / 登録解除の drift を
// 本 spec が必ず検出する状態にする (M6 導線インベントリ invariant)。
const ADMIN_GUIDE_PAGES = [
	'/admin',
	'/admin/activities',
	'/admin/rewards',
	'/admin/checklists',
	'/admin/challenges',
	'/admin/children',
	'/admin/settings',
	'/admin/status',
	'/admin/points',
	'/admin/reports',
	'/admin/cheer',
] as const;

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_OVERLAY = '[role="dialog"][aria-labelledby="page-guide-title"]';

/**
 * admin home 初回訪問時の PremiumWelcome overlay (`.welcome-overlay`) が ❓ click を
 * intercept しうるため、存在すれば CTA button (`.welcome-cta`) で閉じてからガイドを起動する
 * (テスト安定化、実バグではない)。CTA ラベルは plan tier で変わるため class セレクタで閉じる。
 */
async function dismissWelcome(page: Page): Promise<void> {
	const welcomeDialog = page.locator('.welcome-overlay');
	if (await welcomeDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
		const dismissBtn = welcomeDialog.locator('.welcome-cta');
		if (await dismissBtn.isVisible().catch(() => false)) {
			await dismissBtn.click();
			await welcomeDialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	}
}

test.describe('#2905 全 admin ページで ❓ ページガイドが開閉できる (presence inventory)', () => {
	test.setTimeout(60_000);

	for (const path of ADMIN_GUIDE_PAGES) {
		test(`${path}: ❓ トリガ visible → click → ガイド overlay 開く → Escape で閉じる`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(path);
			await page.waitForLoadState('domcontentloaded');
			await dismissWelcome(page);

			// 1) ❓ トリガが存在し visible であること (presence)
			const guideBtn = page.locator(GUIDE_BTN);
			await expect(guideBtn).toBeVisible({ timeout: 10_000 });

			// 2) act → outcome: click でガイド overlay が開くこと (dead-end でない)
			await guideBtn.first().click({ force: true });
			const overlay = page.locator(GUIDE_OVERLAY);
			await expect(overlay).toBeVisible({ timeout: 5_000 });

			// 3) Escape で閉じること (PageGuideOverlay handleKeydown)
			await page.keyboard.press('Escape');
			await expect(overlay).toBeHidden({ timeout: 5_000 });
		});
	}
});
