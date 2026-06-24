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
	// #3267 (EPIC #3260 C3): プラン・課金 + お支払い
	'/admin/subscription',
	'/admin/billing',
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

// #3262 (EPIC #3260 F1): registry 親パス フォールバック。未登録サブパス / 未登録 top-level でも
// 親（ハブ / admin home）ガイドに degrade し ❓ が空にならない（dead-end 防止）。
// dedicated guide は C1〜C7 で付与するが、本 spec は「? が出て overlay が開く」安全網を検証する。
const FALLBACK_PAGES = [
	'/admin/packs', // 未登録サブ (C4 backlog) → /admin にフォールバック
	'/admin/members', // 未登録 top-level → /admin にフォールバック
] as const;

// #3266 (EPIC #3260 C2): 設定サブ 6 ページの個別ガイド。registry 登録済 (REGISTERED) のため、
// 親 /admin/settings ではなく各サブページ固有のガイドが起動する。
const SETTINGS_SUBPAGES = [
	'/admin/settings/account',
	'/admin/settings/activities',
	'/admin/settings/notifications',
	'/admin/settings/data',
	'/admin/settings/rules',
	'/admin/settings/support',
] as const;

test.describe('#3262 F1: 未登録サブパスで親ガイドにフォールバックし ❓ が出る', () => {
	test.setTimeout(60_000);

	for (const path of FALLBACK_PAGES) {
		test(`${path}: フォールバックで ❓ visible → click → overlay 開く`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(path);
			await page.waitForLoadState('domcontentloaded');
			await dismissWelcome(page);

			const guideBtn = page.locator(GUIDE_BTN);
			await expect(guideBtn).toBeVisible({ timeout: 10_000 });
			await guideBtn.first().click({ force: true });
			await expect(page.locator(GUIDE_OVERLAY)).toBeVisible({ timeout: 5_000 });
		});
	}
});

test.describe('#3266 C2: 設定サブ 6 ページで個別ガイドが開閉できる (presence inventory)', () => {
	test.setTimeout(60_000);

	for (const path of SETTINGS_SUBPAGES) {
		test(`${path}: ❓ トリガ visible → click → ガイド overlay 開く → Escape で閉じる`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(path);
			await page.waitForLoadState('domcontentloaded');
			await dismissWelcome(page);

			const guideBtn = page.locator(GUIDE_BTN);
			await expect(guideBtn).toBeVisible({ timeout: 10_000 });
			await guideBtn.first().click({ force: true });
			const overlay = page.locator(GUIDE_OVERLAY);
			await expect(overlay).toBeVisible({ timeout: 5_000 });
			await page.keyboard.press('Escape');
			await expect(overlay).toBeHidden({ timeout: 5_000 });
		});
	}
});

// #2919 項目4: page guide の requiredTier フィルタを tier 別に検証する。
//
// 設計背景:
//   上の presence describe は AUTH_MODE=local の既定 (= plan=family) で全 step が出る経路を検証する
//   (family 固定ケース、削除しない / ADR-0006)。一方、`requiredTier` 付き step が下位 tier で
//   「ガイドから除外される」こと、かつ「残りの非 gate step でガイドが成立する」ことは tier 別
//   ケースが無く未検証だった (filterGuideStepsByTier の enforcement 回帰が無い)。
//
//   #3222 (#3193): challenges guide は全プラン開放に伴い requiredTier を撤去したため、
//   本 filter テストの fixture を activities guide に移した。activities guide は
//   `activities-intro` / `activities-filter` (非 gate) + `activities-add` (requiredTier:'standard')
//   の 3 step 構成。free tier では standard 限定の `activities-add` のみ除外され、非 gate の 2 step
//   (`activities-intro` / `activities-filter`) が残る。
//
//   本 test は free tier (`DEBUG_PLAN=free`、#758) で activities ページのガイドを開き:
//     - standard 限定 step `activities-add` が **全ステップを通して 1 度も出ない**
//       (上位プラン限定手順を free に見せない / filter enforcement)
//     - 非 gate step (`activities-intro`) が **出る** (ガイド自体は dead-end にならず成立する)
//     - 進捗の総数 (total) が 2 になり (「1 / 2」)、family 時 (3 step) から standard 限定 1 件のみ
//       正しく除外されている
//   を assert する。filter が壊れて standard step が漏れれば standard 限定 step の検出 or 進捗の total (3) で
//   必ず fail する。
//
// 実行: `DEBUG_PLAN=free npx playwright test tests/e2e/admin-page-guide-presence.spec.ts`
//   DEBUG_PLAN は process.env 駆動 (shared webServer 固定) のため、free 指定の無い既定実行では
//   下の if guard により suite 自体を登録しない (conditional 定義)。
//   env-conditional を skip API で表現すると e2e skip count ratchet (scripts/check-test-antipatterns.js)
//   と orphan-skip-deadlines gate (ADR-0006) に抵触するため、conditional 定義で表現する。
if (process.env.DEBUG_PLAN === 'free') {
	test.describe('#2919 page guide の requiredTier フィルタ (free tier で上位プラン限定 step が除外される)', () => {
		test.setTimeout(60_000);

		test('/admin/activities: standard 限定 step は free で非表示・非 gate step でガイドは成立する', async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto('/admin/activities');
			await page.waitForLoadState('domcontentloaded');

			// 前提: DEBUG_PLAN=free がサーバーに伝播し plan=free で描画されていること
			// (data-plan は AdminLayout が planTier を反映する。伝播失敗時はこの assert で即 fail し、
			//  free でない state を free と誤認したまま下の filter assert が通る事故を防ぐ)。
			await expect(page.locator('[data-theme="admin"]')).toHaveAttribute('data-plan', 'free');

			await dismissWelcome(page);

			// ❓ click でガイドが開くこと (free でも非 gate step が残るため button は維持され dead-end でない)
			const guideBtn = page.locator(GUIDE_BTN);
			await expect(guideBtn).toBeVisible({ timeout: 10_000 });
			await guideBtn.first().click({ force: true });

			const overlay = page.locator(GUIDE_OVERLAY);
			await expect(overlay).toBeVisible({ timeout: 5_000 });

			// PageGuideBubble は常に「現在 step」1 件だけを DOM に描画する。起点は非 gate の `activities-intro`。
			await expect(page.locator('.guide-bubble[data-step-id="activities-intro"]')).toBeVisible();

			// 進捗の総数 (`current / total` の total) が 2 に絞られている
			// (family 時の 3 step から standard 限定 1 件 `activities-add` のみ除外)。
			// 起点 step では progress は「1 / 2」。filter が壊れて standard step が漏れれば total が 3 になり必ず fail する。
			await expect(page.locator('.guide-header-progress')).toHaveText('1 / 2');

			// standard 限定 step (`activities-add`) は free のガイドに含まれない (filter enforcement の回帰検出)。
			await expect(page.locator('.guide-bubble[data-step-id="activities-add"]')).toHaveCount(0);

			await page.keyboard.press('Escape');
			await expect(overlay).toBeHidden({ timeout: 5_000 });
		});
	});
}
