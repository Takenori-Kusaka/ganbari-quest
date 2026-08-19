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
	// #3267 (EPIC #3260 C3): プラン・課金 (#4139 で /admin/billing を統合)
	'/admin/subscription',
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ
	'/admin/certificates',
	'/admin/growth-book',
	'/admin/rewards/requests',
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
	'/admin/rewards/requests', // 未登録サブ (C7 backlog) → 親 /admin/rewards にフォールバック
	'/admin/certificates', // 未登録 top-level (C7 backlog) → /admin にフォールバック
] as const;

// #3268 (EPIC #3260 C4): 家族メンバー / パックの個別ガイド（registry 登録済 = REGISTERED）。
const MEMBERS_PACKS_PAGES = ['/admin/members', '/admin/packs'] as const;

// #3266 (EPIC #3260 C2): 設定サブ 6 ページの個別ガイド。registry 登録済 (REGISTERED) のため、
// 親 /admin/settings ではなく各サブページ固有のガイドが起動する。
const SETTINGS_SUB_PAGES = [
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

	for (const path of SETTINGS_SUB_PAGES) {
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

test.describe('#3268 C4: 家族メンバー / パックで個別ガイドが開閉できる (presence inventory)', () => {
	test.setTimeout(60_000);

	for (const path of MEMBERS_PACKS_PAGES) {
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
//   #3222 (#3193): challenges guide は全プラン開放に伴い requiredTier を撤去したため fixture を
//   activities guide に移したが、#4655 (EPIC #4650 PO 判断) で活動の追加 step も全プランに出す
//   (free でも 3 件まで追加できる) ことになり requiredTier を撤去した。fixture は
//   /admin/settings/data の `settings-data-export` (requiredTier:'standard'、free は upsell 表示で
//   「ボタンひとつで保存」が成立しないため除外) に移す。
//
//   本 test は free tier (`DEBUG_PLAN=free`、#758) で:
//     - /admin/activities: 活動の追加 step (`activities-add`) が **free でも出る** (#4655 AC)
//     - /admin/settings/data: standard 限定 step `settings-data-export` が **全ステップを通して 1 度も出ない**
//       (上位プラン限定手順を free に見せない / filter enforcement)、かつ非 gate step (`settings-data-intro`)
//       が **出る** (ガイド自体は dead-end にならず成立する)
//   を assert する。進捗の総数は assert しない (他 step の増減で壊れる脆い値のため。filter が壊れて
//   standard step が漏れれば step id の検出で必ず fail する)。
//
// 実行: `DEBUG_PLAN=free npx playwright test tests/e2e/admin-page-guide-presence.spec.ts`
//   DEBUG_PLAN は process.env 駆動 (shared webServer 固定) のため、free 指定の無い既定実行では
//   下の if guard により suite 自体を登録しない (conditional 定義)。
//   env-conditional を skip API で表現すると e2e skip count ratchet (scripts/check-test-antipatterns.js)
//   と orphan-skip-deadlines gate (ADR-0006) に抵触するため、conditional 定義で表現する。
if (process.env.DEBUG_PLAN === 'free') {
	test.describe('#2919 page guide の requiredTier フィルタ (free tier で上位プラン限定 step が除外される)', () => {
		test.setTimeout(60_000);

		/** ガイドを開き、全 step を「次へ」で巡回して出現した data-step-id の集合を返す。 */
		async function collectStepIds(page: import('@playwright/test').Page): Promise<string[]> {
			const bubble = page.locator('.guide-bubble');
			await expect(bubble).toBeVisible({ timeout: 5_000 });
			const ids: string[] = [];
			for (let i = 0; i < 15; i++) {
				const id = await bubble.getAttribute('data-step-id');
				if (id) ids.push(id);
				const next = bubble.locator('.guide-nav-next');
				const text = (await next.textContent().catch(() => '')) ?? '';
				if (text.includes('かんりょう')) break;
				await next.click();
				await expect(bubble).not.toHaveAttribute('data-step-id', id ?? '', { timeout: 5_000 });
			}
			return ids;
		}

		test('/admin/activities: 活動の追加 step は free でも出る (#4655、free も 3 件まで追加できる)', async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto('/admin/activities');
			await page.waitForLoadState('domcontentloaded');
			await expect(page.locator('[data-theme="admin"]')).toHaveAttribute('data-plan', 'free');
			await dismissWelcome(page);

			const guideBtn = page.locator(GUIDE_BTN);
			await expect(guideBtn).toBeVisible({ timeout: 10_000 });
			await guideBtn.first().click({ force: true });
			await expect(page.locator(GUIDE_OVERLAY)).toBeVisible({ timeout: 5_000 });
			await expect(page.locator('.guide-bubble[data-step-id="activities-intro"]')).toBeVisible();

			const ids = await collectStepIds(page);
			expect(ids, 'free でも活動の追加 step が出る').toContain('activities-add');

			await page.keyboard.press('Escape');
			await expect(page.locator(GUIDE_OVERLAY)).toBeHidden({ timeout: 5_000 });
		});

		test('/admin/settings/data: standard 限定 step は free で非表示・非 gate step でガイドは成立する', async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto('/admin/settings/data');
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

			// PageGuideBubble は常に「現在 step」1 件だけを DOM に描画する。起点は非 gate の概要 step。
			await expect(page.locator('.guide-bubble[data-step-id="settings-data-intro"]')).toBeVisible();

			// standard 限定 step (`settings-data-export`) は free のガイドに全 step を通して含まれない
			// (filter enforcement の回帰検出)。
			const ids = await collectStepIds(page);
			expect(ids).toContain('settings-data-intro');
			expect(ids, 'standard 限定 step が free に漏れていない').not.toContain(
				'settings-data-export',
			);

			await page.keyboard.press('Escape');
			await expect(overlay).toBeHidden({ timeout: 5_000 });
		});
	});
}
